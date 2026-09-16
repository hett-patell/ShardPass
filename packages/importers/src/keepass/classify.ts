import {
  CardItemSchema,
  IdentityItemSchema,
  MAX_CARD_HOLDER_LENGTH,
  MAX_CARD_NAME_LENGTH,
  MAX_CARD_NOTES_LENGTH,
  MAX_CARD_NUMBER_LENGTH,
  MAX_IDENTITY_NAME_LENGTH,
  MAX_IDENTITY_NOTES_LENGTH,
  MAX_LOGIN_CUSTOM_FIELD_VALUE_LENGTH,
  MAX_LOGIN_PASSWORD_HISTORY,
  MAX_LOGIN_PASSWORD_LENGTH,
  MAX_NOTE_CONTENT_LENGTH,
  MAX_NOTE_NAME_LENGTH,
  MAX_OTP_ISSUER_LENGTH,
  MAX_OTP_LABEL_LENGTH,
  MAX_SECRET_METADATA_ENTRIES,
  MAX_SECRET_METADATA_KEY_LENGTH,
  MAX_SECRET_METADATA_VALUE_LENGTH,
  MAX_SECRET_NAME_LENGTH,
  MAX_SECRET_NOTES_LENGTH,
  MAX_SECRET_VALUE_LENGTH,
  NoteItemSchema,
  OtpItemSchema,
  SecretItemSchema,
  isCanonicalUnpaddedBase32,
  type LoginCustomField,
  type LoginPasswordHistoryEntry,
  type VaultItem,
} from "@shardpass/domain";

import {
  clampName,
  clampText,
  keepIfValid,
  looksLikeKeyMaterial,
  normalizeTags,
  warningLabel,
} from "../common/clamp";
import { newItemBase } from "../common/item-base";
import { emitLogin } from "../common/login-candidate";
import { parseOtpAuthUri } from "../otpauth";
import type { KeePassEntry } from "./kdbx-read";

/**
 * KeePass has no item categories -- every record is a free-form bag of fields -- so the
 * category has to be inferred. The rules below are ordered most-specific first and are
 * deliberately conservative: anything that is not clearly a card, identity or secret falls
 * back to a login when it carries credentials, and a note when it does not. Nothing is ever
 * dropped for failing to match.
 */
export type ClassifiedKind = "card" | "identity" | "secret" | "login" | "note";

const CARD_FIELD_HINTS = ["card number", "cardnumber", "cardholder", "cvv", "cvc", "security code"];
const CARD_TITLE_HINTS = ["credit card", "debit card", "visa", "mastercard", "amex"];

const IDENTITY_FIELD_HINTS = [
  "first name",
  "firstname",
  "last name",
  "lastname",
  "date of birth",
  "passport",
  "national id",
  "social security",
  "ssn",
  "driver licence",
  "driver license",
];
const IDENTITY_TITLE_HINTS = [
  "passport",
  "identity",
  "driving licence",
  "driver license",
  "national id",
];

const SSH_KEY_MARKER = "-----BEGIN";
const API_FIELD_HINTS = [
  "api key",
  "api-key",
  "apikey",
  "access key",
  "client secret",
  "secret key",
];
const TOKEN_FIELD_HINTS = ["token", "bearer"];

/** KeeTrayTOTP and KeePassXC keep a TOTP as a seed plus a "period;digits" settings string. */
const TOTP_SEED_KEY = "totp seed";
const TOTP_SETTINGS_KEY = "totp settings";
/** A card PIN is short by nature; anything longer in the password field is something else. */
const MAX_CARD_PIN_LENGTH = 16;

function lower(value: string): string {
  return value.toLocaleLowerCase("en-US");
}

function hasFieldHint(entry: KeePassEntry, hints: readonly string[]): boolean {
  for (const key of entry.custom.keys()) {
    const name = lower(key);
    if (hints.some((hint) => name.includes(hint))) return true;
  }
  return false;
}

function hasTitleHint(entry: KeePassEntry, hints: readonly string[]): boolean {
  const title = lower(entry.title);
  return hints.some((hint) => title.includes(hint));
}

/**
 * Finds a custom field by name, returning its key too so callers can mark it consumed. An
 * exact name wins over a name that merely contains the candidate ("Card Number" before
 * "Phone number" for "number"), and a field already placed elsewhere is never taken twice.
 */
