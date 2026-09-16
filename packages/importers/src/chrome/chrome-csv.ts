import { parseCsv } from "../common/csv-parser";
import { warningLabel } from "../common/clamp";
import { newItemBase } from "../common/item-base";
import type { ImportResult } from "../common/import-result";
import { emitLogin } from "../common/login-candidate";
import { IMPORT_LIMITS } from "../import-model";

/**
 * Imports a Chrome "Passwords" export CSV (`name,url,username,password,note`).
 * Rows with an empty password are skipped and reported as a warning, since
 * they cannot become a meaningful login item.
 */
export function importChromeCsv(text: string): ImportResult {
  const { rows } = parseCsv(text);
  const items: ImportResult["items"] = [];
  const warnings: string[] = [];

  const limit = IMPORT_LIMITS.maxThirdPartyEntries;
  const truncated = rows.length > limit;
  const bounded = truncated ? rows.slice(0, limit) : rows;
  if (truncated)
    warnings.push(
      `Only the first ${limit} rows were imported; ${rows.length - limit} row(s) were skipped.`,
    );

  for (const row of bounded) {
    const name = (row["name"] ?? "").trim();
    const url = (row["url"] ?? "").trim();
    const username = row["username"] ?? "";
    const password = row["password"] ?? "";
    const note = row["note"] ?? "";
    const label = warningLabel(name || url, "unnamed");

    if (!password) {
      warnings.push(`Skipped "${label}": empty password`);
      continue;
    }

    emitLogin(
      newItemBase(),
      {
        name: name || url || "Imported login",
        username,
        password,
        urls: url ? [url] : [],
        notes: note,
      },
      label,
      warnings,
      items,
    );
  }

  return { items, warnings };
}
