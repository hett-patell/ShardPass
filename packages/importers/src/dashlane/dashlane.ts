import type { LoginCustomField } from "@shardpass/domain";

import { warningLabel } from "../common/clamp";
import { buildHeaderIndex, pickField } from "../common/csv-fields";
import { parseCsv } from "../common/csv-parser";
import { createFolderIndex, type ImportResult } from "../common/import-result";
import { newItemBase } from "../common/item-base";
import { emitLogin } from "../common/login-candidate";
import { boundEntries, emitCard, emitIdentity, emitNote } from "../common/typed-items";
import { listZipEntries, readZipEntry, ZipFormatError } from "../onepassword/zip-reader";

/** Ceiling for one inflated CSV inside the archive. */
const MAX_DASHLANE_CSV_BYTES = 64 * 1024 * 1024;
const MAX_DASHLANE_CSV_FILES = 16;

/** The file is not a Dashlane export at all (not a ZIP or CSV, or a ZIP without any CSV). */
export class DashlaneFormatError extends Error {
  override readonly name = "DashlaneFormatError";
}

/**
 * Imports a Dashlane export: the ZIP the app writes (credentials.csv, securenotes.csv,
 * payments.csv, ids.csv, personalinfo.csv) or any one of those CSVs on its own. Each CSV is
 * recognised by its columns, not its file name, so a renamed file still imports.
 */
export async function importDashlane(bytes: ArrayBuffer): Promise<ImportResult> {
  const view = new Uint8Array(bytes);
  const texts: string[] = [];
  if (view[0] === 0x50 && view[1] === 0x4b) {
    let entries;
    try {
      entries = listZipEntries(view);
    } catch (error) {
      throw new DashlaneFormatError(
        error instanceof ZipFormatError ? error.message : "This file is not a ZIP archive.",
      );
    }
    const csvEntries = entries.filter((entry) => /\.csv$/iu.test(entry.name));
    if (csvEntries.length === 0)
      throw new DashlaneFormatError(
        "The archive holds no CSV files, so it is not a Dashlane export.",
      );
    if (csvEntries.length > MAX_DASHLANE_CSV_FILES)
      throw new DashlaneFormatError(
        "The archive holds more CSV files than a Dashlane export does.",
      );
    // One ceiling for the whole archive, not one per entry: five entries each declaring the
    // maximum would otherwise inflate to several times it.
    let remaining = MAX_DASHLANE_CSV_BYTES;
    for (const entry of csvEntries) {
      const data = await readZipEntry(view, entry, remaining);
      remaining -= data.byteLength;
      texts.push(new TextDecoder("utf-8", { fatal: false }).decode(data));
    }
  } else {
    texts.push(new TextDecoder("utf-8", { fatal: false }).decode(view));
  }
  const items: ImportResult["items"] = [];
  const warnings: string[] = [];
  const folders = createFolderIndex();
  let recognised = 0;
  for (const text of texts) {
    const { headers, rows } = parseCsv(text);
    const index = buildHeaderIndex(headers);
    const kind = classify(index);
    if (kind === null) continue;
    recognised += 1;
    if (kind === "personalinfo") {
      importPersonalInfo(boundEntries(rows, warnings), index, warnings, items);
      continue;
    }
    for (const row of boundEntries(rows, warnings)) {
      const field = (...names: string[]) => pickField(row, index, ...names);
      const category = field("category").trim();
      const folderId = category === "" ? undefined : folders.idFor([category]);
      const base = { ...newItemBase(), ...(folderId === undefined ? {} : { folderId }) };
      switch (kind) {
        case "credentials": {
          const title = field("title").trim();
          const url = field("url").trim();
          const label = warningLabel(title || url, "unnamed");
          const password = field("password");
          if (password === "")
            warnings.push(`"${label}": imported without a password (the export has none).`);
          const extra = ["username2", "username3"]
            .map((name) => field(name).trim())
            .filter((value) => value !== "");
          const customFields: LoginCustomField[] = extra.map((value, position) => ({
            name: `Username ${position + 2}`,
            value,
            type: "text" as const,
          }));
          const totp = field("otpSecret", "otp_secret").trim();
          emitLogin(
            base,
            {
              name: title || url || "Imported login",
              username: field("username"),
              password,
              urls: url === "" ? [] : [url],
              ...(totp === "" ? {} : { totp }),
              ...(customFields.length === 0 ? {} : { customFields }),
              notes: field("note"),
            },
            label,
            warnings,
            items,
          );
          break;
        }
        case "securenotes": {
          const title = field("title").trim();
          emitNote(
            base,
            { name: title || "Imported note", content: field("note") },
            warningLabel(title, "unnamed"),
            warnings,
            items,
          );
          break;
        }
        case "payments": {
          const title = field("account_name").trim();
          const label = warningLabel(title, "unnamed");
          const type = field("type").trim().toLowerCase();
          if (type === "credit_card" || field("cc_number").trim() !== "") {
            emitCard(
              base,
              {
                name: title || "Imported card",
                // The export writes the holder's name as the card's name when no holder is set.
                cardholderName: field("account_holder") || title,
                number: field("cc_number"),
                cvv: field("code"),
                expMonth: field("expiration_month"),
                expYear: field("expiration_year"),
                notes: field("note"),
              },
              label,
              warnings,
              items,
            );
            break;
          }
          // A bank account has no card fields; its details stay readable as a note.
          const lines = describeLines([
            ["Account holder", field("account_holder")],
            ["Account number", field("account_number")],
            ["Routing number", field("routing_number")],
            ["Bank", field("bank") || field("issuing_bank")],
            ["Country", field("country")],
          ]);
          const note = field("note");
          emitNote(
            base,
            {
              name: title || "Imported bank account",
              content: [...lines, ...(note.trim() === "" ? [] : ["", note])].join("\n"),
            },
            label,
            warnings,
            items,
          );
          break;
        }
        case "ids": {
          importId(base, row, index, warnings, items);
          break;
        }
      }
    }
  }
  if (recognised === 0)
    throw new DashlaneFormatError("No Dashlane CSV columns were found in this file.");
  const folderList = folders.folders();
  return folderList.length === 0 ? { items, warnings } : { items, warnings, folders: folderList };
}

