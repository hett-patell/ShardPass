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
    for (const entry of csvEntries) {
      const data = await readZipEntry(view, entry, MAX_DASHLANE_CSV_BYTES);
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
                cardholderName: field("account_holder"),
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
        case "personalinfo": {
          const title = field("item_name", "title").trim();
          const first = field("first_name").trim();
          const last = field("last_name").trim();
          const name = title || [first, last].filter((part) => part !== "").join(" ");
          const label = warningLabel(name, "unnamed");
          emitIdentity(
            base,
            {
              name: name || "Imported identity",
              firstName: first,
              middleName: field("middle_name"),
              lastName: last,
              username: field("login"),
              birthDate: field("date_of_birth"),
              company: field("job_title"),
              email: field("email"),
              phone: field("phone_number"),
              street: [field("address").trim(), field("address_building").trim()]
                .filter((part) => part !== "")
                .join(", "),
              address2: [field("address_apartment").trim(), field("address_floor").trim()]
                .filter((part) => part !== "")
                .join(", "),
              city: field("city"),
              state: field("state"),
              zip: field("zip"),
              country: field("country"),
            },
            label,
            warnings,
            items,
          );
          break;
        }
        case "ids": {
          const type = field("type").trim();
          const holder = field("name").trim();
          const name = [type, holder].filter((part) => part !== "").join(" – ");
          const lines = describeLines([
            ["Number", field("number")],
            ["Name", holder],
            ["Issued", field("issue_date")],
            ["Expires", field("expiration_date")],
            ["Place of issue", field("place_of_issue")],
            ["State", field("state")],
          ]);
          emitNote(
            base,
            { name: name || "Imported ID", content: lines.join("\n") },
            warningLabel(name, "unnamed"),
            warnings,
            items,
          );
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
