import type { SignInProvider } from "@shardpass/domain";

/**
 * A 1PUX section field's value is an object with one key naming its type (`string`,
 * `concealed`, `totp`, `sso`, ...). This decodes each into text plus what kind of thing it was,
 * so the item converters can file it as a custom field, a one-time secret, a card number, and so
 * on, without each of them knowing the encoding.
 */
export type FieldValueKind =
  | "text"
  | "hidden"
  | "boolean"
  | "totp"
  | "sso"
  | "passkey"
  | "attachment"
  | "reference"
  | "unsupported";

export type DecodedField = Readonly<{
  /** For a provider sign-in: the uuid of the provider account's own item in the export. */
  linkedItemUuid?: string;
  /** For an unsupported value: its key and type, for the notice (never the value itself). */
  detail?: string;
  /** For a provider sign-in: the account e-mail the export attached to it, when any. */
  account?: string;
  /** The export's own key for the value ("string", "concealed", "sso" ...), for diagnostics. */
  valueKey?: string;
  /** The template id ("username", "ccnum"), stable across 1Password's languages. */
  id: string;
  /** What the person sees; falls back to the id. */
  title: string;
  kind: FieldValueKind;
  text: string;
  /** The parts of an address field, so identities can fill their own columns. */
  address?: Readonly<Record<string, string>>;
}>;

/** One `details.loginFields` entry: the web form fields 1Password captured. */
export type LoginField = Readonly<{
  name: string;
  designation: string;
  fieldType: string;
  value: string;
}>;

export type SignInWith = Readonly<{
  provider: SignInProvider;
  /** How the export named the provider, for a warning when it is one ShardPass does not list. */
  name: string;
  /** The account e-mail the export attached to the provider sign-in, when any. */
  account?: string;
  /** The uuid of the provider account's item, when the export links one. */
  linkedItemUuid?: string;
  /** The section field that said so, when one did; it is not repeated as a custom field. */
  field?: DecodedField;
}>;

const ADDRESS_PARTS = ["street", "city", "state", "zip", "country"] as const;
const SSO_PROVIDER_KEYS = ["provider", "ssoProvider", "identityProvider", "name", "issuer", "idp"] as const;
const SIGN_IN_WITH = /(?:sign|log)[\s-]?in[\s-]?with\b/iu;

/** Provider names as people and exports write them, matched loosely. */
const PROVIDER_PATTERNS: readonly (readonly [RegExp, SignInProvider])[] = [
  [/google|gmail|youtube/iu, "google"],
  [/apple|icloud/iu, "apple"],
  [/microsoft|azure|entra|outlook|hotmail|live\.com|xbox/iu, "microsoft"],
  [/github/iu, "github"],
  [/facebook|\bmeta\b/iu, "facebook"],
  [/twitter|\bx\b|x\.com/iu, "twitter"],
  [/amazon/iu, "amazon"],
  [/linkedin/iu, "linkedin"],
  [/slack/iu, "slack"],
];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Names the provider a free-text label refers to, or nothing when it is not one ShardPass lists. */
export function providerOf(name: string): SignInProvider | undefined {
  const trimmed = name.trim();
  if (trimmed === "") return undefined;
  return PROVIDER_PATTERNS.find(([pattern]) => pattern.test(trimmed))?.[1];
}

export function decodeField(raw: unknown): DecodedField | undefined {
  if (!isRecord(raw)) return undefined;
  const id = asString(raw["id"]).trim();
  const title = asString(raw["title"]).trim() || id;
  const value = raw["value"];
  if (typeof value === "string") return { id, title, valueKey: "string", kind: "text", text: value };
  if (!isRecord(value)) return undefined;
  const entry = Object.entries(value)[0];
  if (entry === undefined) return undefined;
  // A field the person left blank exports as a null value: nothing to store, nothing to say.
  if (entry[1] === null || entry[1] === "") return undefined;
  return { id, title, valueKey: entry[0], ...decodeValue(entry[0], entry[1]) };
}

