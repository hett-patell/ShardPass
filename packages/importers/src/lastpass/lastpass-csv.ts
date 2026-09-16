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
  truthy,
} from "../common/typed-items";

/** The URL LastPass writes for every secure note. */
const NOTE_URL = "http://sn";

/**
 * Imports a LastPass CSV export (`url,username,password,totp,extra,name,grouping,fav`).
 * Secure notes carry `http://sn` as their URL and their text in `extra`; a typed note starts
 * that text with `NoteType:` followed by `Key:Value` lines. Credit cards and addresses become
 * card and identity items; every other typed note keeps its fields as note text. `grouping`
 * is a folder path with `\` between levels.
 */
export function importLastPassCsv(text: string): ImportResult {
  const { headers, rows } = parseCsv(text);
  const index = buildHeaderIndex(headers);
  const items: ImportResult["items"] = [];
  const warnings: string[] = [];
  const folders = createFolderIndex();

  for (const row of boundEntries(rows, warnings)) {
    const url = pickField(row, index, "url").trim();
    const name = pickField(row, index, "name").trim();
    const extra = pickField(row, index, "extra");
    const label = warningLabel(name || url, "unnamed");
    const folderId = folders.idFor(folderPath(pickField(row, index, "grouping"), /\\/u));
    const base = {
      ...newItemBase(),
      favorite: truthy(pickField(row, index, "fav")),
      ...(folderId === undefined ? {} : { folderId }),
    };

    if (url === NOTE_URL) {
      importNote(base, name, extra, label, warnings, items);
      continue;
    }
    const password = pickField(row, index, "password");
    if (password === "")
      warnings.push(`"${label}": imported without a password (the export has none).`);
    const totp = pickField(row, index, "totp").trim();
    emitLogin(
      base,
      {
        name: name || url || "Imported login",
        username: pickField(row, index, "username"),
        password,
        urls: url === "" || url === "http://" ? [] : [url],
        ...(totp === "" ? {} : { totp }),
        notes: extra,
      },
      label,
      warnings,
      items,
    );
  }
  const folderList = folders.folders();
  return folderList.length === 0 ? { items, warnings } : { items, warnings, folders: folderList };
}

