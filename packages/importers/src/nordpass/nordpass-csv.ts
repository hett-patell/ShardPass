import type { LoginCustomField } from "@shardpass/domain";

import { warningLabel } from "../common/clamp";
import { buildHeaderIndex, pickField } from "../common/csv-fields";
import { parseCsv } from "../common/csv-parser";
import { createFolderIndex, type ImportResult } from "../common/import-result";
import { newItemBase } from "../common/item-base";
import { emitLogin } from "../common/login-candidate";
import {
  boundEntries,
  emitCard,
  emitIdentity,
  emitNote,
  folderPath,
  splitExpiry,
} from "../common/typed-items";

/**
 * Imports a NordPass CSV export. Newer files carry a `type` column (password, note,
 * credit_card, identity, folder); older ones are sorted by which columns a row fills. Custom
 * fields arrive as a JSON list in `custom_fields`.
 */
export function importNordPassCsv(text: string): ImportResult {
  const { headers, rows } = parseCsv(text);
  const index = buildHeaderIndex(headers);
  const items: ImportResult["items"] = [];
  const warnings: string[] = [];
  const folders = createFolderIndex();

  for (const row of boundEntries(rows, warnings)) {
    const field = (...names: string[]) => pickField(row, index, ...names);
    const name = field("name").trim();
    const url = field("url").trim();
    const note = field("note");
    const label = warningLabel(name || url, "unnamed");
    const type = field("type").trim().toLowerCase();
    if (type === "folder") continue;
    const folderId = folders.idFor(folderPath(field("folder")));
    const base = { ...newItemBase(), ...(folderId === undefined ? {} : { folderId }) };
    const kind = type !== "" ? type : inferKind(row, index);

    switch (kind) {
      case "credit_card":
      case "card": {
        emitCard(
          base,
          {
            name: name || "Imported card",
            cardholderName: field("cardholdername", "cardholder_name"),
            number: field("cardnumber", "card_number"),
            cvv: field("cvc", "cvv"),
            ...splitExpiry(field("expirydate", "expiry_date")),
            pin: field("pin"),
            notes: note,
          },
          label,
          warnings,
          items,
        );
        break;
      }
      case "identity": {
        const fullName = field("full_name").trim();
        const [firstName, ...rest] = fullName.split(/\s+/u).filter((part) => part !== "");
        emitIdentity(
          base,
          {
            name: name || fullName || "Imported identity",
            firstName: firstName ?? "",
            lastName: rest.join(" "),
            email: field("email"),
            phone: field("phone_number"),
            street: field("address1"),
            address2: field("address2"),
            city: field("city"),
            state: field("state"),
            zip: field("zipcode"),
            country: field("country"),
            notes: note,
          },
          label,
          warnings,
          items,
        );
        break;
      }
      case "note":
        emitNote(base, { name: name || "Imported note", content: note }, label, warnings, items);
        break;
      default: {
        const password = field("password");
        if (password === "")
          warnings.push(`"${label}": imported without a password (the export has none).`);
        const customFields = parseCustomFields(field("custom_fields"), label, warnings);
        emitLogin(
          base,
          {
            name: name || url || "Imported login",
            username: field("username"),
            password,
            urls: url === "" ? [] : [url],
            ...(customFields.length === 0 ? {} : { customFields }),
            notes: note,
          },
          label,
          warnings,
          items,
        );
      }
    }
  }
  const folderList = folders.folders();
  return folderList.length === 0 ? { items, warnings } : { items, warnings, folders: folderList };
}

/** Without a `type` column, the filled columns say what a row is. */
function inferKind(row: Record<string, string>, index: Map<string, string>): string {
  const has = (...names: string[]) => pickField(row, index, ...names).trim() !== "";
  if (has("cardnumber", "card_number")) return "credit_card";
  if (has("full_name", "address1", "phone_number") && !has("password", "url")) return "identity";
  if (!has("url", "username", "password") && has("note")) return "note";
  return "password";
}

/** `[{"type":"text","label":"…","value":"…"}]`; unreadable JSON becomes a notice, not a failure. */
function parseCustomFields(raw: string, label: string, warnings: string[]): LoginCustomField[] {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "[]") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    warnings.push(`"${label}": the custom fields could not be read and were left out.`);
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const fields: LoginCustomField[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as { type?: unknown; label?: unknown; value?: unknown };
    const name = typeof record.label === "string" ? record.label.trim() : "";
    const value = typeof record.value === "string" ? record.value : "";
    if (name === "" || value === "") continue;
    const kind = typeof record.type === "string" ? record.type.toLowerCase() : "text";
    fields.push({
      name,
      value,
      type: kind === "hidden" || kind === "password" ? "hidden" : "text",
    });
  }
  return fields;
}