function decodeValue(key: string, payload: unknown): Pick<DecodedField, "kind" | "text" | "address" | "account" | "detail" | "linkedItemUuid"> {
  if (key === "concealed") return { kind: "hidden", text: asString(payload) };
  if (key === "totp") return { kind: "totp", text: asString(payload) };
  // 1Password 8 writes "Sign in with" as a field titled "sign in with" whose value key is
  // ssoLogin; older builds used sso. Any key naming SSO is read the same way.
  if (key === "sso" || /sso/iu.test(key)) {
    const account = ssoAccount(payload);
    // 1Password 8 links the field to the provider account's own item ({ item: { itemUuid } }).
    const linked = isRecord(payload) && isRecord(payload["item"]) ? asString(payload["item"]["itemUuid"]).trim() : "";
    return {
      kind: "sso",
      text: ssoProviderName(payload),
      ...(account === "" ? {} : { account }),
      ...(linked === "" ? {} : { linkedItemUuid: linked }),
    };
  }
  if (key === "passkey" || looksLikePasskey(payload)) return { kind: "passkey", text: "" };
  if (key === "file") return { kind: "attachment", text: attachmentName(payload) };
  if (key === "reference") return { kind: "reference", text: asString(payload) };
  // Dates arrive as Unix seconds, as digit strings, or wrapped in an object; a month-year as
  // YYYYMM the same three ways.
  if (key === "date" || key === "monthYear") {
    const numeric = numberWithin(payload);
    if (numeric !== undefined) return { kind: "text", text: key === "date" ? isoDateOf(numeric) : monthYearOf(numeric) };
    if (typeof payload === "string" && payload.trim() !== "") return { kind: "text", text: payload.trim() };
  }
  if (key === "address" && isRecord(payload)) return decodeAddress(payload);
  if (key === "email" && isRecord(payload))
    return { kind: "text", text: asString(payload["email_address"]) || asString(payload["email"]) };
  if (typeof payload === "string") return { kind: "text", text: payload };
  if (typeof payload === "number" && Number.isFinite(payload)) return { kind: "text", text: String(payload) };
  if (typeof payload === "boolean") return { kind: "boolean", text: payload ? "true" : "false" };
  return { kind: "unsupported", text: "", detail: `${key}: ${describePayload(payload)}` };
}

function decodeAddress(payload: Record<string, unknown>): Pick<DecodedField, "kind" | "text" | "address"> {
  const address: Record<string, string> = {};
  for (const part of ADDRESS_PARTS) address[part] = asString(payload[part]).trim();
  const text = ADDRESS_PARTS.map((part) => address[part] ?? "")
    .filter((part) => part !== "")
    .join(", ");
  return { kind: "text", text, address };
}

/** A passkey is an object carrying a credential id and a private key, whatever key it hangs from. */
function looksLikePasskey(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  const hasKey = "privateKey" in payload || "credentialId" in payload;
  const hasParty = "rpId" in payload || "userHandle" in payload || "userName" in payload;
  return hasKey && hasParty;
}

function attachmentName(payload: unknown): string {
  if (!isRecord(payload)) return "";
  return asString(payload["fileName"]) || asString(payload["name"]) || asString(payload["documentId"]);
}

/**
 * The provider inside an `sso` value: a string, or an object naming it under one of several
 * plausible keys (1Password does not document this value; every shape seen is accepted).
 */
function ssoProviderName(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (!isRecord(payload)) return "";
  for (const key of SSO_PROVIDER_KEYS) {
    const candidate = payload[key];
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate;
    if (isRecord(candidate) && typeof candidate["name"] === "string") return candidate["name"];
  }
  // Unknown keys: any string (or nested name) that reads as a provider we list, else the first
  // string that is not an e-mail address.
  const strings = stringsWithin(payload);
  return strings.find((value) => providerOf(value) !== undefined) ?? strings.find((value) => !value.includes("@")) ?? "";
}

