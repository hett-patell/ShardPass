import type { OtpCodeProjection } from "@shardpass/messaging";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ExtensionPlatform } from "../../../platform/extension-platform";

export interface OtpLiveCodeState {
  code: OtpCodeProjection | null;
  remaining: number;
}

/**
 * Polls `otp.getCode` for a single TOTP/Steam item and keeps a live countdown,
 * refreshing whenever the current code expires. HOTP items must not be passed
 * here: viewing a code would otherwise silently consume the persisted counter,
 * so HOTP detail views show static configuration instead (see OtpDetail).
 */
export function useOtpLiveCode(
  platform: Pick<ExtensionPlatform, "sendOtpMessage">,
  itemId: string | null,
  active: boolean,
  now: () => number = Date.now,
): OtpLiveCodeState {
  const [code, setCode] = useState<OtpCodeProjection | null>(null);
  const [time, setTime] = useState(now());
  const generation = useRef(0);

  const reload = useCallback(() => {
    if (!active || itemId === null) return;
    const token = ++generation.current;
    platform.sendOtpMessage({ version: 1, kind: "otp.getCode", itemId }).then(
      (response) => {
        if (token !== generation.current) return;
        setCode(response.kind === "otp.codeResult" ? response : null);
        setTime(now());
      },
      () => {
        if (token === generation.current) setCode(null);
      },
    );
  }, [active, itemId, now, platform]);

  useEffect(() => {
    if (!active || itemId === null) {
      generation.current += 1;
      setCode(null);
      return;
    }
    reload();
  }, [active, itemId, reload]);

  useEffect(() => {
    if (!active || code === null) return;
    const delay = Math.max(250, Math.min(1_000, code.expiresAt - now()));
    const timer = setTimeout(() => {
      const currentTime = now();
      if (currentTime >= code.expiresAt) reload();
      else setTime(currentTime);
    }, delay);
    return () => clearTimeout(timer);
  }, [active, code, now, reload]);

  const remaining = code === null ? 0 : Math.max(0, Math.ceil((code.expiresAt - time) / 1_000));
  return { code, remaining };
}