/** `NoteType:Credit Card` on the first line makes a typed note; the rest are `Key:Value` lines. */
function importNote(
  base: ReturnType<typeof newItemBase> & { folderId?: string },
  name: string,
  extra: string,
  label: string,
  warnings: string[],
  items: ImportResult["items"],
): void {
  const typed = parseTypedNote(extra);
  const title = name || "Imported note";
  if (typed === null) {
    emitNote(base, { name: title, content: extra }, label, warnings, items);
    return;
  }
  const field = (key: string) => typed.fields.get(key.toLowerCase()) ?? "";
  switch (typed.type.toLowerCase()) {
    case "credit card": {
      const expiry = splitExpiry(field("Expiration Date"));
      emitCard(
        base,
        {
          name: title,
          cardholderName: field("Name on Card"),
          brand: field("Type"),
          number: field("Number"),
          cvv: field("Security Code"),
          ...expiry,
          notes: noteLines(typed, [
            "Name on Card",
            "Type",
            "Number",
            "Security Code",
            "Expiration Date",
            "Notes",
          ]),
        },
        label,
        warnings,
        items,
      );
      return;
    }
    case "address":
      emitIdentity(
        base,
        {
          name: title,
          firstName: field("First Name"),
          middleName: field("Middle Name"),
          lastName: field("Last Name"),
          company: field("Company"),
          username: field("Username"),
          birthDate: field("Birthday"),
          email: field("Email Address"),
          phone: field("Phone") || field("Mobile Phone") || field("Evening Phone"),
          street: field("Address 1"),
          address2: field("Address 2"),
          city: field("City / Town"),
          state: field("State"),
          zip: field("Zip / Postal Code"),
          country: field("Country"),
          notes: noteLines(typed, [
            "First Name",
            "Middle Name",
            "Last Name",
            "Company",
            "Username",
            "Birthday",
            "Email Address",
            "Phone",
            "Mobile Phone",
            "Evening Phone",
            "Address 1",
            "Address 2",
            "City / Town",
            "State",
            "Zip / Postal Code",
            "Country",
            "Notes",
          ]),
        },
        label,
        warnings,
        items,
      );
      return;
    case "passport": {
      const [firstName, ...rest] = field("Name")
        .split(/\s+/u)
        .filter((part) => part !== "");
      emitIdentity(
        base,
        {
          name: title,
          firstName: firstName ?? "",
          lastName: rest.join(" "),
          passportNumber: field("Number"),
          country: field("Country"),
          birthDate: field("Date of Birth"),
          notes: noteLines(typed, ["Name", "Number", "Country", "Date of Birth", "Notes"]),
        },
        label,
        warnings,
        items,
      );
      return;
    }
    case "driver's license": {
      const [firstName, ...rest] = field("Name")
        .split(/\s+/u)
        .filter((part) => part !== "");
      emitIdentity(
        base,
        {
          name: title,
          firstName: firstName ?? "",
          lastName: rest.join(" "),
          licenseNumber: field("Number"),
          street: field("Address"),
          city: field("City / Town"),
          state: field("State"),
          zip: field("ZIP / Postal Code"),
          country: field("Country"),
          birthDate: field("Date of Birth"),
          notes: noteLines(typed, [
            "Name",
            "Number",
            "Address",
            "City / Town",
            "State",
            "ZIP / Postal Code",
            "Country",
            "Date of Birth",
            "Notes",
          ]),
        },
        label,
        warnings,
        items,
      );
      return;
    }
    case "social security": {
      const [firstName, ...rest] = field("Name")
        .split(/\s+/u)
        .filter((part) => part !== "");
      emitIdentity(
        base,
        {
          name: title,
          firstName: firstName ?? "",
          lastName: rest.join(" "),
          nationalId: field("Number"),
          notes: noteLines(typed, ["Name", "Number", "Notes"]),
        },
        label,
        warnings,
        items,
      );
      return;
    }
    default: {
      // Bank accounts, Wi-Fi, servers…: the fields stay readable as text.
      const lines = [...typed.entries]
        .filter(([key, value]) => key.toLowerCase() !== "language" && value.trim() !== "")
        .map(([key, value]) => `${key}: ${value}`);
      emitNote(
        base,
        { name: title, content: [`Type: ${typed.type}`, ...lines].join("\n") },
        label,
        warnings,
        items,
      );
    }
  }
}

/** The typed note's remaining fields as "Key: value" lines, with the free-text Notes last. */
function noteLines(typed: TypedNote, used: readonly string[]): string {
  const skip = new Set([...used.map((key) => key.toLowerCase()), "language"]);
  const lines = typed.entries
    // LastPass writes an empty date as "," (month,year), which says nothing worth keeping.
    .filter(([key, value]) => !skip.has(key.toLowerCase()) && value.replace(/[\s,]/gu, "") !== "")
    .map(([key, value]) => `${key}: ${value.trim()}`);
  const notes = typed.fields.get("notes") ?? "";
  return [...lines, ...(notes === "" ? [] : [notes])].join("\n");
}

type TypedNote = Readonly<{
  type: string;
  fields: ReadonlyMap<string, string>;
  entries: readonly (readonly [string, string])[];
}>;

/**
 * Reads the `Key:Value` lines of a typed note. `Notes:` is always last in a LastPass export and
 * runs to the end, so newlines after it belong to the note text, not to new keys.
 */
export function parseTypedNote(extra: string): TypedNote | null {
  const lines = extra.split(/\r?\n/u);
  const first = lines[0] ?? "";
  if (!first.startsWith("NoteType:")) return null;
  const type = first.slice("NoteType:".length).trim();
  const fields = new Map<string, string>();
  const entries: [string, string][] = [];
  let noteText: string[] | null = null;
  for (const line of lines.slice(1)) {
    if (noteText !== null) {
      noteText.push(line);
      continue;
    }
    const colon = line.indexOf(":");
    if (colon <= 0) {
      const previous = entries[entries.length - 1];
      if (previous !== undefined) previous[1] += `\n${line}`;
      continue;
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1);
    if (key.toLowerCase() === "notes") {
      noteText = [value];
      continue;
    }
    entries.push([key, value]);
  }
  if (noteText !== null) entries.push(["Notes", noteText.join("\n")]);
  for (const [key, value] of entries) fields.set(key.toLowerCase(), value.trim());
  return { type, fields, entries };
}

export type { LoginCustomField };