/** The account the provider login is for, when the payload carries an e-mail address. */
function ssoAccount(payload: unknown): string {
  if (!isRecord(payload)) return "";
  return stringsWithin(payload).find((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) ?? "";
}

function stringsWithin(payload: Record<string, unknown>, depth = 0): string[] {
  const out: string[] = [];
  for (const value of Object.values(payload)) {
    if (typeof value === "string" && value.trim() !== "") out.push(value.trim());
    else if (isRecord(value) && depth < 2) out.push(...stringsWithin(value, depth + 1));
  }
  return out;
}

/** 1Password dates are Unix seconds at noon UTC; only the calendar day is meaningful. */
export function isoDateOf(seconds: number): string {
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

/** A `monthYear` is the number YYYYMM (203012 for December 2030). */
function monthYearOf(value: number): string {
  const digits = String(Math.trunc(value));
  if (digits.length !== 6) return digits;
  return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

/**
 * Whether the login signs in through a provider rather than a password. 1Password 8 does not
 * document how it writes this, so every plausible shape is checked: an `sso` field value, a
 * field titled "Sign in with …" whose value or title names the provider, or a captured form
 * field typed SSO. A username at a provider's e-mail domain is deliberately not a signal.
 */
export function detectSignInWith(
  loginFields: readonly LoginField[],
  fields: readonly DecodedField[],
): SignInWith | undefined {
  const sso = fields.find((field) => field.kind === "sso");
  if (sso !== undefined)
    return {
      ...resolveProvider(sso.text),
      field: sso,
      ...(sso.account === undefined ? {} : { account: sso.account }),
      ...(sso.linkedItemUuid === undefined ? {} : { linkedItemUuid: sso.linkedItemUuid }),
    };

  const titled = fields.find(
    (field) =>
      (field.kind === "text" || field.kind === "hidden") &&
      (SIGN_IN_WITH.test(field.title) || SIGN_IN_WITH.test(field.id)),
  );
  if (titled !== undefined) {
    const remainder = titled.title.replace(SIGN_IN_WITH, "").trim();
    // An e-mail address as the value is the account, not the provider.
    const fromValue = titled.text.includes("@") ? undefined : providerOf(titled.text);
    const provider = fromValue ?? providerOf(remainder);
    const name = fromValue !== undefined || remainder === "" ? titled.text.trim() : remainder;
    return { provider: provider ?? "other", name, field: titled };
  }

  const captured = loginFields.find(
    (field) => field.fieldType.toUpperCase() === "SSO" || field.designation.toLowerCase() === "sso",
  );
  if (captured !== undefined) {
    const fromValue = captured.value.includes("@") ? undefined : providerOf(captured.value);
    const fromName = providerOf(captured.name.replace(SIGN_IN_WITH, ""));
    const provider = fromValue ?? fromName;
    return {
      provider: provider ?? "other",
      name: fromValue !== undefined ? captured.value.trim() : captured.name.trim() || captured.value.trim(),
    };
  }
  return undefined;
}

function resolveProvider(name: string): Pick<SignInWith, "provider" | "name"> {
  return { provider: providerOf(name) ?? "other", name: name.trim() };
}

/** A number in a payload: the value itself, a digit string, or the first such thing inside an object. */
function numberWithin(payload: unknown): number | undefined {
  if (typeof payload === "number" && Number.isFinite(payload)) return payload;
  if (typeof payload === "string" && /^\d{1,12}$/u.test(payload.trim())) return Number(payload.trim());
  if (!isRecord(payload)) return undefined;
  for (const value of Object.values(payload)) {
    const found = numberWithin(value);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** "object with keys a, b", "string", "null": shape only, never content. */
function describePayload(payload: unknown): string {
  if (payload === null) return "null";
  if (Array.isArray(payload)) return `array of ${payload.length}`;
  if (isRecord(payload)) return `object with keys ${Object.keys(payload).slice(0, 6).join(", ") || "none"}`;
  return typeof payload;
}
