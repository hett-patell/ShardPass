import { createFolderIndex, type ImportResult } from "../common/import-result";
import { IMPORT_LIMITS } from "../import-model";
import { convertEntry } from "./classify";
import { readKdbx } from "./kdbx-read";

export { KdbxFormatError, KdbxPasswordError } from "./kdbx-binary";
export { classifyEntry, convertEntry } from "./classify";
export { keyFileKey } from "./kdbx-decrypt";
export { kdbxTime, readKdbx, type KeePassEntry, type KeePassHistoryEntry } from "./kdbx-read";

/**
 * Imports a KeePass KDBX 4 database.
 *
 * Unlike the CSV importers this can fail as a whole: wrong credentials or a corrupt file yield
 * no items at all, so those surface as thrown errors ({@link KdbxPasswordError},
 * {@link KdbxFormatError}) rather than warnings. Per-entry problems remain warnings.
 */
export async function importKeePassKdbx(
  file: Uint8Array,
  password: string,
  keyFile?: Uint8Array,
): Promise<ImportResult> {
  const database = await readKdbx(file, password, keyFile);
  const items: ImportResult["items"] = [];
  const warnings: string[] = [];

  if (database.skippedRecycleBin > 0)
    warnings.push(
      `Skipped ${database.skippedRecycleBin} entr${database.skippedRecycleBin === 1 ? "y" : "ies"} in the KeePass recycle bin.`,
    );

  // KeePass groups become folders, mirroring the database's own tree.
  const folderIndex = createFolderIndex();
  const limit = IMPORT_LIMITS.maxThirdPartyEntries;
  for (const entry of database.entries) {
    if (items.length >= limit) {
      warnings.push(`Only the first ${limit} entries were imported; the rest were skipped.`);
      break;
    }
    const folderId = folderIndex.idFor(entry.path);
    const outcome = convertEntry(entry, folderId);
    items.push(...outcome.items);
    warnings.push(...outcome.warnings);
  }

  const folders = folderIndex.folders();
  return folders.length === 0 ? { items, warnings } : { items, warnings, folders };
}