type DashlaneCsv = "credentials" | "securenotes" | "payments" | "personalinfo" | "ids";

/** Which of Dashlane's CSVs a header row belongs to. */
export function classify(index: Map<string, string>): DashlaneCsv | null {
  const has = (name: string) => index.has(name);
  if (has("password") && has("url")) return "credentials";
  if (has("cc_number") || has("account_number") || has("routing_number")) return "payments";
  if (has("first_name") || has("last_name") || has("date_of_birth")) return "personalinfo";
  if (has("number") && has("issue_date")) return "ids";
  if (has("title") && has("note")) return "securenotes";
  return null;
}

/** "Key: value" lines for the filled pairs, in order. */
function describeLines(pairs: readonly (readonly [string, string])[]): string[] {
  return pairs
    .filter(([, value]) => value.trim() !== "")
    .map(([key, value]) => `${key}: ${value.trim()}`);
}

type IdentityDraftFields = Parameters<typeof emitIdentity>[1];

/**
 * personalinfo.csv keeps one row per fact: a `name` row, then `email`, `number`, `address` and
 * `website` rows, each with its own item_name. They are folded into one identity per name
 * row (a file with several people has several), the way the person sees them in Dashlane.
 */
function importPersonalInfo(
  rows: readonly Record<string, string>[],
  index: Map<string, string>,
  warnings: string[],
  items: ImportResult["items"],
): void {
  type Draft = { fields: Record<string, string>; notes: string[]; label: string };
  const drafts: Draft[] = [];
  const current = (): Draft => {
    const last = drafts[drafts.length - 1];
    if (last !== undefined) return last;
    const fresh: Draft = { fields: {}, notes: [], label: "" };
    drafts.push(fresh);
    return fresh;
  };
  const set = (draft: Draft, key: string, value: string, label: string) => {
    const trimmed = value.trim();
    if (trimmed === "") return;
    if ((draft.fields[key] ?? "") === "") draft.fields[key] = trimmed;
    else draft.notes.push(`${label}: ${trimmed}`);
  };
  for (const row of rows) {
    const field = (...names: string[]) => pickField(row, index, ...names);
    const type = field("type").trim().toLowerCase();
    const itemName = field("item_name").trim();
    switch (type) {
      case "name": {
        const first = field("first_name").trim();
        const last = field("last_name").trim();
        const draft: Draft = {
          fields: {},
          notes: [],
          label: [first, last].filter((part) => part !== "").join(" ") || itemName,
        };
        drafts.push(draft);
        set(draft, "firstName", first, "First name");
        set(draft, "middleName", field("middle_name"), "Middle name");
        set(draft, "lastName", last, "Last name");
        set(draft, "username", field("login"), "Login");
        set(draft, "birthDate", field("date_of_birth"), "Date of birth");
        set(draft, "company", field("job_title"), "Job title");
        const born = field("place_of_birth").trim();
        if (born !== "") draft.notes.push(`Place of birth: ${born}`);
        const title = field("title").trim();
        if (title !== "") draft.notes.push(`Title: ${title}`);
        // Dashlane writes contact details on their own rows; a hand-made file may not.
        set(draft, "email", field("email"), "E-mail");
        set(draft, "phone", field("phone_number"), "Phone");
        set(draft, "street", field("address"), "Address");
        set(draft, "city", field("city"), "City");
        set(draft, "state", field("state"), "State");
        set(draft, "zip", field("zip"), "Postal code");
        set(draft, "country", field("country"), "Country");
        break;
      }
      case "email":
        set(current(), "email", field("email"), itemName || "E-mail");
        break;
      case "number":
      case "phone":
        set(current(), "phone", field("phone_number"), itemName || "Phone");
        break;
      case "address": {
        const draft = current();
        const street = [field("address").trim(), field("address_building").trim()]
          .filter((part) => part !== "")
          .join(", ");
        const line2 = [
          field("address_apartment").trim() === ""
            ? ""
            : `Apt ${field("address_apartment").trim()}`,
          field("address_floor").trim() === "" ? "" : `Floor ${field("address_floor").trim()}`,
        ]
          .filter((part) => part !== "")
          .join(", ");
        set(draft, "street", street, itemName || "Address");
        set(draft, "address2", line2, "Address line 2");
        set(draft, "city", field("city"), "City");
        set(draft, "state", field("state"), "State");
        set(draft, "zip", field("zip"), "Postal code");
        set(draft, "country", field("country"), "Country");
        const recipient = field("address_recipient").trim();
        if (recipient !== "") draft.notes.push(`Recipient: ${recipient}`);
        const code = field("address_door_code").trim();
        if (code !== "") draft.notes.push(`Door code: ${code}`);
        break;
      }
      case "website": {
        const url = field("url").trim();
        if (url !== "") current().notes.push(`${itemName || "Website"}: ${url}`);
        break;
      }
      default: {
        const value = [field("email"), field("phone_number"), field("url"), field("address")]
          .map((part) => part.trim())
          .find((part) => part !== "");
        if (value !== undefined) current().notes.push(`${itemName || type || "Detail"}: ${value}`);
      }
    }
  }
  for (const draft of drafts) {
    const name = draft.label || "Imported identity";
    const { firstName, lastName, ...rest } = draft.fields;
    const fields: IdentityDraftFields = {
      name,
      firstName: firstName ?? "",
      lastName: lastName ?? "",
      ...rest,
      notes: draft.notes.join("\n"),
    };
    emitIdentity(newItemBase(), fields, warningLabel(name, "unnamed"), warnings, items);
  }
}

