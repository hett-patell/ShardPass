import type { OtpCodeProjection } from "@shardpass/messaging";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";

export type OtpCodeState =
  | { status: "loading" }
  | { status: "hotp" }
  | { status: "unavailable" }
  | { status: "ready"; code: OtpCodeProjection };

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const value = (error as { code?: unknown }).code;
  return typeof value === "string" ? value : undefined;
}

/** A live one-time code for an OTP item, refreshed as each code expires. HOTP is never read here. */
export function useOtpCode(
  platform: Pick<ExtensionPlatform, "sendOtpMessage">,
  itemId: string | null,
  now: () => number = Date.now,
): OtpCodeState {
  const [state, setState] = useState<OtpCodeState>({ status: "loading" });
  const generation = useRef(0);

  const fetchCode = useCallback(() => {
    if (itemId === null) return;
    const token = ++generation.current;
    void platform.sendOtpMessage({ version: 1, kind: "otp.getCode", itemId }).then(
      (response) => {
        if (generation.current !== token) return;
        if (response.kind === "otp.codeResult") setState({ status: "ready", code: response });
        else setState({ status: "unavailable" });
      },
      (error: unknown) => {
        if (generation.current !== token) return;
        setState({ status: errorCode(error) === "OTP_HOTP_REQUIRED" ? "hotp" : "unavailable" });
      },
    );
  }, [itemId, platform]);

  useEffect(() => {
    setState({ status: "loading" });
    fetchCode();
    return () => {
      generation.current += 1;
    };
  }, [fetchCode]);

  useEffect(() => {
    if (state.status !== "ready") return;
    const delay = Math.max(250, state.code.expiresAt - now());
    const timer = setTimeout(fetchCode, delay);
    return () => clearTimeout(timer);
  }, [fetchCode, now, state]);

  return state;
}
