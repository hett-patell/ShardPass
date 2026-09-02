/**
 * Minimal CSV parser shared by the password manager importers (Chrome,
 * Firefox, 1Password). It supports quoted fields, escaped double quotes
 * (`""`), and a leading UTF-8 BOM, which covers the exports these tools
 * actually produce. It does not support quoted fields containing embedded
 * newlines — none of the supported export formats emit those.
 */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const withoutBom = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const lines = withoutBom.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = parseCsvLine(lines[0]!);
  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]!] = values[i] ?? "";
    }
    return row;
  });

  return { headers, rows };
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        result.push(current);
        current = "";
      } else {
        current += char;
      }
    }
  }
  result.push(current);
  return result;
}
