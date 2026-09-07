import { compareItems, matchesQuery, parseQuery, type Folder, type VaultItem, type VaultSort } from "@shardpass/domain";
import { parseItemCrudResponseForRequest } from "@shardpass/messaging";
import type { CategoryKey } from "@shardpass/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import { folderSubtreeIds } from "../item-support";

export type VaultStateStatus = "idle" | "loading" | "ready" | "error";

export interface UseVaultStateResult {
  /** Every non-deleted item in the vault, unfiltered — the source for sidebar counts. */
  allItems: readonly VaultItem[];
  /** The live vault, unaffected by the Archive view's own query; drives sidebar counts. */
  liveItems: readonly VaultItem[];
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
  sort: VaultSort;
  setSort: (value: VaultSort) => void;
  /** Every tag in the vault, for suggestions; case-insensitively unique, sorted. */
  tagVocabulary: readonly string[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  /** Re-fetches the full item list, e.g. after a create/update/delete. */
  refresh: () => void;
}

const emptyItems: readonly VaultItem[] = [];
const noFolders: readonly Folder[] = Object.freeze([]);

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
  // The live (non-archived) vault, kept while the Archive view runs its own query, so
  // sidebar counts never turn into archived-only numbers.
  const [liveItems, setLiveItems] = useState<readonly VaultItem[]>(emptyItems);
  const loadedArchived = useRef<boolean | null>(null);
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
  const [sort, setSort] = useState<VaultSort>("name");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(() => {
    const token = ++generation.current;
    // A refresh keeps the current list on screen; switching between live and archive shows
    // the loading state instead of the other view's rows under the new heading.
    setStatus((current) => (current === "ready" && loadedArchived.current === archived ? current : "loading"));
    const queryRequest = { version: 1 as const, kind: "item.query" as const, ...(archived ? { archived: true } : {}) };
    platform.sendMessage(queryRequest).then(
      (candidate) => {
        if (token !== generation.current) return;
        const parsed = parseItemCrudResponseForRequest(queryRequest, candidate);
        if (parsed.success && parsed.data.kind === "item.queryResult") {
          setAllItems(parsed.data.items);
          if (!archived) setLiveItems(parsed.data.items);
          loadedArchived.current = archived;
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
      setLiveItems(emptyItems);
      loadedArchived.current = null;
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

  const query = useMemo(() => parseQuery(search), [search]);
  const items = useMemo(
    () =>
      allItems
        .filter((item) => {
          if (category !== "all" && item.kind !== category) return false;
          if (folderId !== null && (item.folderId === undefined || !folderScope.has(item.folderId)))
            return false;
          return matchesQuery(item, query);
        })
        .sort(compareItems(sort)),
    [allItems, category, folderId, folderScope, query, sort],
  );
  const tagVocabulary = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of liveItems)
      for (const tag of item.tags) {
        const key = tag.toLocaleLowerCase("en-US");
        if (!seen.has(key)) seen.set(key, tag);
      }
    return [...seen.values()].sort((left, right) => left.localeCompare(right));
  }, [liveItems]);

  // One stable object per change: callers hang useCallback/useEffect dependencies on it,
  // and a fresh literal every render would re-run those on every keystroke.
  return useMemo(
    () => ({
      allItems,
      liveItems,
      items,
      status,
      category,
      setCategory,
      folderId,
      setFolderId,
      search,
      setSearch,
      sort,
      setSort,
      tagVocabulary,
      selectedId,
      setSelectedId,
      refresh,
      archived,
      setArchived,
    }),
    [allItems, liveItems, items, status, category, folderId, search, sort, tagVocabulary, selectedId, refresh, archived],
  );
}

/** Item counts per category (plus "all"), used to annotate the sidebar's CategoryNav. */
export function countByKind(items: readonly VaultItem[]): Partial<Record<CategoryKey, number>> {
  const counts: Partial<Record<CategoryKey, number>> = { all: items.length };
  for (const item of items) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  return counts;
}
