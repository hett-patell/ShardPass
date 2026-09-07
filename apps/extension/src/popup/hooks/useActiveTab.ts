import { useEffect, useState } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";

export type ActiveTab = Readonly<{ id: number; url: string; host: string }>;

/** The http(s) tab the popup opened over, or null; resolved once per popup lifetime. */
export function useActiveTab(platform: Pick<ExtensionPlatform, "activeTab">): ActiveTab | null {
  const [tab, setTab] = useState<ActiveTab | null>(null);
  useEffect(() => {
    let cancelled = false;
    void platform
      .activeTab()
      .then((candidate) => {
        if (cancelled || candidate === null) return;
        try {
          const url = new URL(candidate.url);
          if (url.protocol !== "https:" && url.protocol !== "http:") return;
          setTab({ id: candidate.id, url: candidate.url, host: url.host });
        } catch {
          // Not a page a login could belong to (chrome://, file:, a new tab).
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [platform]);
  return tab;
}