/** ids.csv: passports, licences and national numbers become identities; the rest stay notes. */
function importId(
  base: Parameters<typeof emitNote>[0],
  row: Record<string, string>,
  index: Map<string, string>,
  warnings: string[],
  items: ImportResult["items"],
): void {
  const field = (...names: string[]) => pickField(row, index, ...names);
  const type = field("type").trim().toLowerCase();
  const holder = field("name").trim();
  const number = field("number").trim();
  const [firstName, ...rest] = holder.split(/\s+/u).filter((part) => part !== "");
  const notes = describeLines([
    ["Issued", field("issue_date")],
    ["Expires", field("expiration_date")],
    ["Place of issue", field("place_of_issue")],
    ["State", field("state")],
  ]).join("\n");
  const typeLabel: Record<string, string> = {
    passport: "Passport",
    license: "Driver's licence",
    social_security: "Social security number",
    card: "ID card",
    tax_number: "Tax number",
  };
  const label = typeLabel[type] ?? (type === "" ? "ID" : type);
  const name = holder === "" ? label : `${label} – ${holder}`;
  const identityField =
    type === "passport"
      ? "passportNumber"
      : type === "license"
        ? "licenseNumber"
        : type === "social_security"
          ? "nationalId"
          : null;
  if (identityField !== null && number !== "") {
    emitIdentity(
      base,
      {
        name,
        firstName: firstName ?? "",
        lastName: rest.join(" "),
        [identityField]: number,
        notes,
      },
      warningLabel(name, "unnamed"),
      warnings,
      items,
    );
    return;
  }
  emitNote(
    base,
    {
      name,
      content: describeLines([
        ["Number", number],
        ["Name", holder],
      ])
        .concat(notes === "" ? [] : [notes])
        .join("\n"),
    },
    warningLabel(name, "unnamed"),
    warnings,
    items,
  );
}
