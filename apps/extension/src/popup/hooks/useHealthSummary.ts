import {
  parseItemCrudResponseForRequest,
  parseSecurityResponseForRequest,
  type ItemListItemProjection,
} from "@shardpass/messaging";
import { useEffect, useMemo, useState } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";

export interface HealthSummary {
  /** Logins sharing a password with another login. */
  reused: number;
  /** Logins saved for a plain http:// site. */
  unsecured: number;
  /** Logins whose current password a breach check found in known breaches. */
  breached: number;
}

/**
 * What the vault's Health page would flag, as three numbers. The reused and unencrypted
 * counts come from the background, which holds the passwords; breaches are the results the
 * vault already remembers, counted only for logins still in the vault and only while the
 * password checked is the one still saved. Nothing here asks Have I Been Pwned anything.
 * Null until both answers are in, and whenever either fails: a guess would be worse.
 */
export function useHealthSummary(
  platform: Pick<ExtensionPlatform, "sendMessage">,
  active: boolean,
  items: readonly ItemListItemProjection[],
): HealthSummary | null {
  const [counts, setCounts] = useState<{ reused: number; unsecured: number } | null>(null);
  const [breachedIds, setBreachedIds] = useState<readonly string[] | null>(null);

  useEffect(() => {
    if (!active) {
      setCounts(null);
      setBreachedIds(null);
      return;
    }
    let live = true;
    const summaryRequest = { version: 1 as const, kind: "item.healthSummary" as const };
    platform.sendMessage(summaryRequest).then(
      (candidate) => {
        if (!live) return;
        const parsed = parseItemCrudResponseForRequest(summaryRequest, candidate);
        setCounts(
          parsed.success && parsed.data.kind === "item.healthSummaryResult"
            ? { reused: parsed.data.reused, unsecured: parsed.data.unsecured }
            : null,
        );
      },
      () => live && setCounts(null),
    );
    const resultsRequest = { version: 1 as const, kind: "security.listResults" as const };
    platform.sendMessage(resultsRequest).then(
      (candidate) => {
        if (!live) return;
        const parsed = parseSecurityResponseForRequest(resultsRequest, candidate);
        setBreachedIds(
          parsed.success && parsed.data.kind === "security.results"
            ? parsed.data.results
                .filter((result) => result.count > 0 && !result.stale)
                .map((result) => result.itemId)
            : null,
        );
      },
      () => live && setBreachedIds(null),
    );
    return () => {
      live = false;
    };
    // The list changing (an import, a delete elsewhere) is when the counts can change.
  }, [active, items, platform]);

  return useMemo(() => {
    if (counts === null || breachedIds === null) return null;
    const logins = new Set(items.filter((item) => item.kind === "login").map((item) => item.id));
    return { ...counts, breached: breachedIds.filter((id) => logins.has(id)).length };
  }, [breachedIds, counts, items]);
}
