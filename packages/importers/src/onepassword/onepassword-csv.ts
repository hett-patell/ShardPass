import {
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
} from "@shardpass/domain";

import { clampName, clampText, keepIfValid, normalizeTags, warningLabel } from "../common/clamp";

// What CardItemSchema bounds these small fields to; longer values are cut, with a notice.
const MAX_CARD_EXP_MONTH_LENGTH = 2;
const MAX_CARD_EXP_YEAR_LENGTH = 4;
const MAX_CARD_CVV_LENGTH = 8;
const MAX_CARD_PIN_LENGTH = 16;
import { buildHeaderIndex, pickField } from "../common/csv-fields";
import { parseCsv } from "../common/csv-parser";
import { newItemBase } from "../common/item-base";
import type { ImportResult } from "../common/import-result";
import { emitLogin } from "../common/login-candidate";
import { IMPORT_LIMITS } from "../import-model";

type OnePasswordKind = "login" | "note" | "card" | "identity";

/**
 * Imports a 1Password CSV export. Column names vary by 1Password version and
 * item category, so columns are matched case-insensitively with several
 * known aliases. The optional `Type` column selects the item kind (login,
 * secure note, credit card, identity); when absent, every row is treated as
 * a login, which covers the common single-category login export.
 *
 * 1Password 8 writes only logins to CSV, and its file has no `Type` column;
 * cards, identities and notes never reach this importer from that version.
 */
export function importOnePasswordCsv(text: string): ImportResult {
  const { headers, rows } = parseCsv(text);
  const items: ImportResult["items"] = [];
  const warnings: string[] = [];
  const headerIndex = buildHeaderIndex(headers);

  const limit = IMPORT_LIMITS.maxThirdPartyEntries;
  const truncated = rows.length > limit;
  const bounded = truncated ? rows.slice(0, limit) : rows;
  if (truncated)
    warnings.push(
      `Only the first ${limit} rows were imported; ${rows.length - limit} row(s) were skipped.`,
    );

  for (const row of bounded) {
    const title = pickField(row, headerIndex, "title", "name").trim();
    const label = warningLabel(title, "unnamed");
    const kind = classifyRow(pickField(row, headerIndex, "type"));
    const fresh = newItemBase();

    const favorite = truthy(pickField(row, headerIndex, "favorite", "favourite"));
    const archived = truthy(pickField(row, headerIndex, "archived"));
    const tags = normalizeTags(splitTags(pickField(row, headerIndex, "tags")), label, warnings);
    const base = {
      ...fresh,
      favorite,
      tags,
      ...(archived ? { archivedAt: fresh.updatedAt } : {}),
    };
    const notes = pickField(row, headerIndex, "notesplain", "notes", "note");

    if (kind === "login") {
      const password = pickField(row, headerIndex, "password");
      // A login without a password (passkey-only, username-only) is still worth keeping:
      // the username, site and notes are what the person will look for.
      if (!password)
        warnings.push(`"${label}": imported without a password (the export has none).`);
      const totp = pickField(row, headerIndex, "otpauth", "one-time password", "totp").trim();
      emitLogin(
        base,
        {
          name: title || "Imported item",
          username: pickField(row, headerIndex, "username", "user name"),
          password,
          urls: splitUrls(pickField(row, headerIndex, "url", "website", "login_uri", "urls")),
          ...(totp === "" ? {} : { totp }),
          notes: pickField(row, headerIndex, "notes", "notesplain", "note"),
        },
        label,
        warnings,
        items,
      );
      continue;
    }

    if (kind === "note") {
      const candidate = {
        ...base,
        kind: "note" as const,
        name: clampName(title, MAX_NOTE_NAME_LENGTH, "Imported item", label, warnings),
        content: clampText(notes, MAX_NOTE_CONTENT_LENGTH, "content", label, warnings),
      };
      keepIfValid(NoteItemSchema, candidate, "note", label, warnings, items);
      continue;
    }

    if (kind === "card") {
      const { month, year } = splitExpiry(
        pickField(row, headerIndex, "expmonth"),
        pickField(row, headerIndex, "expyear"),
        pickField(row, headerIndex, "expiry", "expiration date"),
      );
      const candidate = {
        ...base,
        kind: "card" as const,
        name: clampName(title, MAX_CARD_NAME_LENGTH, "Imported item", label, warnings),
        cardholderName: clampText(
          pickField(row, headerIndex, "cardholder name", "cardholdername"),
          MAX_CARD_HOLDER_LENGTH,
          "cardholder name",
          label,
          warnings,
        ),
        number: clampText(
          pickField(row, headerIndex, "ccnum", "number", "card number"),
          MAX_CARD_NUMBER_LENGTH,
          "card number",
          label,
          warnings,
        ),
        expMonth: clampText(month, MAX_CARD_EXP_MONTH_LENGTH, "expiry month", label, warnings),
        expYear: clampText(year, MAX_CARD_EXP_YEAR_LENGTH, "expiry year", label, warnings),
        cvv: clampText(
          pickField(row, headerIndex, "cvv", "security code"),
          MAX_CARD_CVV_LENGTH,
          "security code",
          label,
          warnings,
        ),
        pin: clampText(
          pickField(row, headerIndex, "pin"),
          MAX_CARD_PIN_LENGTH,
          "PIN",
          label,
          warnings,
        ),
        notes: clampText(notes, MAX_CARD_NOTES_LENGTH, "notes", label, warnings),
      };
      keepIfValid(CardItemSchema, candidate, "card", label, warnings, items);
      continue;
    }

    // identity
    const candidate = {
      ...base,
      kind: "identity" as const,
      name: clampName(title, MAX_IDENTITY_NAME_LENGTH, "Imported item", label, warnings),
      firstName: pickField(row, headerIndex, "first name", "firstname"),
      lastName: pickField(row, headerIndex, "last name", "lastname"),
      email: pickField(row, headerIndex, "email"),
      phone: pickField(row, headerIndex, "default phone", "phone", "phone number"),
      street: pickField(row, headerIndex, "address (street)", "address", "street"),
      city: pickField(row, headerIndex, "city"),
      state: pickField(row, headerIndex, "state", "state/province"),
      zip: pickField(row, headerIndex, "zip", "zip/postal code", "postal code"),
      country: pickField(row, headerIndex, "country"),
      notes: clampText(notes, MAX_IDENTITY_NOTES_LENGTH, "notes", label, warnings),
    };
    keepIfValid(IdentityItemSchema, candidate, "identity", label, warnings, items);
  }

  return { items, warnings };
}

