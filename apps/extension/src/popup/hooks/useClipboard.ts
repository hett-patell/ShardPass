import { useCallback } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import { scheduleClipboardClear } from "../../vault/components/detail/clipboard";

/** Copies a value through the authoritative clipboard path and clears it again later. */
export function useCopy(
  platform: Pick<ExtensionPlatform, "writeAuthoritativeClipboardText">,
  onFeedback: (message: string) => void,
) {
  return useCallback(
    (value: Promise<string> | string, label: string): Promise<void> => {
      const payload = typeof value === "string" ? Promise.resolve(value) : value;
      void payload.catch(() => undefined);
      return platform
        .writeAuthoritativeClipboardText(payload)
        .then(() => {
          scheduleClipboardClear();
          onFeedback(`${label} copied`);
        })
        .catch(() => onFeedback("Copy failed. Try again."));
    },
    [onFeedback, platform],
  );
}
