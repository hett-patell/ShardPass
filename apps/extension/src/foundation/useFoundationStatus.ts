import { FoundationResponseSchema, type FoundationResponse } from "@shardpass/messaging";
import { useEffect, useState } from "react";

import type { ExtensionPlatform } from "../platform/extension-platform";

export type FoundationStatusState =
  | Readonly<{ state: "loading" }>
  | Readonly<{ state: "ready"; status: FoundationResponse }>
  | Readonly<{ state: "error"; reason?: string }>;

/** The background's own diagnosis (code and where), never a raw message from an unknown source. */
function reasonOf(error: unknown): string | undefined {
  const candidate = error as { code?: unknown; detail?: unknown } | null;
  if (typeof candidate?.code !== "string") return undefined;
  return typeof candidate.detail === "string" && candidate.detail !== "" ? `${candidate.code} — ${candidate.detail}` : candidate.code;
}

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
        if (parsed.success) {
          setStatus({ state: "ready", status: parsed.data });
          return;
        }
        // The background answered with its error envelope: its code and detail are the
        // diagnosis (a failed startup names its step there).
        const envelope = response as { kind?: unknown; error?: { code?: unknown; detail?: unknown } } | null;
        const reason =
          envelope?.kind === "error" && typeof envelope.error?.code === "string"
            ? reasonOf(envelope.error)
            : "unexpected reply from the background";
        setStatus(reason === undefined ? { state: "error" } : { state: "error", reason });
      },
      (error: unknown) => {
        if (active) {
          const reason = reasonOf(error);
          setStatus(reason === undefined ? { state: "error" } : { state: "error", reason });
        }
      },
    );

    return () => {
      active = false;
    };
  }, [platform]);

  return status;
}
