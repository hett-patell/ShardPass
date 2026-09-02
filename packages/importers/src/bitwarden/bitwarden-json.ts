import {
  CardItemSchema,
  IdentityItemSchema,
  LoginItemSchema,
  NoteItemSchema,
} from "@shardpass/domain";

import { newItemBase } from "../common/item-base";
import type { ImportResult } from "../common/import-result";
import { IMPORT_LIMITS } from "../import-model";

const BITWARDEN_TYPE_LOGIN = 1;
const BITWARDEN_TYPE_NOTE = 2;
const BITWARDEN_TYPE_CARD = 3;
const BITWARDEN_TYPE_IDENTITY = 4;

/**
 * Imports a Bitwarden JSON vault export: `{ items: [{ type, name, login,
 * notes, card, identity, secureNote }] }`. Bitwarden `type` values map as
 * 1=login, 2=secure note, 3=card, 4=identity; any other value (or a
 * malformed entry) is reported as a warning rather than aborting the import.
 */
export function importBitwardenJson(text: string): ImportResult {
  const items: ImportResult["items"] = [];
  const warnings: string[] = [];

  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    warnings.push("Invalid JSON: could not parse Bitwarden export");
    return { items, warnings };
  }

  const rawItems = isRecord(root) ? root["items"] : undefined;
  if (!Array.isArray(rawItems)) {
    warnings.push('Invalid Bitwarden export: missing top-level "items" array');
    return { items, warnings };
  }

  const truncated = rawItems.length > IMPORT_LIMITS.maxEntries;
  const bounded = truncated ? rawItems.slice(0, IMPORT_LIMITS.maxEntries) : rawItems;
  if (truncated)
    warnings.push(
      `Only the first ${IMPORT_LIMITS.maxEntries} items were imported; ${
        rawItems.length - IMPORT_LIMITS.maxEntries
      } item(s) were skipped.`,
    );

  for (const [index, raw] of bounded.entries()) {
    if (!isRecord(raw)) {
      warnings.push(`Skipped entry ${index + 1}: not an object`);
      continue;
    }

    const label = asString(raw["name"]) || `unnamed entry ${index + 1}`;
    const name = asString(raw["name"]).trim() || "Imported item";
    const notes = asString(raw["notes"]);
    const favorite = raw["favorite"] === true;
    const base = { ...newItemBase(), favorite };

    switch (raw["type"]) {
      case BITWARDEN_TYPE_LOGIN: {
        const login = isRecord(raw["login"]) ? raw["login"] : {};
        const uris = Array.isArray(login["uris"]) ? login["uris"] : [];
        const urls = uris
          .map((entry) => (isRecord(entry) ? asString(entry["uri"]) : ""))
          .filter((uri) => uri.length > 0);

        const candidate = {
          ...base,
          kind: "login" as const,
          name,
          username: asString(login["username"]),
          password: asString(login["password"]),
          urls,
          notes,
        };
        const parsed = LoginItemSchema.safeParse(candidate);
        if (!parsed.success) {
          warnings.push(`Skipped "${label}": invalid login item`);
          continue;
        }
        items.push(parsed.data);
        break;
      }
      case BITWARDEN_TYPE_NOTE: {
        const candidate = {
          ...base,
          kind: "note" as const,
          name,
          content: notes,
        };
        const parsed = NoteItemSchema.safeParse(candidate);
        if (!parsed.success) {
          warnings.push(`Skipped "${label}": invalid note item`);
          continue;
        }
        items.push(parsed.data);
        break;
      }
      case BITWARDEN_TYPE_CARD: {
        const card = isRecord(raw["card"]) ? raw["card"] : {};
        const candidate = {
          ...base,
          kind: "card" as const,
          name,
          cardholderName: asString(card["cardholderName"]),
          number: asString(card["number"]),
          expMonth: asString(card["expMonth"]),
          expYear: asString(card["expYear"]),
          cvv: asString(card["code"]),
          pin: "",
          notes,
        };
        const parsed = CardItemSchema.safeParse(candidate);
        if (!parsed.success) {
          warnings.push(`Skipped "${label}": invalid card item`);
          continue;
        }
        items.push(parsed.data);
        break;
      }
      case BITWARDEN_TYPE_IDENTITY: {
        const identity = isRecord(raw["identity"]) ? raw["identity"] : {};
        const street = [asString(identity["address1"]), asString(identity["address2"])]
          .filter((line) => line.length > 0)
          .join(", ");
        const candidate = {
          ...base,
          kind: "identity" as const,
          name,
          firstName: asString(identity["firstName"]),
          lastName: asString(identity["lastName"]),
          email: asString(identity["email"]),
          phone: asString(identity["phone"]),
          street,
          city: asString(identity["city"]),
          state: asString(identity["state"]),
          zip: asString(identity["postalCode"]),
          country: asString(identity["country"]),
          notes,
        };
        const parsed = IdentityItemSchema.safeParse(candidate);
        if (!parsed.success) {
          warnings.push(`Skipped "${label}": invalid identity item`);
          continue;
        }
        items.push(parsed.data);
        break;
      }
      default:
        warnings.push(`Skipped "${label}": unsupported Bitwarden item type ${String(raw["type"])}`);
    }
  }

  return { items, warnings };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
