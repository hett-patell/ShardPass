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
import type { EnteSodiumAdapter } from "./sodium-adapter";

export type EnteRuntimeDependencies = Omit<OperationalDependencies, "repository"> &
  Readonly<{
    rootDigest(sessionEpoch: number): Promise<string>;
    now(): number;
    randomCapability(): string;
    sodiumReady: Promise<EnteSodiumAdapter>;
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
  clearSessionHandoffs(): void;
}>;

export function createEnteRuntimeOwner(
  session: EnteSessionVaultRepository,
  dependencies: EnteRuntimeDependencies,
): EnteRuntimeOwner {
  const repository = createEnteSessionCycleRepository(session);
  const operational = { ...dependencies, repository };
  let handoffs: EnteSessionHandoffStore | undefined;
  const handoffsReady = dependencies.sodiumReady.then((sodium) => {
    handoffs = new EnteSessionHandoffStore(session, {
      sodium,
      now: dependencies.now,
      randomCapability: dependencies.randomCapability,
      rootDigest: dependencies.rootDigest,
    });
    return handoffs;
  });
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
      return (await handoffsReady).issue(sender);
    },
    async activateSession(capability, ciphertext, sender) {
      const sessionPayload = await (await handoffsReady).consume(capability, ciphertext, sender);
      try {
        const rawSnapshot = await session.readOtpItemsAndMetadata("ente-otp-state");
        rawSnapshot.metadata?.fill(0);
        const credentialEnvelope = btoa(String.fromCharCode(...sessionPayload.token));
        const masterKeyEnvelope = btoa(String.fromCharCode(...sessionPayload.masterKey));
        const authKeyEnvelope = btoa(String.fromCharCode(...sessionPayload.authKey));
        const accountFingerprint = btoa(String.fromCharCode(...sessionPayload.accountFingerprint));
        const state = {
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
    cycle: createEnteOperationalCycle(operational),
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
      (await handoffsReady).clear();
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
    clearSessionHandoffs() {
      handoffs?.clear();
    },
  });
}
