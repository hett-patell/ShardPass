import {
  CARD_BRANDS,
  CardItemSchema,
  IdentityItemSchema,
  MAX_CARD_HOLDER_LENGTH,
  MAX_CARD_NAME_LENGTH,
  MAX_CARD_NOTES_LENGTH,
  MAX_CARD_NUMBER_LENGTH,
  MAX_IDENTITY_NAME_LENGTH,
  MAX_IDENTITY_NOTES_LENGTH,
  MAX_NOTE_CONTENT_LENGTH,
  MAX_NOTE_NAME_LENGTH,
  NoteItemSchema,
  type CardBrand,
  type VaultItem,
} from "@shardpass/domain";

import { clampName, clampText, keepIfValid } from "./clamp";
import { IMPORT_LIMITS } from "../import-model";
import type { NewItemBase } from "./item-base";

/** Item metadata an importer has already decided on: timestamps, folder, favourite, tags. */
export type TypedBase = NewItemBase & Readonly<{ folderId?: string; archivedAt?: string }>;

export type NoteDraft = Readonly<{ name: string; content: string }>;
export type CardDraft = Readonly<{
  name: string;
  cardholderName?: string;
  number?: string;
  expMonth?: string;
  expYear?: string;
  cvv?: string;
  pin?: string;
  brand?: string;
  notes?: string;
}>;
export type IdentityDraft = Readonly<{
  name: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  company?: string;
  username?: string;
  birthDate?: string;
  email?: string;
  phone?: string;
  street?: string;
  address2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  passportNumber?: string;
  licenseNumber?: string;
  nationalId?: string;
  notes?: string;
}>;

/** Cuts a source's rows to the import cap and says how many were left behind. */
export function boundEntries<T>(entries: readonly T[], warnings: string[], what = "row"): T[] {
  const limit = IMPORT_LIMITS.maxThirdPartyEntries;
  if (entries.length <= limit) return [...entries];
  warnings.push(
    `Only the first ${limit} ${what}s were imported; ${entries.length - limit} ${what}(s) were skipped.`,
  );
  return entries.slice(0, limit);
}

export function emitNote(
  base: TypedBase,
  draft: NoteDraft,
  label: string,
  warnings: string[],
  items: VaultItem[],
): boolean {
  const candidate = {
    ...base,
    kind: "note" as const,
    name: clampName(draft.name, MAX_NOTE_NAME_LENGTH, "Imported note", label, warnings),
    content: clampText(draft.content, MAX_NOTE_CONTENT_LENGTH, "content", label, warnings),
  };
  return keepIfValid(NoteItemSchema, candidate, "note", label, warnings, items);
}

export function emitCard(
  base: TypedBase,
  draft: CardDraft,
  label: string,
  warnings: string[],
  items: VaultItem[],
): boolean {
  const number = clampText(
    (draft.number ?? "").replace(/\s/gu, ""),
    MAX_CARD_NUMBER_LENGTH,
    "card number",
    label,
    warnings,
  );
  const brand = cardBrand(draft.brand, number);
  const candidate = {
    ...base,
    kind: "card" as const,
    name: clampName(draft.name, MAX_CARD_NAME_LENGTH, "Imported card", label, warnings),
    ...(brand === undefined ? {} : { brand }),
    cardholderName: clampText(
      draft.cardholderName ?? "",
      MAX_CARD_HOLDER_LENGTH,
      "cardholder name",
      label,
      warnings,
    ),
    number,
    expMonth: dateField(
      twoDigitMonth(draft.expMonth ?? ""),
      MONTH_PATTERN,
      "expiry month",
      label,
      warnings,
    ),
    expYear: dateField(
      fourDigitYear(draft.expYear ?? ""),
      YEAR_PATTERN,
      "expiry year",
      label,
      warnings,
    ),
    cvv: clampText((draft.cvv ?? "").trim(), 8, "security code", label, warnings),
    pin: clampText((draft.pin ?? "").trim(), 16, "PIN", label, warnings),
    notes: clampText(draft.notes ?? "", MAX_CARD_NOTES_LENGTH, "notes", label, warnings),
  };
  return keepIfValid(CardItemSchema, candidate, "card", label, warnings, items);
}