function findFieldEntry(
  entry: KeePassEntry,
  consumed: ReadonlySet<string> | null,
  ...candidates: readonly string[]
): readonly [key: string, value: string] | undefined {
  const free = [...entry.custom].filter(([key]) => consumed === null || !consumed.has(key));
  for (const candidate of candidates) {
    const exact = free.find(([key]) => lower(key) === candidate);
    if (exact !== undefined) return exact;
  }
  for (const candidate of candidates) {
    const loose = free.find(([key]) => lower(key).includes(candidate));
    if (loose !== undefined) return loose;
  }
  return undefined;
}

/** Reads a custom field into a typed slot and records that it has found its place. */
function takeField(
  entry: KeePassEntry,
  consumed: Set<string>,
  ...candidates: readonly string[]
): string {
  const found = findFieldEntry(entry, consumed, ...candidates);
  if (found === undefined) return "";
  consumed.add(found[0]);
  return found[1];
}

function hasCredentials(entry: KeePassEntry): boolean {
  return entry.username !== "" || entry.password !== "" || entry.url !== "";
}

function fitsCustomField(value: string): boolean {
  return value.length <= MAX_LOGIN_CUSTOM_FIELD_VALUE_LENGTH;
}

export function classifyEntry(entry: KeePassEntry): ClassifiedKind {
  if (hasFieldHint(entry, CARD_FIELD_HINTS)) return "card";
  if (hasFieldHint(entry, IDENTITY_FIELD_HINTS)) return "identity";
  // A title alone is a weak hint: "Amex" with a password and a site is the site's login,
  // and turning it into a card would file the password as a PIN.
  const signedIn = entry.password !== "" && (entry.url !== "" || entry.username !== "");
  if (!signedIn && hasTitleHint(entry, CARD_TITLE_HINTS)) return "card";
  if (!signedIn && hasTitleHint(entry, IDENTITY_TITLE_HINTS)) return "identity";

  // A key pasted into the Password field is common in KeePass; as a login it would exceed
  // the password ceiling and be rejected outright, so it is routed to a secret instead.
  if (looksLikeKeyMaterial(entry.password)) return "secret";
  if (entry.password.length > MAX_LOGIN_PASSWORD_LENGTH) return "secret";

  // A token or key in a custom field makes a secret only when the entry is nothing else.
  // With a username, password or site alongside it, this is a login that also carries a
  // token, and the token stays on the login as a hidden custom field rather than the
  // credentials being thrown away. A key too long for a custom field still has to become a
  // secret, or it would be cut short.
  const keyed = [...entry.custom.values()].filter((value) => value.includes(SSH_KEY_MARKER));
  const secretish =
    keyed.length > 0 ||
    entry.notes.includes(SSH_KEY_MARKER) ||
    hasFieldHint(entry, API_FIELD_HINTS) ||
    hasFieldHint(entry, TOKEN_FIELD_HINTS);
  if (secretish && (!hasCredentials(entry) || keyed.some((value) => !fitsCustomField(value))))
    return "secret";

  if (hasCredentials(entry)) return "login";
  if (entry.notes !== "") return "note";
  return "login";
}

/** KeePass keeps one URL field, but users routinely paste several separated by whitespace. */
function splitUrls(value: string): string[] {
  return value
    .split(/\s+/u)
    .map((url) => url.trim())
    .filter((url) => url !== "");
}

function secretTypeFor(entry: KeePassEntry): "api_key" | "ssh_key" | "token" | "other" {
  const blob = `${entry.password}\n${entry.notes}\n${[...entry.custom.values()].join("\n")}`;
  if (blob.includes(SSH_KEY_MARKER)) return "ssh_key";
  if (hasFieldHint(entry, API_FIELD_HINTS)) return "api_key";
  if (hasFieldHint(entry, TOKEN_FIELD_HINTS)) return "token";
  return "other";
}

/**
 * Renders leftover custom fields into notes so no imported data is silently lost. Fields
 * that already found a typed slot are skipped, and protected ones are never written into
 * plain notes: a masked value stays masked or is left out, and the person is told which.
 */
function appendCustomFields(
  entry: KeePassEntry,
  base: string,
  consumed: ReadonlySet<string>,
  label: string,
  warnings: string[],
): string {
  const extras: string[] = [];
  for (const [key, value] of entry.custom) {
    if (consumed.has(key)) continue;
    if (entry.protectedKeys.has(key)) {
      warnings.push(`"${label}": protected field "${key}" was not imported.`);
      continue;
    }
    extras.push(`${key}: ${value}`);
  }
  if (extras.length === 0) return base;
  return base === "" ? extras.join("\n") : `${base}\n\n${extras.join("\n")}`;
}

