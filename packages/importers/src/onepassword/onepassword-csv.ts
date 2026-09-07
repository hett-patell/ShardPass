import {
  CardItemSchema,
  IdentityItemSchema,
  LoginItemSchema,
  NoteItemSchema,
} from "@shardpass/domain";

import { buildHeaderIndex, pickField } from "../common/csv-fields";
import { parseCsv } from "../common/csv-parser";
import { newItemBase } from "../common/item-base";
import type { ImportResult } from "../common/import-result";
import { IMPORT_LIMITS } from "../import-model";

type OnePasswordKind = "login" | "note" | "card" | "identity";

/**
 * Imports a 1Password CSV export. Column names vary by 1Password version and
 * item category, so columns are matched case-insensitively with several
 * known aliases. The optional `Type` column selects the item kind (login,
 * secure note, credit card, identity); when absent, every row is treated as
 * a login, which covers the common single-category login export.
 */
export function importOnePasswordCsv(text: string): ImportResult {
  const { headers, rows } = parseCsv(text);
  const items: ImportResult["items"] = [];
  const warnings: string[] = [];
  const headerIndex = buildHeaderIndex(headers);

  const truncated = rows.length > IMPORT_LIMITS.maxEntries;
  const bounded = truncated ? rows.slice(0, IMPORT_LIMITS.maxEntries) : rows;
  if (truncated)
    warnings.push(
      `Only the first ${IMPORT_LIMITS.maxEntries} rows were imported; ${
        rows.length - IMPORT_LIMITS.maxEntries
      } row(s) were skipped.`,
    );

  for (const row of bounded) {
    const title = pickField(row, headerIndex, "title", "name").trim();
    const label = title || "unnamed";
    const kind = classifyRow(pickField(row, headerIndex, "type"));
    const base = newItemBase();
    const name = title || "Imported item";

    const favorite = truthy(pickField(row, headerIndex, "favorite", "favourite"));
    const archived = truthy(pickField(row, headerIndex, "archived"));
    const tags = splitTags(pickField(row, headerIndex, "tags"));
    Object.assign(base, {
      favorite,
      tags,
      ...(archived ? { archivedAt: base.updatedAt } : {}),
    });

    if (kind === "login") {
      const password = pickField(row, headerIndex, "password");
      // A login without a password (passkey-only, username-only) is still worth keeping:
      // the username, site and notes are what the person will look for.
      if (!password) warnings.push(`"${label}": imported without a password (the export has none).`);
      const url = pickField(row, headerIndex, "url", "website", "login_uri", "urls").trim();
      const totp = pickField(row, headerIndex, "otpauth", "one-time password", "totp").trim();
      const candidate = {
        ...base,
        kind: "login" as const,
        name,
        username: pickField(row, headerIndex, "username", "user name"),
        password,
        urls: url ? [url] : [],
        ...(totp === "" ? {} : { totp }),
        notes: pickField(row, headerIndex, "notes", "notesplain", "note"),
      };
      const parsed = LoginItemSchema.safeParse(candidate);
      if (!parsed.success) {
        warnings.push(`Skipped "${label}": invalid login item`);
        continue;
      }
      items.push(parsed.data);
      continue;
    }

    if (kind === "note") {
      const candidate = {
        ...base,
        kind: "note" as const,
        name,
        content: pickField(row, headerIndex, "notesplain", "notes", "note"),
      };
      const parsed = NoteItemSchema.safeParse(candidate);
      if (!parsed.success) {
        warnings.push(`Skipped "${label}": invalid note item`);
        continue;
      }
      items.push(parsed.data);
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
        name,
        cardholderName: pickField(row, headerIndex, "cardholder name", "cardholdername"),
        number: pickField(row, headerIndex, "ccnum", "number", "card number"),
        expMonth: month,
        expYear: year,
        cvv: pickField(row, headerIndex, "cvv", "security code"),
        pin: pickField(row, headerIndex, "pin"),
        notes: pickField(row, headerIndex, "notesplain", "notes", "note"),
      };
      const parsed = CardItemSchema.safeParse(candidate);
      if (!parsed.success) {
        warnings.push(`Skipped "${label}": invalid card item`);
        continue;
      }
      items.push(parsed.data);
      continue;
    }

    // identity
    const candidate = {
      ...base,
      kind: "identity" as const,
      name,
      firstName: pickField(row, headerIndex, "first name", "firstname"),
      lastName: pickField(row, headerIndex, "last name", "lastname"),
      email: pickField(row, headerIndex, "email"),
      phone: pickField(row, headerIndex, "default phone", "phone", "phone number"),
      street: pickField(row, headerIndex, "address (street)", "address", "street"),
      city: pickField(row, headerIndex, "city"),
      state: pickField(row, headerIndex, "state", "state/province"),
      zip: pickField(row, headerIndex, "zip", "zip/postal code", "postal code"),
      country: pickField(row, headerIndex, "country"),
      notes: pickField(row, headerIndex, "notesplain", "notes", "note"),
    };
    const parsed = IdentityItemSchema.safeParse(candidate);
    if (!parsed.success) {
      warnings.push(`Skipped "${label}": invalid identity item`);
      continue;
    }
    items.push(parsed.data);
  }

  return { items, warnings };
}

function truthy(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "y";
}

/** 1Password writes tags comma- or semicolon-separated in one cell. */
function splitTags(value: string): string[] {
  return [...new Set(value.split(/[,;]/u).map((tag) => tag.trim()).filter((tag) => tag !== ""))];
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
  if (digits.length === 6) return { month: digits.slice(0, 2), year: digits.slice(2) };
  if (digits.length === 4) return { month: digits.slice(0, 2), year: `20${digits.slice(2)}` };
  return { month: "", year: "" };
}
