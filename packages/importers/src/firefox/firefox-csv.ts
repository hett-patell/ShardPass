import { parseCsv } from "../common/csv-parser";
import { warningLabel } from "../common/clamp";
import { newItemBase } from "../common/item-base";
import type { ImportResult } from "../common/import-result";
import { emitLogin } from "../common/login-candidate";
import { IMPORT_LIMITS } from "../import-model";

/**
 * Imports a Firefox "Saved Logins" export CSV:
 * `url,username,password,httpRealm,formActionOrigin,guid,timeCreated,timeLastUsed,timePasswordChanged`.
 *
 * Firefox exports have no site name column, so the login name is derived
 * from the URL's hostname. `timeCreated`/`timePasswordChanged` (epoch
 * milliseconds) are used for `createdAt`/`updatedAt` when present and valid;
 * otherwise the current time is used.
 */
export function importFirefoxCsv(text: string): ImportResult {
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
    const url = (row["url"] ?? "").trim();
    const username = row["username"] ?? "";
    const password = row["password"] ?? "";
    const label = warningLabel(url, "unnamed");

    if (!password) {
      warnings.push(`Skipped "${label}": empty password`);
      continue;
    }

    const base = newItemBase();
    const createdAt = epochMillisToIso(row["timeCreated"]) ?? base.createdAt;
    const updatedAt =
      epochMillisToIso(row["timePasswordChanged"]) ??
      epochMillisToIso(row["timeLastUsed"]) ??
      createdAt;

    emitLogin(
      { ...base, createdAt, updatedAt },
      { name: deriveName(url), username, password, urls: url ? [url] : [], notes: "" },
      label,
      warnings,
      items,
    );
  }

  return { items, warnings };
}

function deriveName(url: string): string {
  if (!url) return "Imported login";
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

function epochMillisToIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const millis = Number(value);
  if (!Number.isFinite(millis) || millis <= 0) return undefined;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}