/** Lines that keep a card's or identity's sign-in details visible without a login slot. */
function credentialLines(entry: KeePassEntry, includeUsername: boolean): string[] {
  const lines: string[] = [];
  if (includeUsername && entry.username !== "") lines.push(`Username: ${entry.username}`);
  if (entry.url !== "") lines.push(`URL: ${entry.url}`);
  return lines;
}

function joinNotes(base: string, lines: readonly string[]): string {
  if (lines.length === 0) return base;
  return base === "" ? lines.join("\n") : `${base}\n\n${lines.join("\n")}`;
}

export type ConversionOutcome = Readonly<{ items: VaultItem[]; warnings: string[] }>;

type OtpParts = Readonly<{
  issuer: string;
  label: string;
  secret: string;
  otpType: "totp" | "hotp" | "steam";
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: number;
  period: number;
  counter?: number;
}>;

/**
 * Converts one KeePass entry into vault items. A single entry can yield two: an OTP item is
 * emitted alongside the login when the entry carries a TOTP secret, and the login links to it
 * via linkedOtpId.
 */
export function convertEntry(entry: KeePassEntry, folderId?: string): ConversionOutcome {
  const items: VaultItem[] = [];
  const warnings: string[] = [];
  const label = warningLabel(entry.title, "(untitled)");
  const displayName = entry.title.trim() === "" ? "Imported item" : entry.title.trim();
  const tags = normalizeTags(entry.tags, label, warnings);
  /** Custom fields that found a typed slot, so they are not repeated in notes or fields. */
  const consumed = new Set<string>();

  if (entry.attachments > 0)
    warnings.push(
      `"${label}": ${entry.attachments} attachment${entry.attachments === 1 ? "" : "s"} not imported.`,
    );

  const fresh = newItemBase();
  const createdAt = entry.createdAt ?? fresh.createdAt;
  const updatedAt = entry.updatedAt ?? createdAt;
  const base = {
    ...fresh,
    createdAt,
    updatedAt,
    tags,
    ...(folderId === undefined ? {} : { folderId }),
  };

  let linkedOtpId: string | undefined;
  const otp = resolveOtp(entry, displayName, consumed, label, warnings);
  if (otp !== undefined) {
    const item = buildOtpItem(otp, { createdAt, updatedAt, tags, folderId }, label, warnings);
    if (item !== undefined) {
      items.push(item);
      linkedOtpId = item.id;
    }
  }

  const kind = classifyEntry(entry);

  if (kind === "card") {
    let pin = takeField(entry, consumed, "pin").slice(0, MAX_CARD_PIN_LENGTH);
    if (entry.password !== "") {
      // KeePass users keep a card's PIN in the password field more often than anywhere else.
      if (pin === "" && entry.password.length <= MAX_CARD_PIN_LENGTH) pin = entry.password;
      else
        warnings.push(
          `"${label}": the password field has no place on a card and was not imported.`,
        );
    }
    const candidate = {
      ...base,
      kind: "card" as const,
      name: clampName(displayName, MAX_CARD_NAME_LENGTH, "Imported item", label, warnings),
      cardholderName: clampText(
        takeField(entry, consumed, "cardholder", "name on card"),
        MAX_CARD_HOLDER_LENGTH,
        "cardholder name",
        label,
        warnings,
      ),
      number: clampText(
        takeField(entry, consumed, "card number", "cardnumber", "number"),
        MAX_CARD_NUMBER_LENGTH,
        "card number",
        label,
        warnings,
      ),
      expMonth: takeField(entry, consumed, "expiry month", "exp month", "expmonth").slice(0, 2),
      expYear: takeField(entry, consumed, "expiry year", "exp year", "expyear").slice(0, 4),
      cvv: takeField(entry, consumed, "cvv", "cvc", "security code").slice(0, 8),
      pin,
      notes: clampText(
        appendCustomFields(
          entry,
          joinNotes(entry.notes, credentialLines(entry, true)),
          consumed,
          label,
          warnings,
        ),
        MAX_CARD_NOTES_LENGTH,
        "notes",
        label,
        warnings,
      ),
    };
    keepIfValid(CardItemSchema, candidate, "card", label, warnings, items);
    return { items, warnings };
  }

  if (kind === "identity") {
    if (entry.password !== "")
      warnings.push(
        `"${label}": the password field has no place on an identity and was not imported.`,
      );
    const candidate = {
      ...base,
      kind: "identity" as const,
      name: clampName(displayName, MAX_IDENTITY_NAME_LENGTH, "Imported item", label, warnings),
      firstName: takeField(entry, consumed, "first name", "firstname"),
      lastName: takeField(entry, consumed, "last name", "lastname"),
      ...(entry.username === "" ? {} : { username: entry.username }),
      email: takeField(entry, consumed, "email"),
      phone: takeField(entry, consumed, "phone", "mobile"),
      street: takeField(entry, consumed, "street", "address"),
      city: takeField(entry, consumed, "city"),
      state: takeField(entry, consumed, "state", "province"),
      zip: takeField(entry, consumed, "zip", "postal"),
      country: takeField(entry, consumed, "country"),
      notes: clampText(
        appendCustomFields(
          entry,
          joinNotes(entry.notes, credentialLines(entry, false)),
          consumed,
          label,
          warnings,
        ),
        MAX_IDENTITY_NOTES_LENGTH,
        "notes",
        label,
        warnings,
      ),
    };
    keepIfValid(IdentityItemSchema, candidate, "identity", label, warnings, items);
    return { items, warnings };
  }

  if (kind === "secret") {
    const secretType = secretTypeFor(entry);
    const keyed = [...entry.custom].find(([, value]) => value.includes(SSH_KEY_MARKER));
    const hinted = findFieldEntry(entry, null, ...API_FIELD_HINTS, ...TOKEN_FIELD_HINTS);
    const source = keyed ?? (hinted !== undefined && hinted[1] !== "" ? hinted : undefined);
    if (source !== undefined) consumed.add(source[0]);
    const value = source === undefined ? entry.password : source[1];
    if (source !== undefined && entry.password !== "" && entry.password !== value)
      warnings.push(`"${label}": the password field was not imported alongside the secret.`);
    // Leftover fields, protected or not, fit a secret's own key/value metadata, so none of
    // them has to be flattened into notes or left behind.
    const metadata: Record<string, string> = {};
    if (entry.username !== "")
      metadata["username"] = clampText(
        entry.username,
        MAX_SECRET_METADATA_VALUE_LENGTH,
        "username",
        label,
        warnings,
      );
    if (entry.url !== "")
      metadata["url"] = clampText(
        entry.url,
        MAX_SECRET_METADATA_VALUE_LENGTH,
        "URL",
        label,
        warnings,
      );
    for (const [key, fieldValue] of entry.custom) {
      if (consumed.has(key)) continue;
      const metadataKey = clampText(
        key.trim() === "" ? "Field" : key.trim(),
        MAX_SECRET_METADATA_KEY_LENGTH,
        "field name",
        label,
        warnings,
      );
      if (metadataKey in metadata) continue;
      if (Object.keys(metadata).length >= MAX_SECRET_METADATA_ENTRIES) {
        warnings.push(
          `"${label}": only the first ${MAX_SECRET_METADATA_ENTRIES} fields were kept.`,
        );
        break;
      }
      metadata[metadataKey] = clampText(
        fieldValue,
        MAX_SECRET_METADATA_VALUE_LENGTH,
        `field "${key}"`,
        label,
        warnings,
      );
    }
    const candidate = {
      ...base,
      kind: "secret" as const,
      name: clampName(displayName, MAX_SECRET_NAME_LENGTH, "Imported item", label, warnings),
      secretType,
      value: clampText(value, MAX_SECRET_VALUE_LENGTH, "value", label, warnings),
      metadata,
      notes: clampText(entry.notes, MAX_SECRET_NOTES_LENGTH, "notes", label, warnings),
    };
    keepIfValid(SecretItemSchema, candidate, "secret", label, warnings, items);
    return { items, warnings };
  }

  if (kind === "note") {
    const candidate = {
      ...base,
      kind: "note" as const,
      name: clampName(displayName, MAX_NOTE_NAME_LENGTH, "Imported item", label, warnings),
      content: clampText(
        appendCustomFields(entry, entry.notes, consumed, label, warnings),
        MAX_NOTE_CONTENT_LENGTH,
        "content",
        label,
        warnings,
      ),
    };
    keepIfValid(NoteItemSchema, candidate, "note", label, warnings, items);
    return { items, warnings };
  }

  // Custom KeePass strings map onto login custom fields one-to-one -- protected values stay
  // hidden -- so they remain individually copyable rather than flattened into notes.
  const customFields: LoginCustomField[] = [];
  for (const [key, fieldValue] of entry.custom) {
    if (consumed.has(key)) continue;
    customFields.push({
      name: key.trim() === "" ? "Field" : key.trim(),
      type: entry.protectedKeys.has(key) ? "hidden" : "text",
      value: fieldValue,
    });
  }
  emitLogin(
    base,
    {
      name: displayName,
      username: entry.username,
      password: entry.password,
      urls: splitUrls(entry.url),
      notes: entry.notes,
      customFields,
      passwordHistory: passwordHistoryOf(entry, updatedAt),
      ...(linkedOtpId === undefined ? {} : { linkedOtpId }),
    },
    label,
    warnings,
    items,
  );
  return { items, warnings };
}

