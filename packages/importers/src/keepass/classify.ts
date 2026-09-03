import {
  CardItemSchema,
  IdentityItemSchema,
  LoginItemSchema,
  MAX_CARD_HOLDER_LENGTH,
  MAX_CARD_NOTES_LENGTH,
  MAX_CARD_NUMBER_LENGTH,
  MAX_IDENTITY_NOTES_LENGTH,
  MAX_LOGIN_NAME_LENGTH,
  MAX_LOGIN_NOTES_LENGTH,
  MAX_LOGIN_PASSWORD_LENGTH,
  MAX_LOGIN_URL_LENGTH,
  MAX_LOGIN_URLS,
  MAX_LOGIN_USERNAME_LENGTH,
  MAX_NOTE_CONTENT_LENGTH,
  MAX_OTP_ISSUER_LENGTH,
  MAX_OTP_LABEL_LENGTH,
  MAX_SECRET_NOTES_LENGTH,
  MAX_SECRET_VALUE_LENGTH,
  NoteItemSchema,
  OtpItemSchema,
  SecretItemSchema,
  type VaultItem,
} from "@shardpass/domain";

import { clampText, looksLikeKeyMaterial, normalizeTags } from "../common/clamp";
import { newItemBase } from "../common/item-base";
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
  "first name", "firstname", "last name", "lastname", "date of birth",
  "passport", "national id", "social security", "ssn", "driver licence", "driver license",
];
const IDENTITY_TITLE_HINTS = ["passport", "identity", "driving licence", "driver license", "national id"];

const SSH_KEY_MARKER = "-----BEGIN";
const API_FIELD_HINTS = ["api key", "api-key", "apikey", "access key", "client secret", "secret key"];
const TOKEN_FIELD_HINTS = ["token", "bearer"];

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

function findField(entry: KeePassEntry, ...candidates: readonly string[]): string {
  for (const [key, value] of entry.custom) {
    const name = lower(key);
    if (candidates.some((candidate) => name === candidate || name.includes(candidate))) return value;
  }
  return "";
}

