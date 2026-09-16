import {
  MAX_NOTE_CONTENT_LENGTH,
  MAX_NOTE_NAME_LENGTH,
  MAX_SECRET_METADATA_VALUE_LENGTH,
  MAX_SECRET_NAME_LENGTH,
  MAX_SECRET_NOTES_LENGTH,
  MAX_SECRET_VALUE_LENGTH,
  NoteItemSchema,
  SecretItemSchema,
  type LoginCustomField,
  type LoginCustomFieldType,
  type LoginUrlMatchMode,
} from "@shardpass/domain";

import { clampName, clampText, keepIfValid, warningLabel } from "../common/clamp";
import { newItemBase } from "../common/item-base";
import { createFolderIndex, type ImportResult } from "../common/import-result";
import { emitLogin } from "../common/login-candidate";
import { emitCard, emitIdentity } from "../common/typed-items";
import { IMPORT_LIMITS } from "../import-model";

const BITWARDEN_TYPE_LOGIN = 1;
const BITWARDEN_TYPE_NOTE = 2;
const BITWARDEN_TYPE_CARD = 3;
const BITWARDEN_TYPE_IDENTITY = 4;
const BITWARDEN_TYPE_SSH_KEY = 5;

/** Bitwarden `uris[].match` values. Regex has no equivalent and falls back to domain. */
const URI_MATCH: Record<number, LoginUrlMatchMode> = {
  0: "domain",
  1: "host",
  2: "startsWith",
  3: "exact",
  5: "never",
};
/** Bitwarden `fields[].type`: 0 text, 1 hidden, 2 boolean, 3 linked. */
const FIELD_TYPE: Record<number, LoginCustomFieldType> = {
  0: "text",
  1: "hidden",
  2: "boolean",
  3: "linked",
};
/** Bitwarden `fields[].linkedId` for logins: 100 username, 101 password. */
const LINKED_ID: Record<number, "username" | "password"> = { 100: "username", 101: "password" };

