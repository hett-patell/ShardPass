import { searchableText, type Folder, type VaultItem } from "@shardpass/domain";
import { parseItemCrudResponseForRequest } from "@shardpass/messaging";
import type { CategoryKey } from "@shardpass/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import { folderSubtreeIds } from "../item-support";

export type VaultStateStatus = "idle" | "loading" | "ready" | "error";

export interface UseVaultStateResult {
  /** Every non-deleted item in the vault, unfiltered — the source for sidebar counts. */
  allItems: readonly VaultItem[];
  /** `allItems` narrowed by the current category, folder, and search text. */
  items: readonly VaultItem[];
  status: VaultStateStatus;
  archived: boolean;
  setArchived: (archived: boolean) => void;
  category: CategoryKey;
  setCategory: (category: CategoryKey) => void;
  folderId: string | null;
  setFolderId: (folderId: string | null) => void;
  search: string;
  setSearch: (search: string) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  /** Re-fetches the full item list, e.g. after a create/update/delete. */
  refresh: () => void;
}

const emptyItems: readonly VaultItem[] = [];
const noFolders: readonly Folder[] = Object.freeze([]);

function normalizeSearch(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

function matchesSearch(item: VaultItem, query: string): boolean {
  if (query.length === 0) return true;
  return searchableText(item).some((value) => normalizeSearch(value).includes(query));
}

/**
 * Loads the full vault item set via `item.query` (vault-only, full secrets included)
 * and exposes client-side category/folder/search filtering plus selection state for
 * the three-panel vault layout. Filtering happens in memory rather than as separate
 * round trips so sidebar counts always reflect the complete vault regardless of the
 * active category filter.
 */
export function useVaultState(
  platform: Pick<ExtensionPlatform, "sendMessage">,
  active: boolean,
  folders: readonly Folder[] = noFolders,
): UseVaultStateResult {
  const [allItems, setAllItems] = useState<readonly VaultItem[]>(emptyItems);
  const [status, setStatus] = useState<VaultStateStatus>(active ? "loading" : "idle");
  const [category, setCategory] = useState<CategoryKey>("all");
  const [folderId, setFolderId] = useState<string | null>(null);
  // The Archive view is a separate query, not a client-side filter: the background keeps
  // archived items out of every ordinary listing and only hands them over when asked.
  const [archived, setArchived] = useState(false);
  // Selecting a folder shows everything filed beneath it too, the way a file browser's
  // scope works; a bare id match would hide items sitting in sub-folders.
  const folderScope = useMemo(
    () => (folderId === null ? new Set<string>() : folderSubtreeIds(folders, folderId)),
    [folders, folderId],
  );
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(() => {
    const token = ++generation.current;
    setStatus((current) => (current === "ready" ? current : "loading"));
    const queryRequest = { version: 1 as const, kind: "item.query" as const, ...(archived ? { archived: true } : {}) };
    platform.sendMessage(queryRequest).then(
      (candidate) => {
        if (token !== generation.current) return;
        const parsed = parseItemCrudResponseForRequest(queryRequest, candidate);
        if (parsed.success && parsed.data.kind === "item.queryResult") {
          setAllItems(parsed.data.items);
          setStatus("ready");
        } else {
          setAllItems(emptyItems);
          setStatus("error");
        }
      },
      () => {
        if (token !== generation.current) return;
        setAllItems(emptyItems);
        setStatus("error");
      },
    );
  }, [platform, archived]);

  useEffect(() => {
    if (!active) {
      generation.current += 1;
      setAllItems(emptyItems);
      setStatus("idle");
      setSelectedId(null);
      setCategory("all");
      setFolderId(null);
      setArchived(false);
      setSearch("");
      return;
    }
    load();
  }, [active, load]);

  const refresh = useCallback(() => {
    if (active) load();
  }, [active, load]);

  const query = normalizeSearch(search);
  const items = allItems.filter((item) => {
    if (category !== "all" && item.kind !== category) return false;
    if (folderId !== null && (item.folderId === undefined || !folderScope.has(item.folderId)))
      return false;
    return matchesSearch(item, query);
  });

  return {
    allItems,
    items,
    status,
    category,
    setCategory,
    folderId,
    setFolderId,
    search,
    setSearch,
    selectedId,
    setSelectedId,
    refresh,
    archived,
    setArchived,
  };
}

/** Item counts per category (plus "all"), used to annotate the sidebar's CategoryNav. */
export function countByKind(items: readonly VaultItem[]): Partial<Record<CategoryKey, number>> {
  const counts: Partial<Record<CategoryKey, number>> = { all: items.length };
  for (const item of items) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  return counts;
}
