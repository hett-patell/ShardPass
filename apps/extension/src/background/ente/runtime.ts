import type { SenderContext } from "@shardpass/messaging";
import { canonicalJson } from "@shardpass/storage";

import type { EnteSessionVaultRepository } from "../vault/session-vault-repository";
import { EnteConflictResolver, type EnteConflictPreview } from "./conflict-resolver";
import { EnteConflictCapabilities } from "./conflicts";
import {
  createEnteOperationalCycle,
  type EnteSyncTrigger,
  type OperationalDependencies,
} from "./operational-cycle";
import { EnteProtocolError } from "./protocol";
import { EnteSessionHandoffStore } from "./session-handoff";
import { createEnteSessionCycleRepository } from "./session-cycle-repository";
import { parseEnteOtpSyncState } from "./sync-state";
import type { EnteSodiumAdapter } from "./sodium-adapter";

export type EnteRuntimeDependencies = Omit<OperationalDependencies, "repository"> &
  Readonly<{
    rootDigest(sessionEpoch: number): Promise<string>;
    now(): number;
    randomCapability(): string;
    /** Loads the Ente crypto adapter, starting it on the first call and not before. */
    sodium: () => Promise<EnteSodiumAdapter>;
  }>;

/** What the panel shows about the persisted sync state; never a credential or a code. */
export type EntePersistedStatus = Readonly<{
  connected: boolean;
  pendingCount: number;
  conflictCount: number;
  uncertain: boolean;
  needsReauth: boolean;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
}>;

export type EnteRuntimeOwner = Readonly<{
  issueSessionHandoff(
    sender: SenderContext,
  ): Promise<Readonly<{ capability: string; publicKey: Uint8Array }>>;
  activateSession(capability: string, ciphertext: Uint8Array, sender: SenderContext): Promise<void>;
  cycle(trigger: EnteSyncTrigger, signal: AbortSignal): Promise<void>;
  preview(sender: SenderContext): Promise<readonly EnteConflictPreview[]>;
  resolve(
    capability: string,
    choice: "keep-local" | "keep-ente" | "keep-both",
    sender: SenderContext,
  ): Promise<void>;
  setConnected(connected: boolean): Promise<void>;
  disconnect(): Promise<void>;
  connected(): Promise<boolean>;
  /** `null` when no Ente account has ever been connected in this vault. */
  status(): Promise<EntePersistedStatus | null>;
  clearSessionHandoffs(): void;
}>;

