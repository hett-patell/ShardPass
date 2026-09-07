import {
  CardItemSchema,
  IdentityItemSchema,
  LoginItemSchema,
  NoteItemSchema,
  type CardBrand,
  type LoginCustomField,
  type LoginCustomFieldType,
  type LoginUrlMatchMode,
} from "@shardpass/domain";

import { newItemBase } from "../common/item-base";
import { createFolderIndex, type ImportResult } from "../common/import-result";
import { IMPORT_LIMITS } from "../import-model";

const BITWARDEN_TYPE_LOGIN = 1;
const BITWARDEN_TYPE_NOTE = 2;
const BITWARDEN_TYPE_CARD = 3;
const BITWARDEN_TYPE_IDENTITY = 4;

/** Bitwarden `uris[].match` values. Regex has no equivalent and falls back to domain. */
const URI_MATCH: Record<number, LoginUrlMatchMode> = {
  0: "domain",
  1: "host",
  2: "startsWith",
  3: "exact",
  5: "never",
};
/** Bitwarden `fields[].type`: 0 text, 1 hidden, 2 boolean, 3 linked. */
const FIELD_TYPE: Record<number, LoginCustomFieldType> = { 0: "text", 1: "hidden", 2: "boolean", 3: "linked" };
/** Bitwarden `fields[].linkedId` for logins: 100 username, 101 password. */
const LINKED_ID: Record<number, "username" | "password"> = { 100: "username", 101: "password" };
const CARD_BRAND: Record<string, CardBrand> = {
  visa: "visa",
  mastercard: "mastercard",
  amex: "amex",
  "american express": "amex",
  discover: "discover",
  jcb: "jcb",
  unionpay: "unionpay",
};

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

  if (isRecord(root) && root["encrypted"] === true) {
    warnings.push(
      "This is a password-protected Bitwarden export. Export again with the unencrypted .json format.",
    );
    return { items, warnings };
  }
  const rawItems = isRecord(root) ? root["items"] : undefined;
  if (!Array.isArray(rawItems)) {
    warnings.push('Invalid Bitwarden export: missing top-level "items" array');
    return { items, warnings };
  }
  // Bitwarden folders are flat records whose names may carry a path ("Work/Clients").
  const folderIndex = createFolderIndex();
  const folderIdByBitwardenId = new Map<string, string>();
  const rawFolders = isRecord(root) && Array.isArray(root["folders"]) ? root["folders"] : [];
  for (const folder of rawFolders) {
    if (!isRecord(folder)) continue;
    const id = asString(folder["id"]);
    const name = asString(folder["name"]);
    if (id === "" || name.trim() === "") continue;
    const provisional = folderIndex.idFor(name.split("/"));
    if (provisional !== undefined) folderIdByBitwardenId.set(id, provisional);
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
    const folderId = folderIdByBitwardenId.get(asString(raw["folderId"]));
    const fresh = newItemBase();
    const createdAt = isoOf(raw["creationDate"]) ?? fresh.createdAt;
    const base = {
      ...fresh,
      createdAt,
      updatedAt: isoOf(raw["revisionDate"]) ?? createdAt,
      favorite,
      ...(folderId === undefined ? {} : { folderId }),
    };

    switch (raw["type"]) {
      case BITWARDEN_TYPE_LOGIN: {
        const login = isRecord(raw["login"]) ? raw["login"] : {};
        const uris = Array.isArray(login["uris"]) ? login["uris"] : [];
        const kept = uris
          .map((entry) =>
            isRecord(entry)
              ? { uri: asString(entry["uri"]), match: URI_MATCH[asNumber(entry["match"])] ?? "domain" }
              : { uri: "", match: "domain" as const },
          )
          .filter((entry) => entry.uri.length > 0);
        const urls = kept.map((entry) => entry.uri);
        const urlMatches = kept.some((entry) => entry.match !== "domain")
          ? kept.map((entry) => entry.match)
          : undefined;
        const totp = asString(login["totp"]);
        const customFields = customFieldsOf(raw["fields"], warnings, label);
        const passwordHistory = passwordHistoryOf(raw["passwordHistory"]);

        const candidate = {
          ...base,
          kind: "login" as const,
          name,
          username: asString(login["username"]),
          password: asString(login["password"]),
          urls,
          ...(urlMatches === undefined ? {} : { urlMatches }),
          ...(totp === "" ? {} : { totp }),
          ...(customFields.length === 0 ? {} : { customFields }),
          ...(passwordHistory.length === 0 ? {} : { passwordHistory }),
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
          ...brandOf(asString(card["brand"])),
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
        const candidate = {
          ...base,
          kind: "identity" as const,
          name,
          firstName: asString(identity["firstName"]),
          ...optional("middleName", asString(identity["middleName"])),
          lastName: asString(identity["lastName"]),
          ...optional("company", asString(identity["company"])),
          ...optional("username", asString(identity["username"])),
          email: asString(identity["email"]),
          phone: asString(identity["phone"]),
          street: asString(identity["address1"]),
          ...optional("address2", asString(identity["address2"])),
          city: asString(identity["city"]),
          state: asString(identity["state"]),
          zip: asString(identity["postalCode"]),
          country: asString(identity["country"]),
          ...optional("passportNumber", asString(identity["passportNumber"])),
          ...optional("licenseNumber", asString(identity["licenseNumber"])),
          ...optional("nationalId", asString(identity["ssn"])),
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

  const folders = folderIndex.folders();
  return folders.length === 0 ? { items, warnings } : { items, warnings, folders };
}

function isoOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

/** Bitwarden keeps `{ lastUsedDate, password }`; newest first, as ShardPass stores it. */
function passwordHistoryOf(raw: unknown): { password: string; changedAt: string }[] {
  if (!Array.isArray(raw)) return [];
  const entries: { password: string; changedAt: string }[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const password = asString(entry["password"]);
    const changedAt = isoOf(entry["lastUsedDate"]);
    if (password === "" || changedAt === undefined) continue;
    entries.push({ password, changedAt });
  }
  return entries.sort((left, right) => right.changedAt.localeCompare(left.changedAt)).slice(0, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}

function optional<K extends string>(key: K, value: string): Partial<Record<K, string>> {
  return value === "" ? {} : ({ [key]: value } as Record<K, string>);
}

function brandOf(raw: string): { brand?: CardBrand } {
  const brand = CARD_BRAND[raw.trim().toLowerCase()];
  return brand === undefined ? {} : { brand };
}

/** Bitwarden custom fields carry over one-to-one; only unknown types are dropped, and named. */
function customFieldsOf(raw: unknown, warnings: string[], label: string): LoginCustomField[] {
  if (!Array.isArray(raw)) return [];
  const fields: LoginCustomField[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const name = asString(entry["name"]).trim();
    if (name === "") continue;
    const type = FIELD_TYPE[asNumber(entry["type"])];
    if (type === undefined) {
      warnings.push(`"${label}": custom field "${name}" has an unsupported type and was skipped.`);
      continue;
    }
    if (type === "linked") {
      const linkedTo = LINKED_ID[asNumber(entry["linkedId"])];
      if (linkedTo === undefined) continue;
      fields.push({ name, type, value: "", linkedTo });
      continue;
    }
    const value = entry["value"];
    fields.push({
      name,
      type,
      value: type === "boolean" ? (value === true || value === "true" ? "true" : "false") : asString(value),
    });
  }
  return fields;
}
