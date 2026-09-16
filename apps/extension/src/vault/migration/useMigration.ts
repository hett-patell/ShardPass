import {
  MigrationCredentialAuthorizedResponseSchema,
  MigrationCredentialChallengeResponseSchema,
  MigrationStatusResponseSchema,
  type MigrationResponse,
} from "@shardpass/messaging";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import { createLegacyKdfExecutor, type LegacyKdfDeriveRequest } from "./legacy-kdf-executor";

export type DeriveLegacyKey = (
  request: Omit<LegacyKdfDeriveRequest, "signal">,
  signal: AbortSignal,
) => Promise<Uint8Array>;

export type MigrationViewState =
  | Readonly<{ phase: "loading" }>
  | Readonly<{ phase: "unavailable" }>
  | Readonly<{ phase: "ready"; itemCount: number }>
  | Readonly<{ phase: "deriving"; itemCount: number }>
  | Readonly<{ phase: "staging" | "verifying" | "activating"; itemCount: number }>
  | Readonly<{ phase: "completed"; itemCount: number }>
  | Readonly<{ phase: "failed"; itemCount: number }>;

const defaultDerive: DeriveLegacyKey = (request, signal) =>
  createLegacyKdfExecutor().derive({ ...request, signal });

export function useMigration({
  platform,
  deriveKey = defaultDerive,
  active,
}: Readonly<{
  platform: Pick<ExtensionPlatform, "sendMessage">;
  deriveKey?: DeriveLegacyKey;
  active: boolean;
}>) {
  const [state, setState] = useState<MigrationViewState>({ phase: "loading" });
  const generation = useRef(0);
  const controller = useRef<AbortController | undefined>(undefined);
  const busy = useRef(false);

  const cancel = useCallback(() => {
    generation.current += 1;
    busy.current = false;
    controller.current?.abort();
    controller.current = undefined;
  }, []);

  const sendStatus = useCallback(
    async (kind: "migration.verify" | "migration.activate") => {
      const raw = await platform.sendMessage({ version: 1, kind });
      return MigrationStatusResponseSchema.parse(raw);
    },
    [platform],
  );

  const continueFrom = useCallback(
    async (status: Extract<MigrationResponse, { kind: "migration.status" }>, request: number) => {
      let current = status;
      if (current.phase === "staged") {
        setState({ phase: "verifying", itemCount: current.itemCount });
        current = await sendStatus("migration.verify");
      }
      if (request !== generation.current) return;
      if (current.phase === "verified") {
        setState({ phase: "activating", itemCount: current.itemCount });
        current = await sendStatus("migration.activate");
      }
      if (request !== generation.current) return;
      if (current.phase === "completed")
        setState({ phase: "completed", itemCount: current.itemCount });
      else if (current.phase === "failed")
        setState({ phase: "failed", itemCount: current.itemCount });
      else throw new Error("MIGRATION_RESPONSE_INVALID");
    },
    [sendStatus],
  );

  useEffect(() => {
    cancel();
    if (!active) {
      setState({ phase: "loading" });
      return;
    }
    const request = generation.current;
    void (async () => {
      try {
        const status = MigrationStatusResponseSchema.parse(
          await platform.sendMessage({ version: 1, kind: "migration.inspect" }),
        );
        if (request !== generation.current) return;
        if (!status.available && status.phase === "none") setState({ phase: "unavailable" });
        else if (status.phase === "none") setState({ phase: "ready", itemCount: 0 });
        else if (status.phase === "failed")
          setState({ phase: "failed", itemCount: status.itemCount });
        else await continueFrom(status, request);
      } catch {
        if (request === generation.current) setState({ phase: "failed", itemCount: 0 });
      }
    })();
    return cancel;
  }, [active, cancel, continueFrom, platform]);

  const submit = useCallback(
    async (password: string) => {
      if (!active || busy.current) return;
      busy.current = true;
      cancel();
      busy.current = true;
      const request = generation.current;
      const abortController = new AbortController();
      controller.current = abortController;
      let passwordBytes: Uint8Array | undefined;
      let saltBytes: Uint8Array | undefined;
      let derivedKey: Uint8Array | undefined;
      try {
        setState((current) => ({
          phase: "deriving",
          itemCount: "itemCount" in current ? current.itemCount : 0,
        }));
        const challenge = MigrationCredentialChallengeResponseSchema.parse(
          await platform.sendMessage({
            version: 1,
            kind: "migration.getCredentialChallenge",
          }),
        );
        if (request !== generation.current) return;
        passwordBytes = new TextEncoder().encode(password);
        if (passwordBytes.byteLength === 0 || passwordBytes.byteLength > 1024)
          throw new Error("MIGRATION_INPUT_INVALID");
        saltBytes = decodeBase64(challenge.kdf.salt);
        derivedKey = await deriveKey(
          {
            password: passwordBytes,
            salt: saltBytes,
            iterations: challenge.kdf.iterations,
            outputBytes: challenge.kdf.outputBytes,
          },
          abortController.signal,
        );
        if (request !== generation.current) return;
        if (derivedKey.byteLength !== 32) throw new Error("MIGRATION_KEY_INVALID");
        const authorization = MigrationCredentialAuthorizedResponseSchema.parse(
          await platform.sendMessage({
            version: 1,
            kind: "migration.authorizeCredential",
            challengeId: challenge.challengeId,
            derivedKey: encodeBase64(derivedKey),
          }),
        );
        if (request !== generation.current) return;
        setState((current) => ({
          phase: "staging",
          itemCount: "itemCount" in current ? current.itemCount : 0,
        }));
        const priorFailed = state.phase === "failed";
        const raw = await platform.sendMessage(
          priorFailed
            ? {
                version: 1,
                kind: "migration.retry",
                credentialToken: authorization.credentialToken,
              }
            : {
                version: 1,
                kind: "migration.start",
                credentialToken: authorization.credentialToken,
              },
        );
        const status = MigrationStatusResponseSchema.parse(raw);
        if (request === generation.current) await continueFrom(status, request);
      } catch {
        // The count survives a failure: "3 items" still describes what is waiting.
        if (request === generation.current && !abortController.signal.aborted)
          setState((current) => ({
            phase: "failed",
            itemCount: "itemCount" in current ? current.itemCount : 0,
          }));
      } finally {
        passwordBytes?.fill(0);
        saltBytes?.fill(0);
        derivedKey?.fill(0);
        if (request === generation.current) {
          busy.current = false;
          controller.current = undefined;
        }
      }
    },
    [active, cancel, continueFrom, deriveKey, platform, state.phase],
  );

  return { state, submit, cancel };
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function encodeBase64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}
