import {
  compareItems,
  matchesQuery,
  parseQuery,
  type Folder,
  type VaultItem,
  type VaultSort,
} from "@shardpass/domain";
import { parseItemCrudResponseForRequest } from "@shardpass/messaging";
import type { CategoryKey } from "@shardpass/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import { folderSubtreeIds } from "../item-support";

export type VaultStateStatus = "idle" | "loading" | "ready" | "error";

export interface UseVaultStateResult {
  /** Every non-deleted item in the vault, unfiltered — the source for sidebar counts. */
  allItems: readonly VaultItem[];
  /** Items whose secrets were withheld until the master password is given again. */
  redactedIds: ReadonlySet<string>;
  /** The live vault, unaffected by the Archive view's own query; drives sidebar counts. */
  liveItems: readonly VaultItem[];
  /** `allItems` narrowed by the current category, folder, and search text. */
  items: readonly VaultItem[];
  status: VaultStateStatus;
  archived: boolean;
  setArchived: (archived: boolean) => void;
  /** True while the list shows Recently deleted. Never at the same time as `archived`. */
  deleted: boolean;
  setDeleted: (deleted: boolean) => void;
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

type VaultScope = "live" | "archived" | "deleted";

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
  const [redactedIds, setRedactedIds] = useState<ReadonlySet<string>>(() => new Set());
  // The live (non-archived) vault, kept while the Archive view runs its own query, so
  // sidebar counts never turn into archived-only numbers.
  const [liveItems, setLiveItems] = useState<readonly VaultItem[]>(emptyItems);
  const loadedScope = useRef<VaultScope | null>(null);
  const [status, setStatus] = useState<VaultStateStatus>(active ? "loading" : "idle");
  const [category, setCategory] = useState<CategoryKey>("all");
  const [folderId, setFolderId] = useState<string | null>(null);
  // The Archive and Recently deleted views are separate queries, not client-side filters:
  // the background keeps those items out of every ordinary listing and only hands them over
  // when asked. One scope at a time.
  const [scope, setScope] = useState<VaultScope>("live");
  const archived = scope === "archived";
  const deleted = scope === "deleted";
  const setArchived = useCallback(
    (next: boolean) =>
      setScope((current) => (next ? "archived" : current === "archived" ? "live" : current)),
    [],
  );
  const setDeleted = useCallback(
    (next: boolean) =>
      setScope((current) => (next ? "deleted" : current === "deleted" ? "live" : current)),
    [],
  );
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

  // Restoring or deleting from the Archive view changes the live vault too; the sidebar
  // counts come from `liveItems`, so the live list is re-fetched alongside.
  const refreshLive = useCallback(
    (token: number) => {
      const liveRequest = { version: 1 as const, kind: "item.query" as const };
      platform.sendMessage(liveRequest).then(
        (candidate) => {
          if (token !== generation.current) return;
          const parsed = parseItemCrudResponseForRequest(liveRequest, candidate);
          if (parsed.success && parsed.data.kind === "item.queryResult")
            setLiveItems(parsed.data.items);
        },
        () => undefined,
      );
    },
    [platform],
  );

  const load = useCallback(() => {
    const token = ++generation.current;
    // A refresh keeps the current list on screen; switching between live and archive shows
    // the loading state instead of the other view's rows under the new heading.
    if (loadedScope.current !== scope) setAllItems(emptyItems);
    setStatus((current) =>
      current === "ready" && loadedScope.current === scope ? current : "loading",
    );
    const queryRequest = {
      version: 1 as const,
      kind: "item.query" as const,
      ...(scope === "archived" ? { archived: true } : {}),
      ...(scope === "deleted" ? { deleted: true } : {}),
    };
    platform.sendMessage(queryRequest).then(
      (candidate) => {
        if (token !== generation.current) return;
        const parsed = parseItemCrudResponseForRequest(queryRequest, candidate);
        if (parsed.success && parsed.data.kind === "item.queryResult") {
          setAllItems(parsed.data.items);
          setRedactedIds(new Set(parsed.data.redacted ?? []));
          if (scope === "live") setLiveItems(parsed.data.items);
          else refreshLive(token);
          loadedScope.current = scope;
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
  }, [platform, scope, refreshLive]);

  useEffect(() => {
    if (!active) {
      generation.current += 1;
      setAllItems(emptyItems);
      setLiveItems(emptyItems);
      loadedScope.current = null;
      setStatus("idle");
      setSelectedId(null);
      setCategory("all");
      setFolderId(null);
      setScope("live");
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
          if (!matchesCategory(item, category)) return false;
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
      redactedIds,
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
      deleted,
      setDeleted,
    }),
    [
      allItems,
      redactedIds,
      liveItems,
      items,
      status,
      category,
      folderId,
      search,
      sort,
      tagVocabulary,
      selectedId,
      refresh,
      archived,
      setArchived,
      deleted,
      setDeleted,
    ],
  );
}

/** Item counts per category (plus "all"), used to annotate the sidebar's CategoryNav. */
export function countByKind(items: readonly VaultItem[]): Partial<Record<CategoryKey, number>> {
  const counts: Partial<Record<CategoryKey, number>> = { all: items.length };
  for (const item of items) {
    if (item.kind !== "secret") continue;
    if (item.secretType === "api_key") counts.api_key = (counts.api_key ?? 0) + 1;
    if (item.secretType === "ssh_key") counts.ssh_key = (counts.ssh_key ?? 0) + 1;
  }
  for (const item of items) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  return counts;
}

/** "all" takes everything; a kind takes its items; a secret type takes that slice of secrets. */
export function matchesCategory(item: VaultItem, category: CategoryKey): boolean {
  if (category === "all") return true;
  if (category === "api_key" || category === "ssh_key")
    return item.kind === "secret" && item.secretType === category;
  return item.kind === category;
}
