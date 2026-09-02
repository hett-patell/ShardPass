import { FoundationResponseSchema, type FoundationResponse } from "@shardpass/messaging";
import { useEffect, useState } from "react";

import type { ExtensionPlatform } from "../platform/extension-platform";

export type FoundationStatusState =
  | Readonly<{ state: "loading" }>
  | Readonly<{ state: "ready"; status: FoundationResponse }>
  | Readonly<{ state: "error" }>;

const foundationRequest = {
  version: 1,
  kind: "foundation.getStatus",
} as const;

export function useFoundationStatus(platform: ExtensionPlatform): FoundationStatusState {
  const [status, setStatus] = useState<FoundationStatusState>({ state: "loading" });

  useEffect(() => {
    let active = true;

    void platform.sendMessage(foundationRequest).then(
      (response) => {
        if (!active) {
          return;
        }

        const parsed = FoundationResponseSchema.safeParse(response);
        setStatus(parsed.success ? { state: "ready", status: parsed.data } : { state: "error" });
      },
      () => {
        if (active) {
          setStatus({ state: "error" });
        }
      },
    );

    return () => {
      active = false;
    };
  }, [platform]);

  return status;
}
