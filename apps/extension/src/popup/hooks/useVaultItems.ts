import type { VaultItemKind } from "@shardpass/domain";
import { parseItemCrudResponseForRequest, type ItemListItemProjection } from "@shardpass/messaging";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";

const SEARCH_DEBOUNCE_MS = 200;
const emptyItems: readonly ItemListItemProjection[] = [];

export type VaultItemsFilter = VaultItemKind | "all";

export type VaultItemsStatus = "error" | "loading" | "locked" | "ready";

export interface UseVaultItemsResult {
  filter: VaultItemsFilter;
  items: readonly ItemListItemProjection[];
  refresh(): void;
  search: string;
  setFilter(filter: VaultItemsFilter): void;
  setSearch(search: string): void;
  status: VaultItemsStatus;
}

/**
 * Fetches the popup-safe item list (item.list — see ItemListItemProjectionSchema in
 * @shardpass/messaging) for the unlocked vault, filtered by kind and search text.
 * `active` should track whether the vault is currently unlocked: while inactive no
 * request is sent and the list is cleared, and becoming active triggers an immediate
 * (non-debounced) fetch so the list appears as soon as the popup unlocks.
 */
export function useVaultItems(
  platform: Pick<ExtensionPlatform, "sendMessage">,
  active: boolean,
): UseVaultItemsResult {
  const [filter, setFilter] = useState<VaultItemsFilter>("all");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<VaultItemsStatus>(active ? "loading" : "locked");
  const [items, setItems] = useState<readonly ItemListItemProjection[]>(emptyItems);
  const generation = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const previous = useRef({ active, filter, search });

  const load = useCallback(
    (query: string) => {
      const token = ++generation.current;
      const request = {
        version: 1 as const,
        kind: "item.list" as const,
        itemKind: filter === "all" ? undefined : filter,
        search: query.length > 0 ? query : undefined,
      };
      void platform
        .sendMessage(request)
        .then((candidate) => {
          if (generation.current !== token) return;
          const parsed = parseItemCrudResponseForRequest(request, candidate);
          if (parsed.success && parsed.data.kind === "item.listResult") {
            setItems(parsed.data.items);
            setStatus("ready");
          } else {
            setItems(emptyItems);
            setStatus("error");
          }
        })
        .catch(() => {
          if (generation.current !== token) return;
          setItems(emptyItems);
          setStatus("error");
        });
    },
    [filter, platform],
  );

  const refresh = useCallback(() => {
    if (!active) return;
    setStatus((current) => (current === "ready" ? current : "loading"));
    load(search);
  }, [active, load, search]);

  useEffect(() => {
    const previousValues = previous.current;
    const activated = active && !previousValues.active;
    const filterChanged = filter !== previousValues.filter;
    const searchChanged = search !== previousValues.search;
    previous.current = { active, filter, search };

    if (debounceTimer.current !== undefined) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = undefined;
    }

    if (!active) {
      generation.current += 1;
      setItems(emptyItems);
      setStatus("locked");
      return;
    }

    setStatus((current) => (current === "ready" ? current : "loading"));
    const onlySearchChanged = searchChanged && !activated && !filterChanged;
    if (onlySearchChanged) {
      debounceTimer.current = setTimeout(() => load(search), SEARCH_DEBOUNCE_MS);
      return () => {
        if (debounceTimer.current !== undefined) clearTimeout(debounceTimer.current);
      };
    }
    load(search);
    return undefined;
  }, [active, filter, search, load]);

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  return { filter, items, refresh, search, setFilter, setSearch, status };
}
