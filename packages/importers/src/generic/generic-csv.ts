import { warningLabel } from "../common/clamp";
import { parseCsv } from "../common/csv-parser";
import { createFolderIndex, type ImportResult } from "../common/import-result";
import { newItemBase } from "../common/item-base";
import { emitLogin } from "../common/login-candidate";
import { boundEntries, folderPath } from "../common/typed-items";

export const GENERIC_CSV_FIELDS = [
  "name",
  "url",
  "username",
  "password",
  "notes",
  "totp",
  "folder",
] as const;
export type GenericCsvField = (typeof GENERIC_CSV_FIELDS)[number];
/** Which column, if any, feeds each login field. */
export type GenericCsvMapping = Readonly<Partial<Record<GenericCsvField, string>>>;

const HINTS: Record<GenericCsvField, readonly string[]> = {
  name: ["name", "title", "account", "site", "label", "item"],
  url: ["url", "website", "web site", "login_uri", "uri", "link", "domain", "hostname"],
  username: [
    "username",
    "user name",
    "user",
    "login",
    "login_username",
    "email",
    "e-mail",
    "account name",
  ],
  password: ["password", "pass", "passwd", "login_password", "pwd", "pw", "secret"],
  notes: ["notes", "note", "extra", "comment", "comments", "description"],
  totp: ["totp", "otp", "otpauth", "login_totp", "one-time password", "2fa", "authenticator"],
  folder: ["folder", "group", "grouping", "category", "vault", "collection", "path"],
};

/** The columns of a CSV, in file order, so the person can map them. */
export function readCsvHeaders(text: string): string[] {
  return parseCsv(text).headers;
}

/** A first guess at which column is which, from header names; the person corrects it. */
export function guessCsvMapping(headers: readonly string[]): GenericCsvMapping {
  const mapping: Partial<Record<GenericCsvField, string>> = {};
  const taken = new Set<string>();
  const key = (header: string) => header.trim().toLowerCase();
  // Exact names for every field first, so "username" is never claimed by "name", then the
  // looser "contains" pass for what is left.
  for (const field of GENERIC_CSV_FIELDS) {
    const exact = headers.find(
      (header) => !taken.has(header) && HINTS[field].includes(key(header)),
    );
    if (exact !== undefined) {
      mapping[field] = exact;
      taken.add(exact);
    }
  }
  for (const field of GENERIC_CSV_FIELDS) {
    if (mapping[field] !== undefined) continue;
    const loose = headers.find(
      (header) => !taken.has(header) && HINTS[field].some((hint) => key(header).includes(hint)),
    );
    if (loose !== undefined) {
      mapping[field] = loose;
      taken.add(loose);
    }
  }
  return mapping;
}

/**
 * Imports any CSV of logins once its columns are mapped. Only the mapped columns are read;
 * a row with neither a password nor a username is skipped, since nothing of it would be
 * worth keeping.
 */
export function importGenericCsv(text: string, mapping: GenericCsvMapping): ImportResult {
  const { rows } = parseCsv(text);
  const items: ImportResult["items"] = [];
  const warnings: string[] = [];
  const folders = createFolderIndex();
  const read = (row: Record<string, string>, field: GenericCsvField): string => {
    const column = mapping[field];
    return column === undefined ? "" : (row[column] ?? "");
  };
  if (mapping.password === undefined && mapping.username === undefined)
    warnings.push("No password or username column is mapped, so no rows could be imported.");
  else
    for (const row of boundEntries(rows, warnings)) {
      const name = read(row, "name").trim();
      const url = read(row, "url").trim();
      const username = read(row, "username");
      const password = read(row, "password");
      const label = warningLabel(name || url || username, "unnamed");
      if (password === "" && username.trim() === "") {
        warnings.push(`Skipped "${label}": no password and no username.`);
        continue;
      }
      if (password === "")
        warnings.push(`"${label}": imported without a password (the file has none).`);
      const totp = read(row, "totp").trim();
      const folderId = folders.idFor(folderPath(read(row, "folder")));
      emitLogin(
        { ...newItemBase(), ...(folderId === undefined ? {} : { folderId }) },
        {
          name: name || hostOf(url) || username.trim() || "Imported login",
          username,
          password,
          urls: url === "" ? [] : [url],
          ...(totp === "" ? {} : { totp }),
          notes: read(row, "notes"),
        },
        label,
        warnings,
        items,
      );
    }
  const folderList = folders.folders();
  return folderList.length === 0 ? { items, warnings } : { items, warnings, folders: folderList };
}

function hostOf(url: string): string {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/iu.test(url) ? url : `https://${url}`).hostname;
  } catch {
    return "";
  }
}