/**
 * Imports a Bitwarden JSON vault export: `{ items: [{ type, name, login,
 * notes, card, identity, secureNote }] }`. Bitwarden `type` values map as
 * 1=login, 2=secure note, 3=card, 4=identity; any other value (or a
 * malformed entry) is reported as a warning rather than aborting the import.
 *
 * Folders and, for an organisation vault, collections both become folders here: an item
 * with no folder is filed under its first collection, so a shared vault keeps its shape.
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
  // Bitwarden folders and collections are flat records whose names may carry a path
  // ("Work/Clients").
  const folderIndex = createFolderIndex();
  const folderIdByBitwardenId = indexNamedRecords(
    isRecord(root) ? root["folders"] : undefined,
    folderIndex,
  );
  const folderIdByCollectionId = indexNamedRecords(
    isRecord(root) ? root["collections"] : undefined,
    folderIndex,
  );

  const limit = IMPORT_LIMITS.maxThirdPartyEntries;
  const truncated = rawItems.length > limit;
  const bounded = truncated ? rawItems.slice(0, limit) : rawItems;
  if (truncated)
    warnings.push(
      `Only the first ${limit} items were imported; ${rawItems.length - limit} item(s) were skipped.`,
    );

  for (const [index, raw] of bounded.entries()) {
    if (!isRecord(raw)) {
      warnings.push(`Skipped entry ${index + 1}: not an object`);
      continue;
    }

    const label = warningLabel(asString(raw["name"]), `unnamed entry ${index + 1}`);
    const rawName = asString(raw["name"]);
    const notes = asString(raw["notes"]);
    // Notes, cards, identities and SSH keys have no custom fields of their own; what Bitwarden
    // kept there (recovery codes in a hidden field, most often) goes into the notes as lines.
    const notesWithFields = [notes, fieldLinesOf(raw["fields"])]
      .filter((part) => part !== "")
      .join("\n\n");
    const favorite = raw["favorite"] === true;
    const folderId =
      folderIdByBitwardenId.get(asString(raw["folderId"])) ??
      firstCollectionFolder(raw["collectionIds"], folderIdByCollectionId);
    const fresh = newItemBase();
    const createdAt = isoOf(raw["creationDate"]) ?? fresh.createdAt;
    const base = {
      ...fresh,
      createdAt,
      updatedAt: isoOf(raw["revisionDate"]) ?? createdAt,
      favorite,
      ...(folderId === undefined ? {} : { folderId }),
      ...(raw["reprompt"] === 1 ? { reprompt: true as const } : {}),
    };

    switch (raw["type"]) {
      case BITWARDEN_TYPE_LOGIN: {
        const login = isRecord(raw["login"]) ? raw["login"] : {};
        const uris = Array.isArray(login["uris"]) ? login["uris"] : [];
        const kept = uris
          .map((entry) =>
            isRecord(entry)
              ? {
                  uri: asString(entry["uri"]),
                  match: URI_MATCH[asNumber(entry["match"])] ?? "domain",
                }
              : { uri: "", match: "domain" as const },
          )
          .filter((entry) => entry.uri.length > 0);
        const totp = asString(login["totp"]);
        const customFields = customFieldsOf(raw["fields"], warnings, label);
        const passwordHistory = passwordHistoryOf(raw["passwordHistory"]);
        const passkeys = Array.isArray(login["fido2Credentials"])
          ? login["fido2Credentials"].length
          : 0;
        if (passkeys > 0)
          warnings.push(
            `"${label}": ${passkeys === 1 ? "passkey" : `${passkeys} passkeys`} not imported.`,
          );

        emitLogin(
          base,
          {
            name: rawName || "Imported item",
            username: asString(login["username"]),
            password: asString(login["password"]),
            urls: kept.map((entry) => entry.uri),
            urlMatches: kept.map((entry) => entry.match),
            ...(totp === "" ? {} : { totp }),
            customFields,
            passwordHistory,
            notes,
          },
          label,
          warnings,
          items,
        );
        break;
      }
      case BITWARDEN_TYPE_NOTE: {
        const candidate = {
          ...base,
          kind: "note" as const,
          name: clampName(rawName, MAX_NOTE_NAME_LENGTH, "Imported item", label, warnings),
          content: clampText(notesWithFields, MAX_NOTE_CONTENT_LENGTH, "content", label, warnings),
        };
        keepIfValid(NoteItemSchema, candidate, "note", label, warnings, items);
        break;
      }
      case BITWARDEN_TYPE_CARD: {
        const card = isRecord(raw["card"]) ? raw["card"] : {};
        emitCard(
          base,
          {
            name: rawName || "Imported item",
            brand: asString(card["brand"]),
            cardholderName: asString(card["cardholderName"]),
            number: asString(card["number"]),
            expMonth: asString(card["expMonth"]),
            expYear: asString(card["expYear"]),
            cvv: asString(card["code"]),
            notes: notesWithFields,
          },
          label,
          warnings,
          items,
        );
        break;
      }
      case BITWARDEN_TYPE_IDENTITY: {
        const identity = isRecord(raw["identity"]) ? raw["identity"] : {};
        const text = (key: string) => asString(identity[key]);
        emitIdentity(
          base,
          {
            name: rawName || "Imported item",
            firstName: text("firstName"),
            middleName: text("middleName"),
            lastName: text("lastName"),
            company: text("company"),
            username: text("username"),
            email: text("email"),
            phone: text("phone"),
            street: text("address1"),
            address2: [text("address2"), text("address3")].filter((part) => part !== "").join(", "),
            city: text("city"),
            state: text("state"),
            zip: text("postalCode"),
            country: text("country"),
            passportNumber: text("passportNumber"),
            licenseNumber: text("licenseNumber"),
            nationalId: text("ssn"),
            notes: [text("title") === "" ? "" : `Title: ${text("title")}`, notesWithFields]
              .filter((part) => part !== "")
              .join("\n"),
          },
          label,
          warnings,
          items,
        );
        break;
      }
      case BITWARDEN_TYPE_SSH_KEY: {
        const sshKey = isRecord(raw["sshKey"]) ? raw["sshKey"] : {};
        const privateKey = asString(sshKey["privateKey"]);
        if (privateKey === "") {
          warnings.push(`Skipped "${label}": the SSH key has no private key.`);
          break;
        }
        const metadata: Record<string, string> = {};
        const publicKey = asString(sshKey["publicKey"]).trim();
        const fingerprint = asString(sshKey["keyFingerprint"]).trim();
        if (publicKey !== "")
          metadata["publicKey"] = clampText(
            publicKey,
            MAX_SECRET_METADATA_VALUE_LENGTH,
            "public key",
            label,
            warnings,
          );
        if (fingerprint !== "")
          metadata["fingerprint"] = clampText(
            fingerprint,
            MAX_SECRET_METADATA_VALUE_LENGTH,
            "fingerprint",
            label,
            warnings,
          );
        const keyType = publicKey.split(/\s+/u)[0] ?? "";
        if (keyType !== "") metadata["keyType"] = keyType;
        const candidate = {
          ...base,
          kind: "secret" as const,
          name: clampName(rawName, MAX_SECRET_NAME_LENGTH, "Imported item", label, warnings),
          secretType: "ssh_key" as const,
          value: clampText(privateKey, MAX_SECRET_VALUE_LENGTH, "private key", label, warnings),
          metadata,
          notes: clampText(notesWithFields, MAX_SECRET_NOTES_LENGTH, "notes", label, warnings),
        };
        keepIfValid(SecretItemSchema, candidate, "secret", label, warnings, items);
        break;
      }
      default:
        warnings.push(`Skipped "${label}": unsupported Bitwarden item type ${String(raw["type"])}`);
    }
  }

  const folders = folderIndex.folders();
  return folders.length === 0 ? { items, warnings } : { items, warnings, folders };
}

/** Maps Bitwarden `{ id, name }` records (folders, collections) to provisional folder ids. */
function indexNamedRecords(
  raw: unknown,
  folderIndex: ReturnType<typeof createFolderIndex>,
): Map<string, string> {
  const byId = new Map<string, string>();
  if (!Array.isArray(raw)) return byId;
  for (const record of raw) {
    if (!isRecord(record)) continue;
    const id = asString(record["id"]);
    const name = asString(record["name"]);
    if (id === "" || name.trim() === "") continue;
    const provisional = folderIndex.idFor(name.split("/"));
    if (provisional !== undefined) byId.set(id, provisional);
  }
  return byId;
}

function firstCollectionFolder(
  collectionIds: unknown,
  byCollectionId: ReadonlyMap<string, string>,
): string | undefined {
  if (!Array.isArray(collectionIds)) return undefined;
  for (const id of collectionIds) {
    const folderId = byCollectionId.get(asString(id));
    if (folderId !== undefined) return folderId;
  }
  return undefined;
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
      value:
        type === "boolean"
          ? value === true || value === "true"
            ? "true"
            : "false"
          : asString(value),
    });
  }
  return fields;
}

/** Bitwarden custom fields as "name: value" lines; a linked field names no value and is skipped. */
function fieldLinesOf(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  const lines: string[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const name = asString(entry["name"]).trim();
    const type = typeof entry["type"] === "number" ? entry["type"] : 0;
    if (type === 3) continue;
    const value =
      type === 2
        ? String(entry["value"] === true || entry["value"] === "true")
        : asString(entry["value"]);
    if (value.trim() === "") continue;
    lines.push(`${name === "" ? "Field" : name}: ${value}`);
  }
  return lines.join("\n");
}