export function classifyEntry(entry: KeePassEntry): ClassifiedKind {
  if (hasFieldHint(entry, CARD_FIELD_HINTS) || hasTitleHint(entry, CARD_TITLE_HINTS)) return "card";
  if (hasFieldHint(entry, IDENTITY_FIELD_HINTS) || hasTitleHint(entry, IDENTITY_TITLE_HINTS))
    return "identity";

  // A key pasted into the Password field is common in KeePass; as a login it would exceed
  // the password ceiling and be rejected outright, so it is routed to a secret instead.
  if (looksLikeKeyMaterial(entry.password)) return "secret";
  if (Array.from(entry.password).length > MAX_LOGIN_PASSWORD_LENGTH) return "secret";
  const secretish = [...entry.custom.values()].some((value) => value.includes(SSH_KEY_MARKER));
  if (secretish || entry.notes.includes(SSH_KEY_MARKER)) return "secret";
  if (hasFieldHint(entry, API_FIELD_HINTS) || hasFieldHint(entry, TOKEN_FIELD_HINTS)) return "secret";

  if (entry.password !== "" || entry.username !== "" || entry.url !== "") return "login";
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

/** Renders leftover custom fields into notes so no imported data is silently lost. */
function appendCustomFields(entry: KeePassEntry, base: string, skip: ReadonlySet<string> = new Set()): string {
  const extras: string[] = [];
  for (const [key, value] of entry.custom) {
    if (skip.has(key)) continue;
    extras.push(`${key}: ${value}`);
  }
  if (entry.path.length > 0) extras.push(`KeePass group: ${entry.path.join(" / ")}`);
  if (extras.length === 0) return base;
  return base === "" ? extras.join("\n") : `${base}\n\n${extras.join("\n")}`;
}

export type ConversionOutcome = Readonly<{ items: VaultItem[]; warnings: string[] }>;

/**
 * Converts one KeePass entry into vault items. A single entry can yield two: an OTP item is
 * emitted alongside the login when the entry carries a TOTP secret, and the login links to it
 * via linkedOtpId.
 */
export function convertEntry(entry: KeePassEntry): ConversionOutcome {
  const items: VaultItem[] = [];
  const warnings: string[] = [];
  const label = entry.title.trim() === "" ? "(untitled)" : entry.title.trim();
  const name = clampText(
    entry.title.trim() === "" ? "Imported item" : entry.title.trim(),
    MAX_LOGIN_NAME_LENGTH,
    "name",
    label,
    warnings,
  );
  const tags = normalizeTags(entry.tags, label, warnings);

  let linkedOtpId: string | undefined;
  if (entry.otp !== "") {
    const otp = buildOtpItem(entry, name, tags, warnings, label);
    if (otp !== undefined) {
      items.push(otp);
      linkedOtpId = otp.id;
    }
  }

  const kind = classifyEntry(entry);
  const base = { ...newItemBase(), tags };

  if (kind === "card") {
    const candidate = {
      ...base,
      kind: "card" as const,
      name,
      cardholderName: clampText(findField(entry, "cardholder", "name on card"), MAX_CARD_HOLDER_LENGTH, "cardholder name", label, warnings),
      number: clampText(findField(entry, "card number", "cardnumber", "number"), MAX_CARD_NUMBER_LENGTH, "card number", label, warnings),
      expMonth: findField(entry, "expiry month", "exp month", "expmonth").slice(0, 2),
      expYear: findField(entry, "expiry year", "exp year", "expyear").slice(0, 4),
      cvv: findField(entry, "cvv", "cvc", "security code").slice(0, 8),
      pin: findField(entry, "pin").slice(0, 16),
      notes: clampText(appendCustomFields(entry, entry.notes), MAX_CARD_NOTES_LENGTH, "notes", label, warnings),
    };
    return finish(CardItemSchema, candidate, items, warnings, label, "card");
  }

  if (kind === "identity") {
    const candidate = {
      ...base,
      kind: "identity" as const,
      name,
      firstName: findField(entry, "first name", "firstname"),
      lastName: findField(entry, "last name", "lastname"),
      email: findField(entry, "email") || entry.username,
      phone: findField(entry, "phone", "mobile"),
      street: findField(entry, "street", "address"),
      city: findField(entry, "city"),
      state: findField(entry, "state", "province"),
      zip: findField(entry, "zip", "postal"),
      country: findField(entry, "country"),
      notes: clampText(appendCustomFields(entry, entry.notes), MAX_IDENTITY_NOTES_LENGTH, "notes", label, warnings),
    };
    return finish(IdentityItemSchema, candidate, items, warnings, label, "identity");
  }

  if (kind === "secret") {
    const secretType = secretTypeFor(entry);
    const value =
      [...entry.custom.values()].find((candidate) => candidate.includes(SSH_KEY_MARKER)) ??
      findField(entry, ...API_FIELD_HINTS, ...TOKEN_FIELD_HINTS) ??
      entry.password;
    const candidate = {
      ...base,
      kind: "secret" as const,
      name,
      secretType,
      value: clampText(value === "" ? entry.password : value, MAX_SECRET_VALUE_LENGTH, "value", label, warnings),
      metadata: {},
      notes: clampText(appendCustomFields(entry, entry.notes), MAX_SECRET_NOTES_LENGTH, "notes", label, warnings),
    };
    return finish(SecretItemSchema, candidate, items, warnings, label, "secret");
  }

  if (kind === "note") {
    const candidate = {
      ...base,
      kind: "note" as const,
      name,
      content: clampText(appendCustomFields(entry, entry.notes), MAX_NOTE_CONTENT_LENGTH, "content", label, warnings),
    };
    return finish(NoteItemSchema, candidate, items, warnings, label, "note");
  }

  const candidate = {
    ...base,
    kind: "login" as const,
    name,
    username: clampText(entry.username, MAX_LOGIN_USERNAME_LENGTH, "username", label, warnings),
    password: entry.password,
    urls: splitUrls(entry.url).slice(0, MAX_LOGIN_URLS).map((url) => clampText(url, MAX_LOGIN_URL_LENGTH, "URL", label, warnings)),
    notes: clampText(appendCustomFields(entry, entry.notes), MAX_LOGIN_NOTES_LENGTH, "notes", label, warnings),
    ...(linkedOtpId === undefined ? {} : { linkedOtpId }),
  };
  return finish(LoginItemSchema, candidate, items, warnings, label, "login");
}

function buildOtpItem(
  entry: KeePassEntry,
  name: string,
  tags: readonly string[],
  warnings: string[],
  label: string,
): VaultItem | undefined {
  try {
    const parsed = parseOtpAuthUri(entry.otp);
    const candidate = {
      ...newItemBase(),
      tags: [...tags],
      kind: "otp" as const,
      issuer: clampText(parsed.issuer === "" ? name : parsed.issuer, MAX_OTP_ISSUER_LENGTH, "issuer", label, warnings),
      label: clampText(
        parsed.label === "" ? (entry.username === "" ? name : entry.username) : parsed.label,
        MAX_OTP_LABEL_LENGTH,
        "label",
        label,
        warnings,
      ),
      secret: parsed.secret,
      otpType: parsed.otpType,
      algorithm: parsed.algorithm,
      digits: parsed.digits,
      period: parsed.period,
      note: "",
      ...(parsed.counter === undefined ? {} : { counter: parsed.counter }),
    };
    const result = OtpItemSchema.safeParse(candidate);
    if (result.success) return result.data;
    warnings.push(`"${label}": the one-time-code secret was not valid and was skipped.`);
    return undefined;
  } catch {
    warnings.push(`"${label}": the one-time-code secret could not be read and was skipped.`);
    return undefined;
  }
}

function finish(
  schema: { safeParse(value: unknown): { success: boolean; data?: unknown } },
  candidate: unknown,
  items: VaultItem[],
  warnings: string[],
  label: string,
  kind: string,
): ConversionOutcome {
  const parsed = schema.safeParse(candidate);
  if (parsed.success && parsed.data !== undefined) items.push(parsed.data as VaultItem);
  else warnings.push(`Skipped "${label}": could not be imported as a ${kind}.`);
  return { items, warnings };
}
