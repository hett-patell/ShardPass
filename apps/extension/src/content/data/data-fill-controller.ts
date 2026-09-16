import {
  detectCardFields,
  detectIdentityFields,
  fillCardFields,
  fillIdentityFields,
} from "@shardpass/autofill";

import type { DataFillContentPlatform } from "../../platform/extension-platform";

export interface DataFillController {
  start(): void;
  dispose(): void;
}

type FillFromPopup = Readonly<{ version?: unknown; kind?: unknown; itemId?: unknown }>;

/**
 * Fills a card or an identity when the popup asks. The popup has already granted this tab
 * one release for the item; the content script collects it, finds the page's fields and
 * writes them, then tells the popup what happened. A frame with no such fields stays
 * silent, so the popup hears from the frame that filled, or times out.
 */
export function createDataFillController(
  options: Readonly<{ document: Document; platform: DataFillContentPlatform }>,
): DataFillController {
  let dispose: (() => void) | null = null;

  const answer = (status: "filled" | "no-form" | "failed", filled = 0) => ({
    version: 1,
    kind: "data.fillFromPopupResult",
    status,
    filled,
  });

  const onMessage = (payload: unknown, senderMetadata: unknown): Promise<unknown> => {
    const request = payload as FillFromPopup | null;
    if (request?.kind !== "data.fillFromPopup") return new Promise(() => undefined);
    const meta = senderMetadata as { extensionId?: unknown; tabId?: unknown } | null;
    if (
      meta?.extensionId !== options.platform.extensionId ||
      meta.tabId !== undefined ||
      typeof request.itemId !== "string"
    )
      return Promise.resolve(answer("failed"));
    const itemId = request.itemId;
    // Only the top frame answers: the background releases the values to it alone, and a
    // silent frame lets the popup hear from the one that filled.
    const view = options.document.defaultView;
    if (view === null || view.top !== view) return new Promise(() => undefined);
    // Look for fields before asking, so a page with none never collects the values at all.
    const cardFields = detectCardFields(options.document);
    const identityFields = detectIdentityFields(options.document);
    if (cardFields.length === 0 && identityFields.length === 0)
      return Promise.resolve(answer("no-form"));
    return (async () => {
      let release;
      try {
        release = await options.platform.sendDataFillMessage({
          version: 1,
          kind: "data.fillSelect",
          itemId,
        });
      } catch {
        return answer("failed");
      }
      if (release.kind !== "data.fillRelease") return answer("failed");
      if (release.data === "card") {
        if (cardFields.length === 0) return answer("no-form");
        return answer("filled", fillCardFields(cardFields, release.card));
      }
      if (identityFields.length === 0) return answer("no-form");
      return answer("filled", fillIdentityFields(identityFields, release.identity));
    })();
  };

  return {
    start() {
      if (dispose !== null) return;
      dispose = options.platform.onMessage(onMessage);
    },
    dispose() {
      dispose?.();
      dispose = null;
    },
  };
}
