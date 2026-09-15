import type { LoginCustomField } from "@shardpass/domain";

import { warningLabel } from "../common/clamp";
import { buildHeaderIndex, pickField } from "../common/csv-fields";
import { parseCsv } from "../common/csv-parser";
import { createFolderIndex, type ImportResult } from "../common/import-result";
import { newItemBase } from "../common/item-base";
import { emitLogin } from "../common/login-candidate";
import { boundEntries, emitCard, emitIdentity, emitNote, splitExpiry } from "../common/typed-items";
import { listZipEntries, readZipEntry, ZipFormatError } from "../onepassword/zip-reader";

/** Ceiling for the inflated data.json. */
const MAX_PROTON_JSON_BYTES = 64 * 1024 * 1024;

/** The file is not a Proton Pass export at all. */
export class ProtonPassFormatError extends Error {
  override readonly name = "ProtonPassFormatError";
}

/**
 * Imports a Proton Pass export: the ZIP the app writes (`Proton Pass/data.json`), that JSON on
 * its own, or the CSV export (`type,name,url,email,username,password,note,totp,vault`). Each
 * vault becomes a folder. Trashed items are imported archived.
 */
export async function importProtonPass(bytes: ArrayBuffer): Promise<ImportResult> {
  const view = new Uint8Array(bytes);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  if (view[0] === 0x50 && view[1] === 0x4b) {
    let entries;
    try {
      entries = listZipEntries(view);
    } catch (error) {
      throw new ProtonPassFormatError(
        error instanceof ZipFormatError ? error.message : "This file is not a ZIP archive.",
      );
    }
    const entry = entries.find((candidate) => /(^|\/)data\.json$/iu.test(candidate.name));
    if (entry === undefined)
      throw new ProtonPassFormatError(
        "The archive has no data.json file, so it is not a Proton Pass export.",
      );
    return importProtonPassJson(
      decoder.decode(await readZipEntry(view, entry, MAX_PROTON_JSON_BYTES)),
    );
  }
  const text = decoder.decode(view);
  return text.trimStart().startsWith("{") ? importProtonPassJson(text) : importProtonPassCsv(text);
}