export function emitIdentity(
  base: TypedBase,
  draft: IdentityDraft,
  label: string,
  warnings: string[],
  items: VaultItem[],
): boolean {
  const text = (value: string | undefined, maximum: number, field: string) =>
    clampText((value ?? "").trim(), maximum, field, label, warnings);
  const optional = (key: string, value: string | undefined, maximum: number) => {
    const trimmed = (value ?? "").trim();
    return trimmed === "" ? {} : { [key]: text(trimmed, maximum, key) };
  };
  const candidate = {
    ...base,
    kind: "identity" as const,
    name: clampName(draft.name, MAX_IDENTITY_NAME_LENGTH, "Imported identity", label, warnings),
    firstName: text(draft.firstName, 256, "first name"),
    ...optional("middleName", draft.middleName, 256),
    lastName: text(draft.lastName, 256, "last name"),
    ...optional("company", draft.company, 256),
    ...optional("username", draft.username, 256),
    ...optional("birthDate", draft.birthDate, 32),
    email: text(draft.email, 256, "email"),
    phone: text(draft.phone, 64, "phone"),
    street: text(draft.street, 512, "street"),
    ...optional("address2", draft.address2, 512),
    city: text(draft.city, 256, "city"),
    state: text(draft.state, 256, "state"),
    zip: text(draft.zip, 32, "postal code"),
    country: text(draft.country, 256, "country"),
    ...optional("passportNumber", draft.passportNumber, 64),
    ...optional("licenseNumber", draft.licenseNumber, 64),
    ...optional("nationalId", draft.nationalId, 64),
    notes: clampText(draft.notes ?? "", MAX_IDENTITY_NOTES_LENGTH, "notes", label, warnings),
  };
  return keepIfValid(IdentityItemSchema, candidate, "identity", label, warnings, items);
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** "3", "03", "March", "mar" → "03"; anything else is passed through trimmed. */
const MONTH_PATTERN = /^(?:0[1-9]|1[0-2])$/u;
const YEAR_PATTERN = /^\d{4}$/u;

/** A month or year that is not one is left blank and named, never shortened into another date. */
function dateField(
  value: string,
  pattern: RegExp,
  field: string,
  label: string,
  warnings: string[],
): string {
  if (value === "" || pattern.test(value)) return value;
  warnings.push(`"${label}": ${field} was not a valid ${field.split(" ")[1]} and was left blank.`);
  return "";
}

export function twoDigitMonth(value: string): string {
  const trimmed = value.trim();
  if (/^\d{1,2}$/u.test(trimmed)) {
    const month = Number(trimmed);
    return month >= 1 && month <= 12 ? String(month).padStart(2, "0") : trimmed;
  }
  const index = MONTHS.findIndex((month) => month.startsWith(trimmed.toLowerCase().slice(0, 3)));
  return trimmed.length >= 3 && index >= 0 ? String(index + 1).padStart(2, "0") : trimmed;
}

/** "27" → "2027", "2027" stays; anything else is passed through trimmed. */
export function fourDigitYear(value: string): string {
  const trimmed = value.trim();
  if (/^\d{2}$/u.test(trimmed)) return `20${trimmed}`;
  return trimmed;
}

/**
 * Splits the expiry forms exports use: "MM/YY", "MM/YYYY", "YYYY-MM", "MM-YYYY", "March,2027",
 * "03 2027". Returns empty parts for anything it cannot read, so the item still imports.
 */
export function splitExpiry(value: string): { expMonth: string; expYear: string } {
  const trimmed = value.trim();
  if (trimmed === "") return { expMonth: "", expYear: "" };
  const iso = /^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/u.exec(trimmed);
  if (iso) return { expMonth: twoDigitMonth(iso[2]!), expYear: iso[1]! };
  const parts = trimmed.split(/[\s,/.-]+/u).filter((part) => part !== "");
  if (parts.length >= 2) {
    const [month, year] = [parts[0]!, parts[parts.length - 1]!];
    if (/^\d{4}$/u.test(month)) return { expMonth: twoDigitMonth(year), expYear: month };
    return { expMonth: twoDigitMonth(month), expYear: fourDigitYear(year) };
  }
  const only = parts.length === 1 ? (parts[0] ?? "") : "";
  // "January," names a month alone; ",2020" a year alone.
  if (/^[a-z]{3,}$/iu.test(only)) {
    const month = twoDigitMonth(only);
    return /^\d{2}$/u.test(month)
      ? { expMonth: month, expYear: "" }
      : { expMonth: "", expYear: "" };
  }
  if (/^\d{4}$/u.test(only)) {
    // "0327" (MMYY) is ambiguous with a bare year; only a plausible month is split.
    const month = Number(only.slice(0, 2));
    return month >= 1 && month <= 12
      ? { expMonth: only.slice(0, 2), expYear: `20${only.slice(2)}` }
      : { expMonth: "", expYear: only };
  }
  return { expMonth: "", expYear: "" };
}

/** The brand the export names, else the one the number's prefix implies. */
export function cardBrand(named: string | undefined, number: string): CardBrand | undefined {
  const key = (named ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/gu, "");
  if (key !== "") {
    if (key.startsWith("visa")) return "visa";
    if (key.startsWith("master") || key === "mc") return "mastercard";
    if (key.startsWith("amex") || key.startsWith("americanexpress")) return "amex";
    if (key.startsWith("discover")) return "discover";
    if (key.startsWith("jcb")) return "jcb";
    if (key.startsWith("unionpay") || key.startsWith("cup")) return "unionpay";
    if ((CARD_BRANDS as readonly string[]).includes(key)) return key as CardBrand;
  }
  const digits = number.replace(/\D/gu, "");
  if (digits === "") return key === "" ? undefined : "other";
  if (digits.startsWith("4")) return "visa";
  if (/^(5[1-5]|2[2-7])/u.test(digits)) return "mastercard";
  if (/^3[47]/u.test(digits)) return "amex";
  if (/^(6011|65|64[4-9])/u.test(digits)) return "discover";
  if (/^35/u.test(digits)) return "jcb";
  if (/^62/u.test(digits)) return "unionpay";
  return key === "" ? undefined : "other";
}

/** Splits a folder path on the separators exports use, dropping empty and placeholder parts. */
export function folderPath(value: string, separator: RegExp = /[\\/]/u): string[] {
  return value
    .split(separator)
    .map((part) => part.trim())
    .filter((part) => part !== "" && part.toLowerCase() !== "(none)");
}

/** "1", "true", "yes", "y" → true. */
export function truthy(value: string): boolean {
  return ["1", "true", "yes", "y"].includes(value.trim().toLowerCase());
}