/**
 * KeePass history holds whole older versions, oldest first; only the passwords carry over,
 * each dated by when the next version replaced it. Repeats and the current password are
 * left out, as is anything the login schema could not hold.
 */
function passwordHistoryOf(entry: KeePassEntry, updatedAt: string): LoginPasswordHistoryEntry[] {
  const history: LoginPasswordHistoryEntry[] = [];
  let previous = "";
  entry.history.forEach((version, index) => {
    const password = version.password;
    if (password === "" || password === previous || password === entry.password) return;
    if (Array.from(password).length > MAX_LOGIN_PASSWORD_LENGTH) return;
    previous = password;
    const changedAt = entry.history[index + 1]?.modifiedAt ?? updatedAt;
    history.push({ password, changedAt });
  });
  return history.reverse().slice(0, MAX_LOGIN_PASSWORD_HISTORY);
}

function canonicalSecret(raw: string): string | undefined {
  const secret = raw.replace(/[\s-]/gu, "").replace(/=+$/u, "").toUpperCase();
  return secret !== "" && isCanonicalUnpaddedBase32(secret) ? secret : undefined;
}

function otpLabelFor(entry: KeePassEntry, name: string): string {
  return entry.username === "" ? name : entry.username;
}

/**
 * Finds the entry's one-time-code secret in whichever form its KeePass plugin stored it:
 * the reserved `otp` field as an otpauth:// URI (KeePass 2.47+, KeePassXC), KeeOTP's
 * `key=...&step=...&size=...` string in the same field, a bare Base32 seed there, or
 * KeeTrayTOTP's "TOTP Seed" plus "TOTP Settings" pair. Anything present but unreadable is
 * reported rather than silently dropped.
 */