export function importProtonPassCsv(text: string): ImportResult {
  const { headers, rows } = parseCsv(text);
  const index = buildHeaderIndex(headers);
  const items: ImportResult["items"] = [];
  const warnings: string[] = [];
  const folders = createFolderIndex();
  for (const row of boundEntries(rows, warnings)) {
    const field = (...names: string[]) => pickField(row, index, ...names);
    const name = field("name").trim();
    const url = field("url").trim();
    const label = warningLabel(name || url, "unnamed");
    const vault = field("vault").trim();
    const folderId = vault === "" ? undefined : folders.idFor([vault]);
    const base = { ...newItemBase(), ...(folderId === undefined ? {} : { folderId }) };
    const type = field("type").trim().toLowerCase();
    const note = field("note");
    if (type === "note") {
      emitNote(base, { name: name || "Imported note", content: note }, label, warnings, items);
      continue;
    }
    if (type === "creditcard" || type === "identity") {
      // The CSV keeps only the name and note of these; the JSON export has the fields.
      warnings.push(
        `"${label}": the CSV export keeps only the name and note of a ${type === "identity" ? "identity" : "card"}; export as JSON to import its fields.`,
      );
      emitNote(base, { name: name || "Imported item", content: note }, label, warnings, items);
      continue;
    }
    const email = field("email").trim();
    const username = field("username").trim();
    const password = field("password");
    if (password === "")
      warnings.push(`"${label}": imported without a password (the export has none).`);
    const totp = field("totp").trim();
    const customFields: LoginCustomField[] =
      username !== "" && email !== "" ? [{ name: "Email", value: email, type: "text" }] : [];
    emitLogin(
      base,
      {
        name: name || url || "Imported login",
        username: username || email,
        password,
        urls: url === "" ? [] : [url],
        ...(totp === "" ? {} : { totp }),
        ...(customFields.length === 0 ? {} : { customFields }),
        notes: note,
      },
      label,
      warnings,
      items,
    );
  }
  const folderList = folders.folders();
  return folderList.length === 0 ? { items, warnings } : { items, warnings, folders: folderList };
}

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null;
const asString = (value: unknown): string => (typeof value === "string" ? value : "");
const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export function importProtonPassJson(text: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProtonPassFormatError("data.json is not valid JSON.");
  }
  if (!isRecord(parsed) || !isRecord(parsed["vaults"]))
    throw new ProtonPassFormatError(
      'The file has no "vaults" list, so it is not a Proton Pass export.',
    );
  if (parsed["encrypted"] === true)
    throw new ProtonPassFormatError(
      "This export is PGP-encrypted. Export again without encryption, or decrypt it first.",
    );
  const items: ImportResult["items"] = [];
  const warnings: string[] = [];
  const folders = createFolderIndex();
  const entries: { vault: string; raw: Json }[] = [];
  for (const vault of Object.values(parsed["vaults"])) {
    if (!isRecord(vault)) continue;
    const vaultName = asString(vault["name"]).trim();
    for (const raw of asList(vault["items"]))
      if (isRecord(raw)) entries.push({ vault: vaultName, raw });
  }
  for (const { vault, raw } of boundEntries(entries, warnings, "item")) {
    const data = isRecord(raw["data"]) ? raw["data"] : {};
    const metadata = isRecord(data["metadata"]) ? data["metadata"] : {};
    const content = isRecord(data["content"]) ? data["content"] : {};
    const name = asString(metadata["name"]).trim();
    const note = asString(metadata["note"]);
    const label = warningLabel(name, "unnamed");
    const folderId = vault === "" ? undefined : folders.idFor([vault]);
    const fresh = newItemBase();
    const base = {
      ...fresh,
      favorite: raw["pinned"] === true,
      ...(folderId === undefined ? {} : { folderId }),
      ...(raw["state"] === 2 ? { archivedAt: fresh.updatedAt } : {}),
    };
    const extras = extraFields(data["extraFields"]);
    switch (asString(data["type"])) {
      case "login":
      case "alias": {
        const email = asString(content["itemEmail"]).trim() || asString(raw["aliasEmail"]).trim();
        const username = asString(content["itemUsername"]).trim();
        const password = asString(content["password"]);
        if (password === "" && asString(data["type"]) === "login")
          warnings.push(`"${label}": imported without a password (the export has none).`);
        const totp = asString(content["totpUri"]).trim() || extras.totp;
        const customFields: LoginCustomField[] = [
          ...(username !== "" && email !== ""
            ? [{ name: "Email", value: email, type: "text" as const }]
            : []),
          ...extras.fields,
        ];
        const passkeys = asList(content["passkeys"]).length;
        if (passkeys > 0)
          warnings.push(
            `"${label}": ${passkeys === 1 ? "passkey" : `${passkeys} passkeys`} not imported.`,
          );
        emitLogin(
          base,
          {
            name: name || "Imported login",
            username: username || email,
            password,
            urls: asList(content["urls"]).map(asString),
            ...(totp === "" ? {} : { totp }),
            ...(customFields.length === 0 ? {} : { customFields }),
            notes: note,
          },
          label,
          warnings,
          items,
        );
        break;
      }
      case "note":
        emitNote(
          base,
          {
            name: name || "Imported note",
            content: [note, extras.asText].filter((part) => part !== "").join("\n\n"),
          },
          label,
          warnings,
          items,
        );
        break;
      case "creditCard":
        emitCard(
          base,
          {
            name: name || "Imported card",
            cardholderName: asString(content["cardholderName"]),
            number: asString(content["number"]),
            cvv: asString(content["verificationNumber"]),
            pin: asString(content["pin"]),
            ...splitExpiry(asString(content["expirationDate"])),
            notes: [note, extras.asText].filter((part) => part !== "").join("\n\n"),
          },
          label,
          warnings,
          items,
        );
        break;
      case "identity": {
        const text = (key: string) => asString(content[key]);
        emitIdentity(
          base,
          {
            name: name || text("fullName") || "Imported identity",
            firstName: text("firstName") || text("fullName").split(/\s+/u)[0] || "",
            middleName: text("middleName"),
            lastName: text("lastName"),
            company: text("organization") || text("company"),
            birthDate: text("birthdate"),
            email: text("email"),
            phone: text("phoneNumber"),
            street: text("streetAddress"),
            address2: [text("floor"), text("county")].filter((part) => part !== "").join(", "),
            city: text("city"),
            state: text("stateOrProvince"),
            zip: text("zipOrPostalCode"),
            country: text("countryOrRegion"),
            passportNumber: text("passportNumber"),
            licenseNumber: text("licenseNumber"),
            nationalId: text("socialSecurityNumber"),
            notes: [note, extras.asText].filter((part) => part !== "").join("\n\n"),
          },
          label,
          warnings,
          items,
        );
        break;
      }
      default:
        warnings.push(
          `Skipped "${label}": unsupported Proton Pass item type ${asString(data["type"]) || "(none)"}.`,
        );
    }
  }
  const folderList = folders.folders();
  return folderList.length === 0 ? { items, warnings } : { items, warnings, folders: folderList };
}

/** Proton's extra fields: text and hidden become custom fields, the first totp one a login's code. */
function extraFields(raw: unknown): { fields: LoginCustomField[]; totp: string; asText: string } {
  const fields: LoginCustomField[] = [];
  let totp = "";
  for (const entry of asList(raw)) {
    if (!isRecord(entry)) continue;
    const name = asString(entry["fieldName"]).trim();
    const data = isRecord(entry["data"]) ? entry["data"] : {};
    const value = asString(data["content"]) || asString(data["totpUri"]);
    if (value === "") continue;
    const type = asString(entry["type"]);
    if (type === "totp" && totp === "") {
      totp = value;
      continue;
    }
    fields.push({ name: name || "Field", value, type: type === "hidden" ? "hidden" : "text" });
  }
  return {
    fields,
    totp,
    asText: fields.map((field) => `${field.name}: ${field.value}`).join("\n"),
  };
}
