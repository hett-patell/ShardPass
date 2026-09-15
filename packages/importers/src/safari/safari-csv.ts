import { warningLabel } from "../common/clamp";
import { buildHeaderIndex, pickField } from "../common/csv-fields";
import { parseCsv } from "../common/csv-parser";
import type { ImportResult } from "../common/import-result";
import { newItemBase } from "../common/item-base";
import { emitLogin } from "../common/login-candidate";
import { boundEntries } from "../common/typed-items";

/**
 * Imports a Safari passwords export (`Title,URL,Username,Password,Notes,OTPAuth`; older
 * versions stop at Password). A row without a password is still kept, with a notice.
 */
export function importSafariCsv(text: string): ImportResult {
  const { headers, rows } = parseCsv(text);
  const index = buildHeaderIndex(headers);
  const items: ImportResult["items"] = [];
  const warnings: string[] = [];
  for (const row of boundEntries(rows, warnings)) {
    const title = pickField(row, index, "title").trim();
    const url = pickField(row, index, "url").trim();
    const label = warningLabel(title || url, "unnamed");
    const password = pickField(row, index, "password");
    if (password === "")
      warnings.push(`"${label}": imported without a password (the export has none).`);
    const totp = pickField(row, index, "otpauth").trim();
    emitLogin(
      newItemBase(),
      {
        name: title || url || "Imported login",
        username: pickField(row, index, "username"),
        password,
        urls: url === "" ? [] : [url],
        ...(totp === "" ? {} : { totp }),
        notes: pickField(row, index, "notes"),
      },
      label,
      warnings,
      items,
    );
  }
  return { items, warnings };
}
