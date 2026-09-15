import { useCallback, useState } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import type { ActiveTab } from "./useActiveTab";

const FILL_TIMEOUT_MS = 3_000;

export type FillOutcome = "filled" | "no-form" | "no-script" | "no-tab" | "failed";

/** Chrome's wording when no content script is listening: a tab opened before install or reload. */
const NO_RECEIVER = /Receiving end does not exist|Could not establish connection/u;

/**
 * Asks the open tab's content script to fill a login. The content script performs the
 * credential release itself under its own content-only policy; the popup only names the item.
 * Frames without a login form stay silent, so a timeout stands in for "no form anywhere".
 */
export function useFillIntoTab(
  platform: Pick<ExtensionPlatform, "sendToTab">,
  tab: ActiveTab | null,
) {
  const [filling, setFilling] = useState<string | null>(null);
  const fill = useCallback(
    async (itemId: string, expectedRevision: number): Promise<FillOutcome> => {
      // No eligible tab at all (a chrome:// page, a PDF): not "no form on this page".
      if (tab === null) return "no-tab";
      setFilling(itemId);
      try {
        const response = await Promise.race<unknown>([
          platform.sendToTab(tab.id, {
            version: 1,
            kind: "login.fillFromPopup",
            itemId,
            expectedRevision,
          }),
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
