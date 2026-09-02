import type { OtpCodeProjection, OtpListItemProjection, OtpResponse } from "@shardpass/messaging";
import { useCallback, useEffect, useRef, useState } from "react";

import type { OtpUiExtensionPlatform } from "../../platform/extension-platform";

export const POPUP_OTP_WINDOW_SIZE = 20;
const CODE_CONCURRENCY = 4;

export type OtpListState =
  | {
      status: "locked" | "loading" | "error";
      items: readonly [];
      totalCount: 0;
      codes: ReadonlyMap<string, OtpCodeProjection>;
      time: number;
    }
  | {
      status: "ready";
      items: readonly OtpListItemProjection[];
      totalCount: number;
      codes: ReadonlyMap<string, OtpCodeProjection>;
      time: number;
    };

const emptyCodes = new Map<string, OtpCodeProjection>();

function isListResult(
  response: OtpResponse,
): response is Extract<OtpResponse, { kind: "otp.listResult" }> {
  return response.kind === "otp.listResult";
}

function isCodeResult(
  response: OtpResponse,
): response is Extract<OtpResponse, { kind: "otp.codeResult" }> {
  return response.kind === "otp.codeResult";
}

export function useOtpList(
  platform: OtpUiExtensionPlatform,
  active: boolean,
  now: () => number = Date.now,
): OtpListState {
  const [state, setState] = useState<OtpListState>({
    status: active ? "loading" : "locked",
    items: [],
    totalCount: 0,
    codes: emptyCodes,
    time: now(),
  });
  const generation = useRef(0);
  const stateRef = useRef(state);
  const visibleRef = useRef(document.visibilityState !== "hidden");
  const reloadRunning = useRef(false);
  const reloadScheduled = useRef(false);
  stateRef.current = state;

  const loadCodes = useCallback(
    async (items: readonly OtpListItemProjection[], totalCount: number, token: number) => {
      const codeItems = items.filter(({ otpType }) => otpType !== "hotp");
      const results: Array<OtpCodeProjection | null> = Array.from(
        { length: codeItems.length },
        () => null,
      );
      let nextIndex = 0;
      const worker = async () => {
        while (generation.current === token && visibleRef.current) {
          const index = nextIndex++;
          const item = codeItems[index];
          if (item === undefined) return;
          try {
            const response = await platform.sendOtpMessage({
              version: 1,
              kind: "otp.getCode",
              itemId: item.id,
            });
            if (isCodeResult(response)) results[index] = response;
          } catch {
            results[index] = null;
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(CODE_CONCURRENCY, codeItems.length) }, () => worker()),
      );
      if (generation.current !== token || !visibleRef.current) return;
      const time = now();
      const codes = new Map<string, OtpCodeProjection>();
      for (const result of results) {
        if (result !== null && time < result.expiresAt) codes.set(result.itemId, result);
      }
      setState({ status: "ready", items, totalCount, codes, time });
    },
    [now, platform],
  );

  const reload = useCallback(async () => {
    if (!active || !visibleRef.current || reloadRunning.current) return;
    reloadRunning.current = true;
    const token = ++generation.current;
    setState((current) =>
      current.status === "ready"
        ? { ...current, codes: emptyCodes, time: now() }
        : { status: "loading", items: [], totalCount: 0, codes: emptyCodes, time: now() },
    );
    try {
      const response = await platform.sendOtpMessage({ version: 1, kind: "otp.list", query: "" });
      if (generation.current !== token || !visibleRef.current || !isListResult(response)) return;
      const items = response.items.slice(0, POPUP_OTP_WINDOW_SIZE);
      await loadCodes(items, response.items.length, token);
    } catch {
      if (generation.current === token && visibleRef.current) {
        setState({ status: "error", items: [], totalCount: 0, codes: emptyCodes, time: now() });
      }
    } finally {
      reloadRunning.current = false;
    }
  }, [active, loadCodes, now, platform]);

  const scheduleReload = useCallback(() => {
    if (!active || !visibleRef.current || reloadScheduled.current) return;
    reloadScheduled.current = true;
    queueMicrotask(() => {
      reloadScheduled.current = false;
      void reload();
    });
  }, [active, reload]);

  useEffect(() => {
    if (!active) {
      generation.current += 1;
      reloadRunning.current = false;
      setState({ status: "locked", items: [], totalCount: 0, codes: emptyCodes, time: now() });
      return;
    }
    scheduleReload();
    return () => {
      generation.current += 1;
      reloadRunning.current = false;
    };
  }, [active, now, scheduleReload]);

  useEffect(() => {
    if (!active) return;
    const onFocus = () => scheduleReload();
    const onVisibility = () => {
      visibleRef.current = document.visibilityState !== "hidden";
      if (!visibleRef.current) {
        generation.current += 1;
        reloadRunning.current = false;
        setState((current) =>
          current.status === "ready" ? { ...current, codes: emptyCodes, time: now() } : current,
        );
        return;
      }
      scheduleReload();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, now, scheduleReload]);

  useEffect(() => {
    if (!active || !visibleRef.current || state.status !== "ready" || state.codes.size === 0)
      return;
    const currentTime = now();
    const nearestExpiry = Math.min(...[...state.codes.values()].map(({ expiresAt }) => expiresAt));
    const delay = Math.max(0, Math.min(1_000, nearestExpiry - currentTime));
    const timer = setTimeout(() => {
      if (!visibleRef.current) return;
      const time = now();
      const expired = [...stateRef.current.codes.values()].some(
        ({ expiresAt }) => time >= expiresAt,
      );
      if (expired) {
        setState((current) =>
          current.status === "ready" ? { ...current, codes: emptyCodes, time } : current,
        );
        scheduleReload();
      } else {
        setState((current) => ({ ...current, time }));
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [active, now, scheduleReload, state]);

  return state;
}