export function createEnteRuntimeOwner(
  session: EnteSessionVaultRepository,
  dependencies: EnteRuntimeDependencies,
): EnteRuntimeOwner {
  const repository = createEnteSessionCycleRepository(session);
  const operational = { ...dependencies, repository };
  let handoffs: EnteSessionHandoffStore | undefined;
  let handoffsLoading: Promise<EnteSessionHandoffStore> | null = null;
  // Built when something first needs it: constructing it loads Ente's crypto, which a vault
  // that never connects Ente should never pay for.
  const handoffsReady = (): Promise<EnteSessionHandoffStore> => {
    handoffsLoading ??= dependencies.sodium().then((sodium) => {
      handoffs = new EnteSessionHandoffStore(session, {
        sodium,
        now: dependencies.now,
        randomCapability: dependencies.randomCapability,
        rootDigest: dependencies.rootDigest,
      });
      return handoffs;
    });
    return handoffsLoading;
  };
  const conflictCapabilities = new EnteConflictCapabilities(
    dependencies.now,
    dependencies.randomCapability,
  );
  const resolver = new EnteConflictResolver({
    ...operational,
    capabilities: conflictCapabilities,
    rootDigest: (snapshot) => dependencies.rootDigest(snapshot.sessionEpoch),
  });
  return Object.freeze({
    async issueSessionHandoff(sender) {
      return (await handoffsReady()).issue(sender);
    },
    async activateSession(capability, ciphertext, sender) {
      const sessionPayload = await (await handoffsReady()).consume(capability, ciphertext, sender);
      try {
        const rawSnapshot = await session.readOtpItemsAndMetadata("ente-otp-state");
        // A state already exists when this is a re-sign-in (a reconnect after "Disconnected"
        // was shown, or a reauthentication). Its mappings, bases and cursor are kept when it
        // is the same account: starting over made a second local copy of every code and
        // then pushed the old copies back to Ente as new entities.
        let previous: ReturnType<typeof parseEnteOtpSyncState> | null = null;
        if (rawSnapshot.metadata !== null) {
          try {
            previous = parseEnteOtpSyncState(
              JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawSnapshot.metadata)),
            );
          } catch {
            previous = null;
          }
        }
        rawSnapshot.metadata?.fill(0);
        const credentialEnvelope = btoa(String.fromCharCode(...sessionPayload.token));
        const masterKeyEnvelope = btoa(String.fromCharCode(...sessionPayload.masterKey));
        const authKeyEnvelope = btoa(String.fromCharCode(...sessionPayload.authKey));
        const accountFingerprint = btoa(String.fromCharCode(...sessionPayload.accountFingerprint));
        const state =
          previous !== null && previous.accountFingerprint === accountFingerprint
            ? {
                ...previous,
                credentialEnvelope,
                masterKeyEnvelope,
                authKeyEnvelope,
                scheduler: { ...previous.scheduler, connected: true },
                needsReauth: false,
              }
            : {
                version: 1 as const,
                protocolPin: "c69dcf66704ad7ec1f95e32920455be429a566ef" as const,
                origin: "https://api.ente.io" as const,
                accountFingerprint,
                snapshotAccountFingerprint: null,
                initialSnapshotEstablished: false,
                credentialEnvelope,
                masterKeyEnvelope,
                authKeyEnvelope,
                mappings: [],
                bases: [],
                cursor: 0,
                pending: [],
                uncertain: null,
                conflicts: [],
                scheduler: { connected: true, lastAttemptAt: null, lastSuccessAt: null },
                needsReauth: false,
              };
        const plaintext = new TextEncoder().encode(canonicalJson(state));
        try {
          if (
            (await session.replaceOtpItemsAndMetadataIfEpoch(
              rawSnapshot.sessionEpoch,
              rawSnapshot.items,
              {
                name: "ente-otp-state",
                schemaVersion: 1,
                plaintext,
              },
            )) !== "activated"
          )
            throw new EnteProtocolError("ENTE_STORAGE_CHANGED");
        } finally {
          plaintext.fill(0);
        }
      } finally {
        sessionPayload.token.fill(0);
        sessionPayload.masterKey.fill(0);
        sessionPayload.authKey.fill(0);
        sessionPayload.accountFingerprint.fill(0);
        ciphertext.fill(0);
      }
    },
    // libsodium finishes compiling asynchronously after the worker starts. A cycle that ran
    // before it was ready found `sodium` undefined and reported ENTE_UNAVAILABLE -- which
    // is exactly what happens when the user's action is what woke a lazy MV3 worker.
    // Gate every cycle on readiness instead of checking it synchronously mid-cycle.
    cycle: (() => {
      const run = createEnteOperationalCycle(operational);
      return async (trigger: EnteSyncTrigger, signal: AbortSignal) => {
        await dependencies.sodium();
        return run(trigger, signal);
      };
    })(),
    preview: (sender: SenderContext) => resolver.preview(sender),
    resolve: async (capability, choice, sender) => {
      await resolver.resolve(capability, choice, sender);
    },
    async setConnected(connected) {
      const snapshot = await repository.read();
      if (
        (await repository.commit(snapshot.sessionEpoch, {
          items: snapshot.items,
          state: {
            ...snapshot.state,
            scheduler: { ...snapshot.state.scheduler, connected },
          },
        })) !== "activated"
      )
        throw new EnteProtocolError("ENTE_STORAGE_CHANGED");
    },
    async disconnect() {
      (await handoffsReady()).clear();
      conflictCapabilities.clear();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const snapshot = await session.readOtpItemsAndMetadata("ente-otp-state");
        snapshot.metadata?.fill(0);
        if (snapshot.metadata === null) return;
        if (
          (await session.removeOtpMetadataIfEpoch(
            snapshot.sessionEpoch,
            snapshot.items,
            "ente-otp-state",
          )) === "activated"
        )
          return;
      }
      throw new EnteProtocolError("ENTE_STORAGE_CHANGED");
    },
    async connected() {
      try {
        return (await repository.read()).state.scheduler.connected;
      } catch (error) {
        if (error instanceof EnteProtocolError && error.code === "ENTE_INVALID") return false;
        throw error;
      }
    },
    async status() {
      try {
        const { state } = await repository.read();
        return {
          connected: state.scheduler.connected,
          pendingCount: state.pending.length,
          conflictCount: state.conflicts.length,
          uncertain: state.uncertain !== null,
          needsReauth: state.needsReauth,
          lastAttemptAt: state.scheduler.lastAttemptAt,
          lastSuccessAt: state.scheduler.lastSuccessAt,
        };
      } catch (error) {
        if (error instanceof EnteProtocolError && error.code === "ENTE_INVALID") return null;
        throw error;
      }
    },
    clearSessionHandoffs() {
      handoffs?.clear();
    },
  });
}