function resolveOtp(
  entry: KeePassEntry,
  name: string,
  consumed: Set<string>,
  label: string,
  warnings: string[],
): OtpParts | undefined {
  const reserved = entry.otp.trim();
  if (reserved !== "") {
    if (/^otpauth:\/\//iu.test(reserved)) {
      try {
        const parsed = parseLenientOtpAuthUri(reserved);
        return {
          issuer: parsed.issuer === "" ? name : parsed.issuer,
          label: parsed.label === "" ? otpLabelFor(entry, name) : parsed.label,
          secret: parsed.secret,
          otpType: parsed.otpType,
          algorithm: parsed.algorithm,
          digits: parsed.digits,
          period: parsed.period,
          ...(parsed.counter === undefined ? {} : { counter: parsed.counter }),
        };
      } catch {
        warnings.push(`"${label}": the one-time-code secret could not be read and was skipped.`);
        return undefined;
      }
    }
    const parts = reserved.includes("key=")
      ? parseKeeOtp(reserved, entry, name)
      : parseBareSeed(reserved, entry, name);
    if (parts === undefined)
      warnings.push(`"${label}": the one-time-code secret could not be read and was skipped.`);
    return parts;
  }

  const seed = findFieldEntry(entry, null, TOTP_SEED_KEY);
  if (seed === undefined) return undefined;
  consumed.add(seed[0]);
  const settings = findFieldEntry(entry, null, TOTP_SETTINGS_KEY);
  if (settings !== undefined) consumed.add(settings[0]);
  const parts = parseTraySettings(seed[1], settings?.[1] ?? "", entry, name);
  if (parts === undefined)
    warnings.push(`"${label}": the one-time-code secret could not be read and was skipped.`);
  return parts;
}

function parseBareSeed(raw: string, entry: KeePassEntry, name: string): OtpParts | undefined {
  const secret = canonicalSecret(raw);
  if (secret === undefined) return undefined;
  return {
    issuer: name,
    label: otpLabelFor(entry, name),
    secret,
    otpType: "totp",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  };
}

