import { FolderSchema, MAX_FOLDERS, MAX_FOLDER_DEPTH, type Folder } from "@shardpass/domain";
import { z } from "zod/mini";

/**
 * The encrypted folders document, stored as one generation-metadata entry. Folders are
 * vault-wide metadata rather than items: they carry no secret, but their names can be
 * revealing, so they live under the same key and commit as everything else.
 */
export const FoldersDocumentSchema = z
  .strictObject({
    version: z.literal(1),
    folders: z.array(FolderSchema).check(z.maxLength(MAX_FOLDERS)),
  })
  .check(
    z.refine(
      (document) => new Set(document.folders.map((f) => f.id)).size === document.folders.length,
      {
        error: "Folder ids must be unique",
      },
    ),
    z.refine(
      (document) =>
        document.folders.every((f) => folderDepth(document.folders, f.id) <= MAX_FOLDER_DEPTH),
      {
        error: "Folder nesting is too deep or cyclic",
      },
    ),
  );

export type FoldersDocument = z.infer<typeof FoldersDocumentSchema>;

/** Depth of a folder counting itself; Infinity for a missing parent or a cycle. */
export function folderDepth(folders: readonly Folder[], id: string): number {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let depth = 0;
  const seen = new Set<string>();
  let current: string | undefined = id;
  while (current !== undefined) {
    if (seen.has(current)) return Number.POSITIVE_INFINITY;
    seen.add(current);
    const folder = byId.get(current);
    if (folder === undefined) return Number.POSITIVE_INFINITY;
    depth += 1;
    current = folder.parentId;
  }
  return depth;
}

/** The folder and every folder beneath it. */
export function folderSubtree(folders: readonly Folder[], id: string): ReadonlySet<string> {
  const removed = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (
        folder.parentId !== undefined &&
        removed.has(folder.parentId) &&
        !removed.has(folder.id)
      ) {
        removed.add(folder.id);
        grew = true;
      }
    }
  }
  return removed;
}
