import type { VaultItemKind } from "@shardpass/domain";
import { parseQuery } from "@shardpass/domain";
import { parseItemCrudResponseForRequest, type ItemListItemProjection } from "@shardpass/messaging";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";

const emptyItems: readonly ItemListItemProjection[] = [];

export type VaultItemsStatus = "error" | "loading" | "locked" | "ready";

export interface UseVaultItemsResult {
  /** Every item the popup may show (projections: no secrets), sorted by the background. */
  items: readonly ItemListItemProjection[];
  status: VaultItemsStatus;
  refresh(): void;
}

/**
 * Loads the popup-safe projection of the whole vault once the vault is unlocked. The popup
 * filters that list on the client (category, favorites, search, site suggestions): the list
 * is small, and every screen change is then instant instead of a round trip.
 */
export function useVaultItems(
  platform: Pick<ExtensionPlatform, "sendMessage">,
  active: boolean,
): UseVaultItemsResult {
  const [status, setStatus] = useState<VaultItemsStatus>(active ? "loading" : "locked");
  const [items, setItems] = useState<readonly ItemListItemProjection[]>(emptyItems);
  const generation = useRef(0);

  const load = useCallback(() => {
    const token = ++generation.current;
    const request = { version: 1 as const, kind: "item.list" as const };
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
  }, [platform]);

  const refresh = useCallback(() => {
    if (!active) return;
    setStatus((current) => (current === "ready" ? current : "loading"));
    load();
  }, [active, load]);

  useEffect(() => {
    if (!active) {
      generation.current += 1;
      setItems(emptyItems);
      setStatus("locked");
      return;
    }
    setStatus((current) => (current === "ready" ? current : "loading"));
    load();
  }, [active, load]);

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  return { items, status, refresh };
}

export type CategoryId = VaultItemKind | "all" | "favorites";

function normalize(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

/** The text a projection can be found by: name, subtitle, tags, and a login's site hosts. */
/** The same query language as the vault: `#tag` words filter by tag prefix, the rest by text. */
export function projectionMatches(item: ItemListItemProjection, query: string): boolean {
  const parsed = parseQuery(query);
  if (parsed.tags.length > 0) {
    const tags = item.tags.map(normalize);
    if (!parsed.tags.every((tag) => tags.some((candidate) => candidate.startsWith(tag)))) return false;
  }
  if (parsed.terms.length === 0) return true;
  const haystacks = [item.name, item.subtitle ?? "", ...item.tags, ...(item.urls ?? [])].map(normalize);
  return parsed.terms.every((term) => haystacks.some((value) => value.includes(term)));
}

export function itemsInCategory(
  items: readonly ItemListItemProjection[],
  category: CategoryId,
): readonly ItemListItemProjection[] {
  if (category === "all") return items;
  if (category === "favorites") return items.filter((item) => item.favorite);
  return items.filter((item) => item.kind === category);
}