/** KeeOTP: `key=SEED&type=totp&step=30&size=6&otpHashMode=Sha1`, URL-encoded. */
function parseKeeOtp(raw: string, entry: KeePassEntry, name: string): OtpParts | undefined {
  let query: URLSearchParams;
  try {
    query = new URLSearchParams(raw);
  } catch {
    return undefined;
  }
  const encoding = (query.get("encoding") ?? "base32").trim().toLowerCase();
  if (encoding !== "base32") return undefined;
  const secret = canonicalSecret(query.get("key") ?? "");
  if (secret === undefined) return undefined;
  const type = (query.get("type") ?? "totp").trim().toLowerCase();
  if (type !== "totp" && type !== "hotp") return undefined;
  const algorithm = (query.get("otpHashMode") ?? "Sha1").replace(/-/gu, "").toUpperCase();
  if (algorithm !== "SHA1" && algorithm !== "SHA256" && algorithm !== "SHA512") return undefined;
  const digits = smallInteger(query.get("size"), 6);
  const period = smallInteger(query.get("step"), 30);
  const counter = smallInteger(query.get("counter"), 0);
  if (digits === undefined || period === undefined || counter === undefined) return undefined;
  return {
    issuer: name,
    label: otpLabelFor(entry, name),
    secret,
    otpType: type,
    algorithm,
    digits,
    period: type === "hotp" ? 0 : period,
    ...(type === "hotp" ? { counter } : {}),
  };
}

/** KeeTrayTOTP / KeePassXC legacy: settings are "period;digits", with "S" for Steam. */
function parseTraySettings(
  seed: string,
  settings: string,
  entry: KeePassEntry,
  name: string,
): OtpParts | undefined {
  const secret = canonicalSecret(seed);
  if (secret === undefined) return undefined;
  const [periodText = "30", digitsText = "6"] = settings.split(";").map((part) => part.trim());
  const period = smallInteger(periodText === "" ? null : periodText, 30);
  if (period === undefined) return undefined;
  if (digitsText.toUpperCase() === "S") {
    if (period !== 30) return undefined;
    return {
      issuer: name,
      label: otpLabelFor(entry, name),
      secret,
      otpType: "steam",
      algorithm: "SHA1",
      digits: 5,
      period: 30,
    };
  }
  const digits = smallInteger(digitsText === "" ? null : digitsText, 6);
  if (digits === undefined) return undefined;
  return {
    issuer: name,
    label: otpLabelFor(entry, name),
    secret,
    otpType: "totp",
    algorithm: "SHA1",
    digits,
    period,
  };
}

function smallInteger(value: string | null, fallback: number): number | undefined {
  if (value === null || value.trim() === "") return fallback;
  if (!/^\d{1,6}$/u.test(value.trim())) return undefined;
  return Number(value.trim());
}

function buildOtpItem(
  parts: OtpParts,
  base: Readonly<{
    createdAt: string;
    updatedAt: string;
    tags: readonly string[];
    folderId: string | undefined;
  }>,
  label: string,
  warnings: string[],
): VaultItem | undefined {
  const candidate = {
    ...newItemBase(),
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    tags: [...base.tags],
    ...(base.folderId === undefined ? {} : { folderId: base.folderId }),
    kind: "otp" as const,
    issuer: clampText(parts.issuer, MAX_OTP_ISSUER_LENGTH, "issuer", label, warnings),
    label: clampText(parts.label, MAX_OTP_LABEL_LENGTH, "label", label, warnings),
    secret: parts.secret,
    otpType: parts.otpType,
    algorithm: parts.algorithm,
    digits: parts.digits,
    period: parts.period,
    note: "",
    ...(parts.counter === undefined ? {} : { counter: parts.counter }),
  };
  const result = OtpItemSchema.safeParse(candidate);
  if (result.success) return result.data;
  warnings.push(`"${label}": the one-time-code secret was not valid and was skipped.`);
  return undefined;
}

/**
 * KeePassXC writes "otpauth://totp/Site:alice?issuer=Site" and some tools "Site.com:alice"
 * with issuer "Site"; the strict parser refuses the second, so the label's own prefix is
 * dropped and the query issuer trusted before giving up.
 */
function parseLenientOtpAuthUri(uri: string): ReturnType<typeof parseOtpAuthUri> {
  try {
    return parseOtpAuthUri(uri);
  } catch (error) {
    const parsed = new URL(uri);
    const path = decodeURIComponent(parsed.pathname.slice(1));
    const separator = path.indexOf(":");
    if (separator < 0 || parsed.searchParams.get("issuer") === null) throw error;
    parsed.pathname = `/${encodeURIComponent(path.slice(separator + 1).trim())}`;
    return parseOtpAuthUri(parsed.toString());
  }
}
