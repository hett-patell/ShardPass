import { useCallback, useState } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import type { ActiveTab } from "./useActiveTab";

const FILL_TIMEOUT_MS = 3_000;

export type DataFillOutcome = "filled" | "no-form" | "no-tab" | "no-script" | "reprompt" | "failed";
const NO_RECEIVER = /Receiving end does not exist|Could not establish connection/u;

/**
 * Fills a card or an identity into the open tab: the background is asked to grant this tab
 * one release for the item, then the tab's content script collects it and fills. Only the
 * frame with matching fields answers; silence within the timeout reads as "no form".
 */
export function useFillDataIntoTab(
  platform: Pick<ExtensionPlatform, "sendMessage" | "sendToTab">,
  tab: ActiveTab | null,
) {
  const [filling, setFilling] = useState<string | null>(null);
  const fill = useCallback(
    async (itemId: string): Promise<DataFillOutcome> => {
      if (tab === null || !/^https?:/u.test(tab.url)) return "no-tab";
      setFilling(itemId);
      try {
        const granted = (await platform.sendMessage({
          version: 1,
          kind: "data.fillGrant",
          itemId,
          tabId: tab.id,
        })) as { kind?: unknown; error?: { code?: unknown } } | null;
        if (granted?.kind !== "data.fillGranted")
          return granted?.error?.code === "REPROMPT_REQUIRED" ? "reprompt" : "failed";
        const response = await Promise.race<unknown>([
          platform.sendToTab(tab.id, { version: 1, kind: "data.fillFromPopup", itemId }),
          new Promise<undefined>((resolve) =>
            setTimeout(() => resolve(undefined), FILL_TIMEOUT_MS),
          ),
        ]);
        const status = (response as { status?: unknown } | undefined)?.status;
        return status === "filled"
          ? "filled"
          : status === "no-form" || status === undefined
            ? "no-form"
            : "failed";
      } catch (error) {
        return error instanceof Error && NO_RECEIVER.test(error.message) ? "no-script" : "failed";
      } finally {
        setFilling(null);
      }
    },
    [platform, tab],
  );
  return { fill, filling };
}
