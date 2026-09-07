import type { OtpCodeProjection } from "@shardpass/messaging";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";

export type OtpCodeState =
  | { status: "loading" }
  | { status: "hotp" }
  | { status: "unavailable" }
  | { status: "ready"; code: OtpCodeProjection; remaining: number };

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const value = (error as { code?: unknown }).code;
  return typeof value === "string" ? value : undefined;
}

/**
 * A live one-time code for an OTP item: the countdown ticks every second and the code is
 * fetched again the moment it expires. HOTP is never read here (that would burn a counter).
 */
export function useOtpCode(
  platform: Pick<ExtensionPlatform, "sendOtpMessage">,
  itemId: string | null,
  now: () => number = Date.now,
): OtpCodeState {
  const [code, setCode] = useState<OtpCodeProjection | null>(null);
  const [failure, setFailure] = useState<"hotp" | "unavailable" | null>(null);
  const [time, setTime] = useState(() => now());
  const generation = useRef(0);

  const fetchCode = useCallback(() => {
    if (itemId === null) return;
    const token = ++generation.current;
    void platform.sendOtpMessage({ version: 1, kind: "otp.getCode", itemId }).then(
      (response) => {
        if (generation.current !== token) return;
        if (response.kind === "otp.codeResult") {
          setCode(response);
          setFailure(null);
        } else setFailure("unavailable");
        setTime(now());
      },
      (error: unknown) => {
        if (generation.current !== token) return;
        setFailure(errorCode(error) === "OTP_HOTP_REQUIRED" ? "hotp" : "unavailable");
      },
    );
  }, [itemId, now, platform]);

  useEffect(() => {
    setCode(null);
    setFailure(null);
    fetchCode();
    return () => {
      generation.current += 1;
    };
  }, [fetchCode]);

  useEffect(() => {
    if (code === null) return;
    // Tick once a second for the countdown; at the boundary, fetch the next code.
    const delay = Math.max(250, Math.min(1_000, code.expiresAt - now()));
    const timer = setTimeout(() => {
      const current = now();
      if (current >= code.expiresAt) fetchCode();
      else setTime(current);
    }, delay);
    return () => clearTimeout(timer);
  }, [code, fetchCode, now, time]);

  if (failure !== null) return { status: failure };
  if (code === null) return { status: "loading" };
  return { status: "ready", code, remaining: Math.max(0, Math.ceil((code.expiresAt - time) / 1_000)) };
}
