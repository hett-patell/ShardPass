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

export function useEnteSync(input: { platform: EnteUiPlatform; active: boolean }) {
  const [state, setState] = useState<EnteSafeState>(initialState);
  const [error, setError] = useState(false);
  /** The background's error code for the last failed request, for the UI to name. */
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const mounted = useRef(false);
  const ownership = useRef(0);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const totpRef = useRef<HTMLInputElement>(null);
  const authAbort = useRef<AbortController | null>(null);
  const authWorker = useRef<Worker | null>(null);
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
        return next;
      } catch (failure) {
        if (mounted.current && token === ownership.current) {
          clearSensitive();
          setError(true);
          const code = (failure as { code?: unknown })?.code;
          setErrorCode(typeof code === "string" ? code : null);
        }
        return null;
      }
    },
    [clearSensitive],
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
      mounted.current = false;
      ownership.current += 1;
      authAbort.current?.abort();
      authAbort.current = null;
      authWorker.current?.terminate();
      authWorker.current = null;
      clearSensitive();
    };
  }, [clearSensitive, input.active, send]);

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
      return;
    }
    authAbort.current?.abort();
    const controller = new AbortController();
    authAbort.current = controller;
    const jobId = crypto.randomUUID();
    if (typeof Worker !== "function") {
      emailUtf8.fill(0);
      passwordUtf8.fill(0);
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
          throw new Error();
        const worker = createEnteAuthWorker();
        authWorker.current = worker;
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
          if (result === undefined) throw new Error();
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
        () => {
          clearSensitive();
          authWorker.current?.terminate();
          authWorker.current = null;
          setError(true);
        },
      );
  }, [clearSensitive, send]);

  const submitTotp = useCallback(() => {
    const codeUtf8 = new TextEncoder().encode(totpRef.current?.value ?? "");
    const capability = state.capability;
    clearSensitive();
    if (capability === undefined || !/^\d{6,10}$/u.test(new TextDecoder().decode(codeUtf8))) {
      codeUtf8.fill(0);
      setError(true);
      return;
    }
    const controller = new AbortController();
    authAbort.current = controller;
    const jobId = crypto.randomUUID();
    const worker = authWorker.current;
    if (worker === null) {
      codeUtf8.fill(0);
      setError(true);
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
      () => {
        clearSensitive();
        authWorker.current?.terminate();
        authWorker.current = null;
        setError(true);
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
