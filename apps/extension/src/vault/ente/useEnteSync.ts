import type { EnteRequest, EnteSafeState } from "@shardpass/messaging";
import { useCallback, useEffect, useRef, useState } from "react";

import type { EnteUiPlatform } from "../../platform/extension-platform";
import { createEnteAuthWorker, executeEnteAuthWorker } from "./ente-auth-executor";

const initialState: EnteSafeState = {
  version: 1,
  kind: "ente.state",
  state: "disconnected",
  connected: false,
  pendingCount: 0,
  conflictCount: 0,
  lastSuccessAt: null,
};

export function clearSensitiveControl(ref: React.RefObject<HTMLInputElement | null>): void {
  if (ref.current !== null) ref.current.value = "";
}

export function useEnteSync(input: { platform: EnteUiPlatform; active: boolean; onSynced?: () => void }) {
  const [state, setState] = useState<EnteSafeState>(initialState);
  const [error, setError] = useState(false);
  /** Names a failure for the panel: the background's code, else a bounded message. */
  const reasonOf = (failure: unknown, fallback: string): string => {
    const code = (failure as { code?: unknown } | null)?.code;
    const detail = (failure as { detail?: unknown } | null)?.detail;
    if (typeof code === "string")
      return typeof detail === "string" && detail !== "" ? `${code} — ${detail}` : code;
    const message = failure instanceof Error ? failure.message.slice(0, 160) : "";
    return message || fallback;
  };
  /** The background's error code for the last failed request, for the UI to name. */
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const mounted = useRef(false);
  const ownership = useRef(0);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const totpRef = useRef<HTMLInputElement>(null);
  const authAbort = useRef<AbortController | null>(null);
  const authWorker = useRef<Worker | null>(null);
  // The handoff key lives in the background worker's memory; Chrome may end an idle worker
  // in 30 s while Argon2id and a 2FA code take longer. A status ping keeps it awake.
  const keepAlive = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopKeepAlive = useCallback(() => {
    if (keepAlive.current !== null) clearInterval(keepAlive.current);
    keepAlive.current = null;
  }, []);
  const startKeepAlive = useCallback(() => {
    stopKeepAlive();
    keepAlive.current = setInterval(() => {
      void platformRef.current.sendEnteMessage({ version: 1, kind: "ente.status" }).catch(() => undefined);
    }, 20_000);
  }, [stopKeepAlive]);
  const onSyncedRef = useRef(input.onSynced);
  onSyncedRef.current = input.onSynced;
  const platformRef = useRef(input.platform);
  platformRef.current = input.platform;

  const clearSensitive = useCallback(() => {
    clearSensitiveControl(emailRef);
    clearSensitiveControl(passwordRef);
    clearSensitiveControl(totpRef);
  }, []);

  const send = useCallback(
    async (
      request: EnteRequest,
      options: Readonly<{ preserveResultBytes?: boolean }> = {},
    ): Promise<EnteSafeState | null> => {
      const token = ++ownership.current;
      setError(false);
      setErrorCode(null);
      try {
        const next = await platformRef.current.sendEnteMessage(request);
        if (!mounted.current || token !== ownership.current) return null;
        clearSensitive();
        setState(options.preserveResultBytes ? next : { ...next, authHandoffPublicKey: undefined });
        if (
          request.kind === "ente.connect" ||
          request.kind === "ente.manualSync" ||
          request.kind === "ente.resolveConflict"
        ) {
          stopKeepAlive();
          onSyncedRef.current?.();
        }
        return next;
      } catch (failure) {
        // A rejection without a code did not come from the background's error envelope; it
        // was thrown on this page (worker load, SRP, key derivation). Nothing here may be
        // logged -- this module is a credential boundary -- so the panel shows the code, or
        // failing that a bounded message, and that is the whole diagnostic surface.
        if (mounted.current && token === ownership.current) {
          clearSensitive();
          setError(true);
          const code = (failure as { code?: unknown })?.code;
          const message = failure instanceof Error ? failure.message.slice(0, 160) : "";
          setErrorCode(typeof code === "string" ? code : message || null);
        }
        return null;
      }
    },
    [clearSensitive, stopKeepAlive],
  );

  useEffect(() => {
    mounted.current = true;
    if (input.active) void send({ version: 1, kind: "ente.status" });
    else {
      ownership.current += 1;
      clearSensitive();
      setState(initialState);
    }
    return () => {
      stopKeepAlive();
      mounted.current = false;
      ownership.current += 1;
      authAbort.current?.abort();
      authAbort.current = null;
      authWorker.current?.terminate();
      authWorker.current = null;
      clearSensitive();
    };
  }, [clearSensitive, input.active, send]);

  // While the background is busy (connecting, first sync, a cycle in flight) the panel asks
  // again every few seconds, so "syncing" turns into "idle" or a named failure on its own.
  const busy =
    input.active &&
    (state.state === "connecting" ||
      state.state === "srp-checking" ||
      state.state === "initial-sync" ||
      state.state === "syncing" ||
      state.state.startsWith("syncing-"));
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => {
      void platformRef.current.sendEnteMessage({ version: 1, kind: "ente.status" }).then(
        (next) => {
          if (mounted.current) setState(next);
        },
        () => undefined,
      );
    }, 3_000);
    return () => clearInterval(timer);
  }, [busy]);

  const connect = useCallback(() => {
    const emailValue = emailRef.current?.value ?? "";
    const passwordValue = passwordRef.current?.value ?? "";
    const emailUtf8 = new TextEncoder().encode(emailValue);
    const passwordUtf8 = new TextEncoder().encode(passwordValue);
    clearSensitive();
    if (!emailValue || !passwordValue) {
      emailUtf8.fill(0);
      passwordUtf8.fill(0);
      setError(true);
      setErrorCode("Email and password are both required.");
      return;
    }
    authAbort.current?.abort();
    const controller = new AbortController();
    authAbort.current = controller;
    const jobId = crypto.randomUUID();
    if (typeof Worker !== "function") {
      emailUtf8.fill(0);
      passwordUtf8.fill(0);
      setError(true);
      setErrorCode("This page cannot start a Web Worker.");
      return;
    }
    void platformRef.current
      .sendEnteMessage({ version: 1, kind: "ente.authChallenge" })
      .then((challenge) => {
        if (
          challenge.capability === undefined ||
          challenge.authHandoffPublicKey === undefined ||
          challenge.authHandoffPublicKey.length !== 32
        )
          throw new Error("Auth challenge came back without a handoff key.");
        const worker = createEnteAuthWorker();
        authWorker.current = worker;
        startKeepAlive();
        return executeEnteAuthWorker({
          worker,
          request: {
            version: 1,
            kind: "ente.auth.password",
            jobId,
            emailUtf8,
            passwordUtf8,
            handoffCapability: challenge.capability,
            handoffPublicKey: Uint8Array.from(challenge.authHandoffPublicKey),
          },
          signal: controller.signal,
          keepAliveOnTotp: true,
        });
      })
      .then(
        (result) => {
          if (result === undefined) throw new Error("Auth worker returned no result.");
          if (result.kind === "ente.auth.totp-required") {
            clearSensitive();
            setState((current) => ({
              ...current,
              state: "totp-required",
              capability: result.capability,
            }));
            return;
          }
          if (result.kind === "ente.auth.complete")
            void send({
              version: 1,
              kind: "ente.connect",
              capability: result.capability,
              ciphertext: [...result.ciphertext],
            });
        },
        (failure: unknown) => {
          stopKeepAlive();
          clearSensitive();
          authWorker.current?.terminate();
          authWorker.current = null;
          setError(true);
          setErrorCode(reasonOf(failure, "Sign-in failed before reaching Ente."));
        },
      );
  }, [clearSensitive, send, startKeepAlive, stopKeepAlive]);

  const submitTotp = useCallback(() => {
    const codeUtf8 = new TextEncoder().encode(totpRef.current?.value ?? "");
    const capability = state.capability;
    clearSensitive();
    if (capability === undefined || !/^\d{6,10}$/u.test(new TextDecoder().decode(codeUtf8))) {
      codeUtf8.fill(0);
      setError(true);
      setErrorCode("Enter the 6 to 10 digit code from your authenticator.");
      return;
    }
    const controller = new AbortController();
    authAbort.current = controller;
    const jobId = crypto.randomUUID();
    const worker = authWorker.current;
    if (worker === null) {
      codeUtf8.fill(0);
      setError(true);
      setErrorCode("The sign-in session expired. Start again.");
      return;
    }
    void executeEnteAuthWorker({
      worker,
      request: { version: 1, kind: "ente.auth.totp", jobId, capability, codeUtf8 },
      signal: controller.signal,
    }).then(
      (result) => {
        if (result.kind === "ente.auth.complete")
          void send({
            version: 1,
            kind: "ente.connect",
            capability: result.capability,
            ciphertext: [...result.ciphertext],
          });
      },
      (failure: unknown) => {
        clearSensitive();
        authWorker.current?.terminate();
        authWorker.current = null;
        setError(true);
        setErrorCode(reasonOf(failure, "Two-factor step failed."));
      },
    );
  }, [clearSensitive, send, state.capability]);

  const cancel = useCallback(() => {
    ownership.current += 1;
    authAbort.current?.abort();
    authAbort.current = null;
    authWorker.current?.terminate();
    authWorker.current = null;
    clearSensitive();
    void send({ version: 1, kind: "ente.cancel" });
  }, [clearSensitive, send]);

  return {
    state,
    error,
    errorCode,
    emailRef,
    passwordRef,
    totpRef,
    connect,
    submitTotp,
    cancel,
    manualSync: () => void send({ version: 1, kind: "ente.manualSync" }),
    reauthenticate: () => {
      clearSensitive();
      setState((current) => ({ ...current, state: "connecting" }));
    },
    resolveConflict: (capability: string, choice: "keep-local" | "keep-ente" | "keep-both") =>
      void send({ version: 1, kind: "ente.resolveConflict", capability, choice }),
    disconnectPreview: () => void send({ version: 1, kind: "ente.disconnectPreview" }),
    disconnectConfirm: () => void send({ version: 1, kind: "ente.disconnectConfirm" }),
    clearSensitive,
  } as const;
}
