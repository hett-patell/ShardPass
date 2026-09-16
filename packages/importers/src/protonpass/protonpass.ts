import {
  MAX_SECRET_NAME_LENGTH,
  MAX_SECRET_NOTES_LENGTH,
  MAX_SECRET_VALUE_LENGTH,
  SecretItemSchema,
  type LoginCustomField,
} from "@shardpass/domain";

import { clampName, clampText, keepIfValid, warningLabel } from "../common/clamp";
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
  if (text.trimStart().startsWith("{")) return importProtonPassJson(text);
  const headers = parseCsv(text).headers.map((header) => header.trim().toLowerCase());
  if (!headers.includes("type") && !headers.includes("password") && !headers.includes("name"))
    throw new ProtonPassFormatError(
      "This is neither a Proton Pass JSON export nor its CSV (no type, name or password column).",
    );
  return importProtonPassCsv(text);
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
    // An alias is an address, not an account: no password is the normal case.
    if (password === "" && type !== "alias")
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
    // Proton keeps the item's own times, in seconds; they are worth more than "now".
    const createdAt = isoFromSeconds(raw["createTime"]) ?? fresh.createdAt;
    const updatedAt = isoFromSeconds(raw["modifyTime"]) ?? createdAt;
    const base = {
      ...fresh,
      createdAt,
      updatedAt,
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
      case "custom":
      case "wifi":
      case "sshKey": {
        const kind = asString(data["type"]);
        const lines = [
          ...fieldLines(content["sections"]),
          ...(extras.asText === "" ? [] : [extras.asText]),
        ];
        if (kind === "sshKey" && asString(content["privateKey"]).trim() !== "") {
          const publicKey = asString(content["publicKey"]).trim();
          const metadata: Record<string, string> = {};
          if (publicKey !== "") {
            metadata["publicKey"] = publicKey;
            metadata["keyType"] = publicKey.split(/\s+/u)[0] ?? "";
          }
          keepIfValid(
            SecretItemSchema,
            {
              ...base,
              kind: "secret" as const,
              name: clampName(name, MAX_SECRET_NAME_LENGTH, "Imported key", label, warnings),
              secretType: "ssh_key" as const,
              value: clampText(
                asString(content["privateKey"]),
                MAX_SECRET_VALUE_LENGTH,
                "private key",
                label,
                warnings,
              ),
              metadata,
              notes: clampText(
                [note, lines.join("\n")].filter((part) => part !== "").join("\n\n"),
                MAX_SECRET_NOTES_LENGTH,
                "notes",
                label,
                warnings,
              ),
            },
            "secret",
            label,
            warnings,
            items,
          );
          break;
        }
        if (kind === "wifi" && asString(content["ssid"]).trim() !== "") {
          const security = asString(content["security"]).trim();
          emitLogin(
            base,
            {
              name: name || asString(content["ssid"]),
              username: asString(content["ssid"]),
              password: asString(content["password"]),
              urls: [],
              notes: [
                note,
                [security === "" ? "" : `Security: ${security}`, ...lines]
                  .filter((part) => part !== "")
                  .join("\n"),
              ]
                .filter((part) => part !== "")
                .join("\n\n"),
            },
            label,
            warnings,
            items,
          );
          break;
        }
        emitNote(
          base,
          {
            name: name || "Imported item",
            content: [note, lines.join("\n")].filter((part) => part !== "").join("\n\n"),
          },
          label,
          warnings,
          items,
        );
        break;
      }
      case "identity": {
        const text = (key: string) => asString(content[key]);
        // What has no column of its own stays readable in the notes: work details, handles,
        // Proton's own extra fields and sections.
        const detailLines = describeIdentityDetails(content);
        const extraLines = [
          ...fieldLines(content["extraPersonalDetails"]),
          ...fieldLines(content["extraAddressDetails"]),
          ...fieldLines(content["extraContactDetails"]),
          ...fieldLines(content["extraWorkDetails"]),
          ...fieldLines(content["extraSections"]),
        ];
        emitIdentity(
          base,
          {
            name: name || text("fullName") || "Imported identity",
            firstName: text("firstName") || nameParts(text("fullName")).first,
            middleName: text("middleName"),
            lastName: text("lastName") || nameParts(text("fullName")).rest,
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
            notes: [note, ...detailLines, ...extraLines, extras.asText]
              .filter((part) => part !== "")
              .join("\n"),
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
    const value =
      asString(data["content"]) || asString(data["totpUri"]) || asString(data["timestamp"]);
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

/** Identity columns Proton keeps that the vault has no field for, as "Key: value" lines. */
function describeIdentityDetails(content: Json): string[] {
  const labels: [string, string][] = [
    ["gender", "Gender"],
    ["secondPhoneNumber", "Second phone"],
    ["website", "Website"],
    ["personalWebsite", "Personal website"],
    ["xHandle", "X"],
    ["linkedin", "LinkedIn"],
    ["reddit", "Reddit"],
    ["facebook", "Facebook"],
    ["yahoo", "Yahoo"],
    ["instagram", "Instagram"],
    ["jobTitle", "Job title"],
    ["workPhoneNumber", "Work phone"],
    ["workEmail", "Work e-mail"],
  ];
  const lines: string[] = [];
  for (const [key, label] of labels) {
    const value = asString(content[key]).trim();
    if (value !== "") lines.push(`${label}: ${value}`);
  }
  return lines;
}

/**
 * Proton's field lists ("extraFields", "extraPersonalDetails"…) and section lists
 * ({ sectionName, sectionFields }) as "Key: value" lines; sections are headed by their name.
 */
function fieldLines(raw: unknown): string[] {
  const lines: string[] = [];
  for (const entry of asList(raw)) {
    if (!isRecord(entry)) continue;
    if (Array.isArray(entry["sectionFields"])) {
      const heading = asString(entry["sectionName"]).trim();
      const inner = fieldLines(entry["sectionFields"]);
      if (inner.length > 0) lines.push(...(heading === "" ? inner : [`${heading}:`, ...inner]));
      continue;
    }
    const data = isRecord(entry["data"]) ? entry["data"] : {};
    const value =
      asString(data["content"]).trim() ||
      asString(data["timestamp"]).trim() ||
      asString(data["totpUri"]).trim();
    if (value === "") continue;
    lines.push(`${asString(entry["fieldName"]).trim() || "Field"}: ${value}`);
  }
  return lines;
}

/** A Unix-seconds timestamp as ISO text, or null when the export has none worth keeping. */
function isoFromSeconds(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** "Bilbo of Bag End" → first "Bilbo", rest "of Bag End". */
function nameParts(fullName: string): { first: string; rest: string } {
  const words = fullName
    .trim()
    .split(/\s+/u)
    .filter((word) => word !== "");
  return { first: words[0] ?? "", rest: words.slice(1).join(" ") };
}
