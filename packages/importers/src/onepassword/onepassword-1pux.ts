import {
  CardItemSchema,
  IdentityItemSchema,
  MAX_CARD_HOLDER_LENGTH,
  MAX_CARD_NAME_LENGTH,
  MAX_CARD_NOTES_LENGTH,
  MAX_CARD_NUMBER_LENGTH,
  MAX_IDENTITY_NAME_LENGTH,
  MAX_IDENTITY_NOTES_LENGTH,
  MAX_LOGIN_PASSWORD_HISTORY,
  MAX_LOGIN_PASSWORD_LENGTH,
  MAX_NOTE_CONTENT_LENGTH,
  MAX_NOTE_NAME_LENGTH,
  MAX_SECRET_METADATA_ENTRIES,
  MAX_SECRET_METADATA_KEY_LENGTH,
  MAX_SECRET_METADATA_VALUE_LENGTH,
  MAX_SECRET_NAME_LENGTH,
  MAX_SECRET_NOTES_LENGTH,
  MAX_SECRET_VALUE_LENGTH,
  NoteItemSchema,
  SecretItemSchema,
  type CardBrand,
  type LoginCustomField,
  type LoginPasswordHistoryEntry,
  type SecretItem,
  type VaultItem,
  type LoginUrlMatchMode,
} from "@shardpass/domain";

import { clampList, clampName, clampText, keepIfValid, normalizeTags, warningLabel } from "../common/clamp";
import { createFolderIndex, type ImportResult } from "../common/import-result";
import { newItemBase } from "../common/item-base";
import { emitLogin, type LoginBase, type LoginDraft } from "../common/login-candidate";
import { IMPORT_LIMITS } from "../import-model";
import {
  asString,
  decodeField,
  detectSignInWith,
  isRecord,
  type DecodedField,
  type LoginField,
} from "./onepassword-1pux-fields";
import { listZipEntries, readZipEntry, ZipFormatError } from "./zip-reader";

/** A 1PUX archive larger than this is refused unopened; the dialog caps files lower still. */
export const MAX_ONEPASSWORD_1PUX_ARCHIVE_BYTES = 64 * 1024 * 1024;
/** Ceiling for the inflated export.data: the item cap needs a fraction of it, a zip bomb wants more. */
export const MAX_ONEPASSWORD_1PUX_EXPORT_BYTES = 32 * 1024 * 1024;
const EXPORT_ENTRY = "export.data";

/** The file is not a 1PUX export at all (not a ZIP, no export.data, unreadable JSON). */
export class OnePassword1puxFormatError extends Error {
  override readonly name = "OnePassword1puxFormatError";
}

type LoginKind = "login" | "password" | "router" | "server" | "email";
type SecretKind = "api" | "license" | "bank" | "database" | "wallet";
type ItemKind = LoginKind | SecretKind | "card" | "identity" | "note" | "record" | "document";

/**
 * 1Password category UUIDs. Kinds with a username, password and address become logins so
 * they can autofill (servers, e-mail accounts, routers); kinds whose point is one long secret
 * with details around it become secrets (API credentials, licences, database and wallet keys,
 * bank accounts); documents and records with nothing to fill become notes that keep every field.
 */
const CATEGORY_KINDS: Readonly<Record<string, ItemKind>> = {
  "001": "login",
  "002": "card",
  "003": "note",
  "004": "identity",
  "005": "password",
  "006": "document",
  "100": "license",
  "101": "bank",
  "102": "database",
  "103": "record",
  "104": "record",
  "105": "record",
  "106": "record",
  "107": "record",
  "108": "record",
  "109": "router",
  "110": "server",
  "111": "email",
  "112": "api",
  "113": "record",
  "114": "wallet",
};

/** Which template fields hold the account, the password and the address for each login-like kind. */
const LOGIN_ROUTES: Readonly<
  Record<LoginKind, Readonly<{ username: readonly string[]; password: readonly string[]; url: readonly string[] }>>