function truthy(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "y";
}

/** 1Password writes tags comma- or semicolon-separated in one cell. */
function splitTags(value: string): string[] {
  return value
    .split(/[,;]/u)
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
}

const URL_START = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.|[\w-]+(?:\.[\w-]+)+)/iu;

/**
 * A 1Password item with several websites lands in one cell, separated by newlines or
 * commas. Commas also appear inside query strings, so a comma only splits when every piece
 * around it starts like an address of its own.
 */
function splitUrls(cell: string): string[] {
  const urls: string[] = [];
  for (const token of cell.split(/\s+/u)) {
    let current = "";
    for (const piece of token.split(",")) {
      if (piece === "") continue;
      if (current !== "" && !URL_START.test(piece)) {
        current = `${current},${piece}`;
        continue;
      }
      if (current !== "") urls.push(current);
      current = piece;
    }
    if (current !== "") urls.push(current);
  }
  return urls;
}

function classifyRow(rawType: string): OnePasswordKind {
  const type = rawType.trim().toLowerCase();
  if (type.includes("note")) return "note";
  if (type.includes("card")) return "card";
  if (type.includes("identity")) return "identity";
  return "login";
}

function splitExpiry(
  monthField: string,
  yearField: string,
  combinedField: string,
): { month: string; year: string } {
  if (monthField || yearField) return { month: monthField, year: yearField };
  const digits = combinedField.replace(/\D/gu, "");
  // Six digits are MMYYYY unless they start like a year (no month starts with 19 or 20).
  if (digits.length === 6)
    return /^(?:19|20)/u.test(digits)
      ? { month: digits.slice(4), year: digits.slice(0, 4) }
      : { month: digits.slice(0, 2), year: digits.slice(2) };
  if (digits.length === 4) return { month: digits.slice(0, 2), year: `20${digits.slice(2)}` };
  return { month: "", year: "" };
}
