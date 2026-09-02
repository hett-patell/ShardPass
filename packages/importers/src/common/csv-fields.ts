/**
 * Case-insensitive column lookup for CSV exports whose header names vary
 * across app versions (1Password in particular).
 */
export function buildHeaderIndex(headers: string[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const header of headers) {
    const key = header.trim().toLowerCase();
    if (!index.has(key)) index.set(key, header);
  }
  return index;
}

/**
 * Returns the value of the first matching column name (case-insensitive),
 * or "" if none of the candidate names are present in the header.
 */
export function pickField(
  row: Record<string, string>,
  headerIndex: Map<string, string>,
  ...names: string[]
): string {
  for (const name of names) {
    const original = headerIndex.get(name.toLowerCase());
    if (original !== undefined) {
      const value = row[original];
      if (value !== undefined) return value;
    }
  }
  return "";
}
