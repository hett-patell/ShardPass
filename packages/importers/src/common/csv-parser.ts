/**
 * CSV parser shared by the password manager importers (Chrome, Firefox, 1Password,
 * Bitwarden). RFC 4180 as the exports actually write it: quoted fields, doubled quotes
 * inside them, a leading UTF-8 BOM, CRLF or LF, and -- the part that matters for real
 * vaults -- newlines inside a quoted field. Notes are multi-line more often than not;
 * splitting the file into lines before parsing quotes shifted every column of every row
 * after the first such note.
 */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const records = parseRecords(text.startsWith("﻿") ? text.slice(1) : text).filter((record) =>
    record.some((field) => field.trim().length > 0),
  );
  const headers = records[0];
  if (headers === undefined) return { headers: [], rows: [] };
  const rows = records.slice(1).map((values) => {
    const row: Record<string, string> = {};
    for (let index = 0; index < headers.length; index++) {
      row[headers[index]!] = values[index] ?? "";
    }
    // An unquoted comma in the last column (a hand-made file's note) must not lose its tail.
    if (values.length > headers.length && headers.length > 0)
      row[headers[headers.length - 1]!] = values.slice(headers.length - 1).join(",");
    return row;
  });
  return { headers, rows };
}

function parseRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === ",") {
      record.push(field);
      field = "";
      index += 1;
      continue;
    }
    if (char === "\r" || char === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      index += char === "\r" && text[index + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += char;
    index += 1;
  }
  // A final record without a trailing newline (and an unterminated quote is read as text).
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}
