import type { VaultItem } from "@shardpass/domain";

/**
 * The result of running a third-party password manager importer.
 *
 * Importers never throw for malformed or partially-invalid input — a row or
 * entry that cannot be turned into a valid {@link VaultItem} is reported as a
 * warning instead, so a single bad row never aborts the rest of the import.
 */
export interface ImportResult {
  items: VaultItem[];
  warnings: string[];
  /**
   * Folders the source organised its items into (Bitwarden folders, KeePass groups). Ids are
   * provisional: items reference them through `folderId`, and the importer UI creates real
   * folders (parents first, reusing same-named ones) and rewrites the ids before saving.
   */
  folders?: ImportFolder[];
}

export interface ImportFolder {
  id: string;
  name: string;
  parentId?: string;
}

/** Builds provisional folders from paths, sharing prefixes, for `ImportResult.folders`. */
export function createFolderIndex(): {
  idFor(path: readonly string[]): string | undefined;
  folders(): ImportFolder[];
} {
  const byPath = new Map<string, ImportFolder>();
  return {
    idFor(path) {
      let parentId: string | undefined;
      let key = "";
      for (const rawName of path) {
        const name = Array.from(rawName.trim()).slice(0, 80).join("").trim();
        if (name === "") continue;
        key = `${key}/${name.toLowerCase()}`;
        let folder = byPath.get(key);
        if (folder === undefined) {
          folder = {
            id: crypto.randomUUID(),
            name,
            ...(parentId === undefined ? {} : { parentId }),
          };
          byPath.set(key, folder);
        }
        parentId = folder.id;
      }
      return parentId;
    },
    folders: () => [...byPath.values()],
  };
}
