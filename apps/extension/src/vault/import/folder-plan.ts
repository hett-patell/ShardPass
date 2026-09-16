import {
  MAX_FOLDERS,
  MAX_FOLDER_DEPTH,
  MAX_FOLDER_NAME_LENGTH,
  type Folder,
} from "@shardpass/domain";
import type { ImportFolder } from "@shardpass/importers";

/** A folder the import will create or reuse, with any over-deep source folders folded in. */
export type PlannedFolder = ImportFolder &
  Readonly<{
    /** True when the name joins several source levels that sat deeper than the vault allows. */
    folded: boolean;
  }>;

export type FolderPlan = Readonly<{
  /** Every folder the selected items need, parents before children. */
  folders: readonly PlannedFolder[];
  /** Source folder id (as items reference it) to planned folder id. */
  remap: ReadonlyMap<string, string>;
  /** Planned folder id to the id of a same-named folder already in the vault. */
  reused: ReadonlyMap<string, string>;
  /** Folders that will actually be created, parents first, within the vault's limit. */
  creatable: readonly PlannedFolder[];
  /** Planned folder ids that cannot be created because the vault would exceed its limit. */
  overLimit: ReadonlySet<string>;
  /** Source folders folded into a shallower one because they sat deeper than allowed. */
  collapsed: number;
  /** Selected items that will be imported without a folder because theirs cannot exist. */
  unfiledItems: number;
}>;

const PATH_SEPARATOR = " / ";

export function sameFolderName(left: string, right: string): boolean {
  return (
    left.normalize("NFKC").toLocaleLowerCase("en-US") ===
    right.normalize("NFKC").toLocaleLowerCase("en-US")
  );
}

function nameKey(name: string): string {
  return name.normalize("NFKC").toLocaleLowerCase("en-US");
}

function clampFolderName(name: string): string {
  const scalars = Array.from(name.trim());
  return scalars.length <= MAX_FOLDER_NAME_LENGTH
    ? scalars.join("")
    : scalars.slice(0, MAX_FOLDER_NAME_LENGTH).join("").trim();
}

/**
 * Works out, before anything is written, which folders an import will create, which it will
 * reuse, and which it cannot have. Paths deeper than the vault allows are folded into the
 * deepest allowed level under a joined name ("Acme / 2024 / Q1"), so nothing lands in the
 * wrong place; once the vault's folder count would be exceeded, the remaining folders are
 * left uncreated and their items are imported unfiled, and the preview says so.
 */
export function planFolders(
  source: readonly ImportFolder[],
  itemFolderIds: readonly (string | undefined)[],
  existing: readonly Folder[],
): FolderPlan {
  const byId = new Map(source.map((folder) => [folder.id, folder]));
  const pathOf = (id: string): string[] => {
    const names: string[] = [];
    const seen = new Set<string>();
    let current = byId.get(id);
    while (current !== undefined && !seen.has(current.id)) {
      seen.add(current.id);
      const name = current.name.trim();
      if (name !== "") names.unshift(name);
      current = current.parentId === undefined ? undefined : byId.get(current.parentId);
    }
    return names;
  };

  type Mutable = { id: string; name: string; parentId?: string; folded: boolean };
  const plannedByPath = new Map<string, Mutable>();
  const order: Mutable[] = [];
  const ensure = (names: readonly string[]): Mutable | undefined => {
    let parent: Mutable | undefined;
    let key = "";
    for (const name of names) {
      key = `${key}/${nameKey(name)}`;
      let folder = plannedByPath.get(key);
      if (folder === undefined) {
        folder = {
          id: crypto.randomUUID(),
          name,
          ...(parent === undefined ? {} : { parentId: parent.id }),
          folded: false,
        };
        plannedByPath.set(key, folder);
        order.push(folder);
      }
      parent = folder;
    }
    return parent;
  };

  const remap = new Map<string, string>();
  let collapsed = 0;
  for (const id of new Set(itemFolderIds)) {
    if (id === undefined || !byId.has(id)) continue;
    const names = pathOf(id);
    if (names.length === 0) continue;
    const folded = names.length > MAX_FOLDER_DEPTH;
    const planNames = folded
      ? [
          ...names.slice(0, MAX_FOLDER_DEPTH - 1),
          clampFolderName(names.slice(MAX_FOLDER_DEPTH - 1).join(PATH_SEPARATOR)),
        ]
      : names;
    const leaf = ensure(planNames);
    if (leaf === undefined) continue;
    if (folded) {
      collapsed += 1;
      leaf.folded = true;
    }
    remap.set(id, leaf.id);
  }

  // A planned folder is reused when the vault already has one of that name under the same
  // (reused) parent; a child of a folder that does not exist yet cannot exist either.
  const reused = new Map<string, string>();
  for (const folder of order) {
    const parentReal = folder.parentId === undefined ? undefined : reused.get(folder.parentId);
    if (folder.parentId !== undefined && parentReal === undefined) continue;
    const match = existing.find(
      (candidate) =>
        candidate.parentId === parentReal && sameFolderName(candidate.name, folder.name),
    );
    if (match !== undefined) reused.set(folder.id, match.id);
  }

  let budget = MAX_FOLDERS - existing.length;
  const creatable: PlannedFolder[] = [];
  const overLimit = new Set<string>();
  for (const folder of order) {
    if (reused.has(folder.id)) continue;
    const parentBlocked = folder.parentId !== undefined && overLimit.has(folder.parentId);
    if (parentBlocked || budget <= 0) {
      overLimit.add(folder.id);
      continue;
    }
    budget -= 1;
    creatable.push(folder);
  }

  let unfiledItems = 0;
  for (const id of itemFolderIds) {
    if (id === undefined) continue;
    const planned = remap.get(id);
    if (planned === undefined || overLimit.has(planned)) unfiledItems += 1;
  }

  return { folders: order, remap, reused, creatable, overLimit, collapsed, unfiledItems };
}