> = {
  login: { username: ["username"], password: ["password"], url: ["url", "website"] },
  password: { username: ["username"], password: ["password"], url: ["url", "website"] },
  router: { username: [], password: ["password", "wireless_password"], url: ["server"] },
  server: { username: ["username"], password: ["password"], url: ["url"] },
  email: {
    username: ["pop_username", "smtp_username"],
    password: ["pop_password", "smtp_password"],
    url: ["provider_website"],
  },
};

/** Which template field is the secret itself for each secret-like kind; the rest is metadata. */
const SECRET_ROUTES: Readonly<
  Record<SecretKind, Readonly<{ type: SecretItem["secretType"]; value: readonly string[] }>>
> = {
  api: { type: "api_key", value: ["credential"] },
  license: { type: "other", value: ["reg_code"] },
  bank: { type: "other", value: ["accountNo"] },
  database: { type: "other", value: ["password"] },
  wallet: { type: "other", value: ["recoveryPhrase", "seed", "privateKey", "password"] },
};

const CARD_BRANDS: Readonly<Record<string, CardBrand>> = {
  visa: "visa",
  mc: "mastercard",
  mastercard: "mastercard",
  amex: "amex",
  "american express": "amex",
  discover: "discover",
  jcb: "jcb",
  unionpay: "unionpay",
  cup: "unionpay",
};

type ParsedItem = Readonly<{
  uuid: string;
  title: string;
  categoryUuid: string;
  kind: ItemKind | undefined;
  urls: readonly string[];
  /** 1Password's per-URL match mode, mapped: default → domain, exact → exact, host → host. */
  urlMatches: readonly LoginUrlMatchMode[];
  tags: readonly string[];
  notes: string;
  /** 1Password's "additional info" line: the username for logins. */
  ainfo: string;
  favorite: boolean;
  archived: boolean;
  trashed: boolean;
  createdAt: string | undefined;
  updatedAt: string | undefined;
  loginFields: readonly LoginField[];
  /** `details.password`: where Password items, and some older logins, keep it. */
  detailsPassword: string;
  fields: readonly DecodedField[];
  passwordHistory: readonly LoginPasswordHistoryEntry[];
  attachments: readonly string[];
  passkeys: number;
}>;

/**
 * Imports a 1Password 1PUX export: a ZIP archive whose `export.data` lists every account, vault
 * and item. Only that entry is read; attached files stay behind and are named in a warning.
 * Vault names become folders when there is more than one vault, so several vaults stay apart.
 *
 * Throws {@link OnePassword1puxFormatError} when the file is not a 1PUX export; anything wrong
 * with an individual item is a warning, as with every other importer.
 */
export async function importOnePassword1pux(archive: ArrayBuffer | Uint8Array): Promise<ImportResult> {
  const bytes = ArrayBuffer.isView(archive) ? archive : new Uint8Array(archive);
  if (bytes.byteLength > MAX_ONEPASSWORD_1PUX_ARCHIVE_BYTES)
    throw new OnePassword1puxFormatError(
      `The archive is larger than ${MAX_ONEPASSWORD_1PUX_ARCHIVE_BYTES / 1_048_576} MiB, more than can be imported.`,
    );
  return convertExport(await readExportData(bytes));
}

async function readExportData(bytes: Uint8Array): Promise<unknown> {
  let text: string;
  try {
    const entries = listZipEntries(bytes);
    const entry = entries.find((candidate) => candidate.name === EXPORT_ENTRY || candidate.name.endsWith(`/${EXPORT_ENTRY}`));
    if (entry === undefined)
      throw new OnePassword1puxFormatError(
        "The archive has no export.data file, so it is not a 1Password 1PUX export.",
      );
    text = new TextDecoder("utf-8", { fatal: true }).decode(await readZipEntry(bytes, entry, MAX_ONEPASSWORD_1PUX_EXPORT_BYTES));
  } catch (error) {
    if (error instanceof OnePassword1puxFormatError) throw error;
    if (error instanceof ZipFormatError) throw new OnePassword1puxFormatError(error.message);
    throw new OnePassword1puxFormatError("export.data is not UTF-8 text.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new OnePassword1puxFormatError("export.data is not valid JSON.");
  }
}

function convertExport(root: unknown): ImportResult {
  const items: VaultItem[] = [];
  const warnings: string[] = [];
  const accounts = isRecord(root) && Array.isArray(root["accounts"]) ? root["accounts"].filter(isRecord) : undefined;
  if (accounts === undefined)
    throw new OnePassword1puxFormatError('export.data has no "accounts" list, so it is not a 1Password 1PUX export.');
  const vaults = accounts.flatMap((account) =>
    (Array.isArray(account["vaults"]) ? account["vaults"].filter(isRecord) : []).map((vault) => ({ account, vault })),
  );
  const folderIndex = createFolderIndex();
  const severalAccounts = accounts.length > 1;
  const limit = IMPORT_LIMITS.maxThirdPartyEntries;
  let kept = 0;
  let skipped = 0;
  let trashed = 0;
  let ordinal = 0;

  // A "sign in with" field links to the provider account's own item; its username (the
  // Google address, say) is the username the provider login should carry.
  const usernameByUuid = new Map<string, string>();
  for (const { vault } of vaults)
    for (const raw of Array.isArray(vault["items"]) ? vault["items"] : []) {
      if (!isRecord(raw)) continue;
      const uuid = asString(raw["uuid"]).trim();
      const details = isRecord(raw["details"]) ? raw["details"] : {};
      const loginFields = Array.isArray(details["loginFields"]) ? details["loginFields"] : [];
      const username = loginFields.find(
        (field) => isRecord(field) && asString(field["designation"]).toLowerCase() === "username" && asString(field["value"]).trim() !== "",
      );
      if (uuid !== "" && isRecord(username)) usernameByUuid.set(uuid, asString(username["value"]).trim());
    }
  const context: ConvertContext = { usernameOf: (uuid) => usernameByUuid.get(uuid) };

  for (const { account, vault } of vaults) {
    // A single vault is the whole export; a folder named after it would wrap everything.
    const folderId =
      vaults.length > 1
        ? folderIndex.idFor(severalAccounts ? [attrName(account, "Account"), attrName(vault, "Vault")] : [attrName(vault, "Vault")])
        : undefined;
    for (const raw of Array.isArray(vault["items"]) ? vault["items"] : []) {
      ordinal += 1;
      if (!isRecord(raw)) {
        warnings.push(`Skipped entry ${ordinal}: not an object`);
        continue;
      }
      const parsed = parseItem(raw);
      if (parsed.trashed) {
        trashed += 1;
        continue;
      }
      if (kept >= limit) {
        skipped += 1;
        continue;
      }
      kept += 1;
      convertItem(parsed, ordinal, folderId, items, warnings, context);
    }
  }

  if (trashed > 0) warnings.push(`${trashed} item(s) in the trash were left out.`);
  if (skipped > 0)
    warnings.push(`Only the first ${limit} items were imported; ${skipped} item(s) were skipped.`);
  const folders = folderIndex.folders();
  return folders.length === 0 ? { items, warnings } : { items, warnings, folders };
}

function attrName(record: Record<string, unknown>, fallback: string): string {
  const attrs = isRecord(record["attrs"]) ? record["attrs"] : {};
  const name = asString(attrs["name"]).trim() || asString(attrs["accountName"]).trim() || asString(attrs["email"]).trim();
  return name === "" ? fallback : name;
}

function parseItem(raw: Record<string, unknown>): ParsedItem {
  const overview = isRecord(raw["overview"]) ? raw["overview"] : {};
  const details = isRecord(raw["details"]) ? raw["details"] : {};
  const categoryUuid = asString(raw["categoryUuid"]).trim();
  const state = asString(raw["state"]).trim().toLowerCase();
  const favIndex = raw["favIndex"];

  const fields: DecodedField[] = [];
  for (const section of Array.isArray(details["sections"]) ? details["sections"] : []) {
    if (!isRecord(section)) continue;
    for (const field of Array.isArray(section["fields"]) ? section["fields"] : []) {
      const decoded = decodeField(field);
      if (decoded !== undefined) fields.push(decoded);
    }
  }
  const attachments = fields.filter((field) => field.kind === "attachment").map((field) => field.text);
  const document = isRecord(details["documentAttributes"]) ? details["documentAttributes"] : undefined;
  if (document !== undefined) attachments.push(asString(document["fileName"]));
  const passkeys =
    fields.filter((field) => field.kind === "passkey").length + (isRecord(details["passkey"]) ? 1 : 0);

  const loginFields: LoginField[] = [];
  for (const entry of Array.isArray(details["loginFields"]) ? details["loginFields"] : []) {
    if (!isRecord(entry)) continue;
    loginFields.push({
      name: asString(entry["name"]).trim() || asString(entry["id"]).trim(),
      designation: asString(entry["designation"]).trim(),
      fieldType: asString(entry["fieldType"]).trim(),
      value: asString(entry["value"]),
    });
  }

  return {
    uuid: asString(raw["uuid"]).trim(),
    title: asString(overview["title"]).trim(),
    categoryUuid,
    kind: CATEGORY_KINDS[categoryUuid],
    ...urlsOf(overview),
    tags: Array.isArray(overview["tags"]) ? overview["tags"].filter((tag): tag is string => typeof tag === "string") : [],
    notes: asString(details["notesPlain"]),
    ainfo: asString(overview["ainfo"]).trim(),
    favorite: favIndex === true || (typeof favIndex === "number" && favIndex > 0),
    archived: state === "archived",
    trashed: state === "trashed" || raw["trashed"] === true,
    createdAt: isoOfUnix(raw["createdAt"]),
    updatedAt: isoOfUnix(raw["updatedAt"]),
    loginFields,
    detailsPassword: asString(details["password"]),
    fields,
    passwordHistory: passwordHistoryOf(details["passwordHistory"]),
    attachments,
    passkeys,
  };
}

/** The primary `url` plus every `urls[].url`, in order and without repeats, each with its match mode. */
function urlsOf(overview: Record<string, unknown>): { urls: string[]; urlMatches: LoginUrlMatchMode[] } {
  const urls: string[] = [];
  const urlMatches: LoginUrlMatchMode[] = [];
  const list = Array.isArray(overview["urls"]) ? overview["urls"] : Array.isArray(overview["URLs"]) ? overview["URLs"] : [];
  const modeOf = (url: string): LoginUrlMatchMode => {
    const entry = list.find((candidate) => isRecord(candidate) && asString(candidate["url"]).trim() === url);
    const mode = isRecord(entry) ? asString(entry["mode"]).trim().toLowerCase() : "";
    return mode === "exact" ? "exact" : mode === "host" ? "host" : "domain";
  };
  const add = (value: unknown) => {
    const url = asString(value).trim();
    if (url === "" || urls.includes(url)) return;
    urls.push(url);
    urlMatches.push(modeOf(url));
  };
  add(overview["url"]);
  for (const entry of list) add(isRecord(entry) ? entry["url"] : entry);
  return { urls, urlMatches };
}

/** 1PUX timestamps are Unix seconds; milliseconds are accepted in case an export writes them. */
function isoOfUnix(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const date = new Date(value > 1e12 ? value : value * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** `{ value, time }` entries; newest first, as ShardPass stores them. */
function passwordHistoryOf(raw: unknown): LoginPasswordHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: LoginPasswordHistoryEntry[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const password = asString(entry["value"]);
    const changedAt = isoOfUnix(entry["time"]);
    if (password === "" || changedAt === undefined) continue;
    entries.push({ password, changedAt });
  }
  return entries
    .sort((left, right) => right.changedAt.localeCompare(left.changedAt))
    .slice(0, MAX_LOGIN_PASSWORD_HISTORY);
}

type ConvertContext = Readonly<{ usernameOf(uuid: string): string | undefined }>;

function convertItem(
  parsed: ParsedItem,
  ordinal: number,
  folderId: string | undefined,
  items: VaultItem[],
  warnings: string[],
  context: ConvertContext,
): void {
  const label = warningLabel(parsed.title, `unnamed item ${ordinal}`);
  if (parsed.kind === "document") {
    warnings.push(`"${label}": document not imported.`);
    return;
  }
  const fresh = newItemBase();
  const createdAt = parsed.createdAt ?? fresh.createdAt;
  const base: LoginBase = {
    ...fresh,
    createdAt,
    updatedAt: parsed.updatedAt ?? createdAt,
    favorite: parsed.favorite,
    tags: normalizeTags(parsed.tags, label, warnings),
    ...(folderId === undefined ? {} : { folderId }),
    ...(parsed.archived ? { archivedAt: fresh.updatedAt } : {}),
  };

  for (const name of parsed.attachments)
    warnings.push(`"${label}": attachment${name === "" ? "" : ` "${name}"`} not imported.`);
  if (parsed.passkeys > 0)
    warnings.push(`"${label}": ${parsed.passkeys === 1 ? "passkey" : `${parsed.passkeys} passkeys`} not imported.`);
  for (const field of parsed.fields) {
    if (field.kind === "reference")
      warnings.push(`"${label}": field "${field.title}" links to another item and was left out.`);
    else if (field.kind === "unsupported")
      warnings.push(
        `"${label}": field "${field.title}" has a value ShardPass cannot store${field.detail === undefined ? "" : ` (${field.detail})`} and was left out.`,
      );
  }

  switch (parsed.kind) {
    case "login":
    case "password":
    case "router":
    case "server":
    case "email":
      emitLoginLike(parsed, parsed.kind, base, label, warnings, items, context);
      return;
    case "card":
      emitCard(parsed, base, label, warnings, items);
      return;
    case "identity":
      emitIdentity(parsed, base, label, warnings, items);
      return;
    case "api":
    case "license":
    case "bank":
    case "database":
    case "wallet":
      emitSecret(parsed, parsed.kind, base, label, warnings, items);
      return;
    case "note":
    case "record":
      emitNote(parsed, base, label, warnings, items);
      return;
    default:
      warnings.push(
        `"${label}": unknown 1Password category ${parsed.categoryUuid === "" ? "(none)" : parsed.categoryUuid}; imported as a note.`,
      );
      emitNote(parsed, base, label, warnings, items);
  }
}

/** The captured form field 1Password designated, or the best-typed one when none is designated. */
function capturedLogin(loginFields: readonly LoginField[], designation: "username" | "password"): string {
  const designated = loginFields.find((field) => field.designation.toLowerCase() === designation);
  if (designated !== undefined) return designated.value;
  const fallback = loginFields.find((field) => {
    const type = field.fieldType.toUpperCase();
    if (designation === "password") return type === "P";
    return type === "E" || (type === "T" && /user|email|login|account/iu.test(field.name));
  });
  return fallback?.value ?? "";
}

function emitLoginLike(
  parsed: ParsedItem,
  kind: LoginKind,
  base: LoginBase,
  label: string,
  warnings: string[],
  items: VaultItem[],
  context: ConvertContext,
): void {
  const route = LOGIN_ROUTES[kind];
  const consumed = new Set<DecodedField>();
  const take = (ids: readonly string[]): string => {
    for (const id of ids) {
      const field = parsed.fields.find(
        (candidate) =>
          candidate.id === id &&
          (candidate.kind === "text" || candidate.kind === "hidden") &&
          candidate.text !== "" &&
          !consumed.has(candidate),
      );
      if (field !== undefined) {
        consumed.add(field);
        return field.text;
      }
    }
    return "";
  };

  const signInWith = detectSignInWith(parsed.loginFields, parsed.fields);
  if (signInWith?.field !== undefined) consumed.add(signInWith.field);
  const sectionUsername = take(route.username);
  const sectionPassword = take(route.password);
  const username =
    capturedLogin(parsed.loginFields, "username") ||
    sectionUsername ||
    signInWith?.account ||
    (signInWith?.linkedItemUuid === undefined ? "" : (context.usernameOf(signInWith.linkedItemUuid) ?? "")) ||
    (kind === "login" ? parsed.ainfo : "");
  const password = capturedLogin(parsed.loginFields, "password") || parsed.detailsPassword || sectionPassword;
  const urlField = take(route.url);
  const prepended = urlField !== "" && !parsed.urls.includes(urlField);
  const urls = prepended ? [urlField, ...parsed.urls] : parsed.urls;
  const urlMatches = prepended ? ["domain" as const, ...parsed.urlMatches] : parsed.urlMatches;
  const totpField = parsed.fields.find((field) => field.kind === "totp" && field.text.trim() !== "");
  if (totpField !== undefined) consumed.add(totpField);

  const customFields: LoginCustomField[] = [];
  for (const field of parsed.fields) {
    if (consumed.has(field) || field.text === "") continue;
    if (field.kind === "text") customFields.push({ name: field.title, type: "text", value: field.text });
    else if (field.kind === "hidden" || field.kind === "totp")
      customFields.push({ name: field.title, type: "hidden", value: field.text });
    else if (field.kind === "boolean") customFields.push({ name: field.title, type: "boolean", value: field.text });
  }
  // Other captured form fields (a company id, a "remember me" box) are kept so autofill can use them.
  for (const field of parsed.loginFields) {
    const designation = field.designation.toLowerCase();
    const type = field.fieldType.toUpperCase();
    if (designation === "username" || designation === "password" || designation === "sso" || type === "SSO") continue;
    if (field.name === "" || field.value === "" || field.value === username || field.value === password) continue;
    customFields.push({ name: field.name, type: type === "P" ? "hidden" : "text", value: field.value });
  }

  if (signInWith?.provider === "other")
    warnings.push(
      signInWith.name === ""
        ? `"${label}": signs in with a provider the export does not name; kept as "other".`
        : `"${label}": signs in with "${signInWith.name}", which ShardPass does not list; kept as "other".`,
    );
  if (password === "" && signInWith === undefined && parsed.passkeys === 0) {
    // No password and no provider: name the shape of what the export held (titles and
    // value types only, never values), so an unrecognised "sign in with" layout can be
    // reported and taught.
    const loginShape = parsed.loginFields
      .map((field) => `${field.name || "?"}(${field.fieldType || "?"}${field.designation ? `, ${field.designation}` : ""})`)
      .join(", ");
    const sectionShape = parsed.fields.map((field) => `"${field.title}" (${field.valueKey ?? field.kind})`).join(", ");
    warnings.push(
      `"${label}": imported without a password (the export has none). Login fields: ${loginShape || "none"}. Section fields: ${sectionShape || "none"}.`.slice(0, 400),
    );
  }

  const draft: LoginDraft = {
    name: parsed.title || "Imported item",
    username,
    password,
    urls,
    // Only when a mode says more than the default: an all-domain list is the same as none.
    ...(urlMatches.some((mode) => mode !== "domain") ? { urlMatches } : {}),
    notes: parsed.notes,
    ...(totpField === undefined ? {} : { totp: totpField.text }),
    customFields,
    passwordHistory: parsed.passwordHistory.map((entry) => ({
      ...entry,
      password: clampText(entry.password, MAX_LOGIN_PASSWORD_LENGTH, "an old password", label, warnings),
    })),
  };
  // emitLogin fits the draft to the schema; the provider is added to what it kept, since the
  // enum value is typed and cannot invalidate the item.
  const staged: VaultItem[] = [];
  emitLogin(base, draft, label, warnings, staged);
  const emitted = staged[0];
  if (emitted === undefined) return;
  items.push(
    emitted.kind === "login" && signInWith !== undefined ? { ...emitted, signInWith: signInWith.provider } : emitted,
  );
}

/** Pulls a template field's text by id, marking it used so it is not repeated in the notes. */
function fieldPicker(parsed: ParsedItem): { pick(id: string): string; rest(): DecodedField[]; part(id: string, part: string): string } {
  const used = new Set<DecodedField>();
  const find = (id: string) =>
    parsed.fields.find(
      (field) => field.id === id && (field.kind === "text" || field.kind === "hidden") && !used.has(field),
    );
  return {
    pick(id) {
      const field = find(id);
      if (field === undefined) return "";
      used.add(field);
      return field.text.trim();
    },
    part(id, part) {
      // One address field feeds several columns, so it stays findable after the first.
      const field = parsed.fields.find((candidate) => candidate.id === id && candidate.address !== undefined);
      if (field === undefined) return "";
      used.add(field);
      return field.address?.[part] ?? "";
    },
    rest: () => parsed.fields.filter((field) => !used.has(field)),
  };
}

/** Fields the target kind has no column for are kept as "Title: value" lines under the notes. */
function withFieldLines(notes: string, fields: readonly DecodedField[]): string {
  const lines = fields
    .filter(
      (field) =>
        (field.kind === "text" || field.kind === "hidden" || field.kind === "boolean" || field.kind === "totp") &&
        field.text.trim() !== "",
    )
    .map((field) => `${field.title === "" ? "Field" : field.title}: ${field.text.trim()}`);
  if (lines.length === 0) return notes;
  return notes === "" ? lines.join("\n") : `${notes}\n\n${lines.join("\n")}`;
}

/** A card expiry as YYYY-MM (from a monthYear), MMYYYY, YYYYMM or MMYY digits. */
function splitExpiry(text: string): { month: string; year: string } {
  const digits = text.replace(/\D/gu, "");
  if (digits.length === 6)
    return /^(?:19|20)/u.test(digits)
      ? { month: digits.slice(4), year: digits.slice(0, 4) }
      : { month: digits.slice(0, 2), year: digits.slice(2) };
  if (digits.length === 4) return { month: digits.slice(0, 2), year: `20${digits.slice(2)}` };
  return { month: "", year: "" };
}

function emitCard(parsed: ParsedItem, base: LoginBase, label: string, warnings: string[], items: VaultItem[]): void {
  const fields = fieldPicker(parsed);
  const rawBrand = fields.pick("type").toLowerCase();
  const brand: CardBrand | undefined = rawBrand === "" ? undefined : (CARD_BRANDS[rawBrand] ?? "other");
  const { month, year } = splitExpiry(fields.pick("expiry"));
  const fit = (value: string, max: number, what: string) => clampText(value, max, what, label, warnings);
  const candidate = {
    ...base,
    kind: "card" as const,
    name: clampName(parsed.title, MAX_CARD_NAME_LENGTH, "Imported item", label, warnings),
    ...(brand === undefined ? {} : { brand }),
    cardholderName: fit(fields.pick("cardholder"), MAX_CARD_HOLDER_LENGTH, "cardholder name"),
    number: fit(fields.pick("ccnum"), MAX_CARD_NUMBER_LENGTH, "card number"),
    expMonth: fit(month, 2, "expiry month"),
    expYear: fit(year, 4, "expiry year"),
    cvv: fit(fields.pick("cvv"), 8, "security code"),
    pin: fit(fields.pick("pin"), 16, "PIN"),
    notes: fit(withFieldLines(parsed.notes, fields.rest()), MAX_CARD_NOTES_LENGTH, "notes"),
  };
  keepIfValid(CardItemSchema, candidate, "card", label, warnings, items);
}

function emitIdentity(parsed: ParsedItem, base: LoginBase, label: string, warnings: string[], items: VaultItem[]): void {
  const fields = fieldPicker(parsed);
  const fit = (value: string, max: number, what: string) => clampText(value, max, what, label, warnings);
  const optional = <K extends string>(key: K, value: string): Partial<Record<K, string>> =>
    value === "" ? {} : ({ [key]: value } as Record<K, string>);
  const phone = fields.pick("defphone") || fields.pick("cellphone") || fields.pick("homephone") || fields.pick("busphone");
  const candidate = {
    ...base,
    kind: "identity" as const,
    name: clampName(parsed.title, MAX_IDENTITY_NAME_LENGTH, "Imported item", label, warnings),
    firstName: fit(fields.pick("firstname"), 256, "first name"),
    ...optional("middleName", fit(fields.pick("initial"), 256, "middle name")),
    lastName: fit(fields.pick("lastname"), 256, "last name"),
    ...optional("company", fit(fields.pick("company"), 256, "company")),
    ...optional("username", fit(fields.pick("username"), 256, "username")),
    ...optional("birthDate", fit(fields.pick("birthdate"), 32, "birth date")),
    email: fit(fields.pick("email"), 256, "e-mail"),
    phone: fit(phone, 64, "phone"),
    street: fit(fields.part("address", "street"), 512, "street"),
    city: fit(fields.part("address", "city"), 256, "city"),
    state: fit(fields.part("address", "state"), 256, "state"),
    zip: fit(fields.part("address", "zip"), 32, "postal code"),
    country: fit(fields.part("address", "country"), 256, "country"),
    notes: fit(withFieldLines(parsed.notes, fields.rest()), MAX_IDENTITY_NOTES_LENGTH, "notes"),
  };
  keepIfValid(IdentityItemSchema, candidate, "identity", label, warnings, items);
}

function emitNote(parsed: ParsedItem, base: LoginBase, label: string, warnings: string[], items: VaultItem[]): void {
  const candidate = {
    ...base,
    kind: "note" as const,
    name: clampName(parsed.title, MAX_NOTE_NAME_LENGTH, "Imported item", label, warnings),
    content: clampText(withFieldLines(parsed.notes, parsed.fields), MAX_NOTE_CONTENT_LENGTH, "content", label, warnings),
  };
  keepIfValid(NoteItemSchema, candidate, "note", label, warnings, items);
}

function emitSecret(
  parsed: ParsedItem,
  kind: SecretKind,
  base: LoginBase,
  label: string,
  warnings: string[],
  items: VaultItem[],
): void {
  const route = SECRET_ROUTES[kind];
  const usable = (field: DecodedField) => (field.kind === "text" || field.kind === "hidden") && field.text !== "";
  const valueField =
    route.value.map((id) => parsed.fields.find((field) => field.id === id && usable(field))).find((field) => field !== undefined) ??
    parsed.fields.find((field) => field.kind === "hidden" && field.text !== "");

  const entries: [string, string][] = [];
  const username = capturedLogin(parsed.loginFields, "username");
  if (username !== "") entries.push(["username", username]);
  if (parsed.urls[0] !== undefined) entries.push(["url", parsed.urls[0]]);
  for (const field of parsed.fields) {
    if (field === valueField || field.text.trim() === "") continue;
    if (field.kind === "text" || field.kind === "hidden" || field.kind === "boolean" || field.kind === "totp")
      entries.push([field.title === "" ? "field" : field.title, field.text]);
  }
  const metadata: Record<string, string> = {};
  for (const [rawKey, rawValue] of clampList(entries, MAX_SECRET_METADATA_ENTRIES, "details", label, warnings)) {
    const key = clampText(rawKey.trim() || "field", MAX_SECRET_METADATA_KEY_LENGTH, "detail name", label, warnings);
    let unique = key;
    for (let suffix = 2; Object.hasOwn(metadata, unique); suffix += 1) unique = `${key} (${suffix})`;
    metadata[unique] = clampText(rawValue, MAX_SECRET_METADATA_VALUE_LENGTH, `detail "${key}"`, label, warnings);
  }

  const candidate = {
    ...base,
    kind: "secret" as const,
    name: clampName(parsed.title, MAX_SECRET_NAME_LENGTH, "Imported item", label, warnings),
    secretType: route.type,
    value: clampText(valueField?.text ?? "", MAX_SECRET_VALUE_LENGTH, "value", label, warnings),
    metadata,
    notes: clampText(parsed.notes, MAX_SECRET_NOTES_LENGTH, "notes", label, warnings),
  };
  keepIfValid(SecretItemSchema, candidate, "secret", label, warnings, items);
}
