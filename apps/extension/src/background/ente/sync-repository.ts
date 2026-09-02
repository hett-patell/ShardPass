import {
  canonicalJson,
  StorageError,
  type GenerationStore,
  type EncryptedGenerationMetadata,
  type EncryptedHotpReceipt,
  type EncryptedJournalRecord,
  type EncryptedRecord,
  type VaultCryptoContext,
  type VaultRoot,
} from "@shardpass/storage";

import { parseEnteOtpSyncState, type EnteOtpSyncState } from "./sync-state";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
export type EnteSyncSnapshot = Readonly<{
  root: VaultRoot;
  state: EnteOtpSyncState | null;
  records: readonly EncryptedRecord[];
  journal: readonly EncryptedJournalRecord[];
  receipts: readonly EncryptedHotpReceipt[];
  metadata: readonly EncryptedGenerationMetadata[];
}>;
export type EnteGenerationMutation = Readonly<{ state: EnteOtpSyncState | null }>;
export class EnteSyncRepository {
  constructor(
    private readonly store: GenerationStore,
    private readonly context: VaultCryptoContext,
  ) {}
  async read(): Promise<EnteSyncSnapshot> {
    const contents = await this.store.readActive(this.context);
    if (contents === null) throw new StorageError("STORAGE_FAILED");
    const metadata = contents.metadata.find((entry) => entry.name === "ente-otp-state");
    let state: EnteOtpSyncState | null = null;
    if (metadata !== undefined) {
      const plaintext = await this.store.decryptMetadata(metadata, this.context);
      try {
        state = parseEnteOtpSyncState(JSON.parse(decoder.decode(plaintext)));
      } finally {
        plaintext.fill(0);
      }
    }
    return {
      root: contents.root,
      state,
      records: contents.records,
      journal: contents.journal,
      receipts: contents.receipts,
      metadata: contents.metadata,
    };
  }
  async commit(
    expectedRoot: VaultRoot,
    mutation: EnteGenerationMutation,
  ): Promise<"activated" | "root-changed"> {
    const snapshot = await this.read();
    if (canonicalJson(snapshot.root) !== canonicalJson(expectedRoot)) return "root-changed";
    const retainedMetadata: {
      name: EncryptedGenerationMetadata["name"];
      schemaVersion: 1;
      plaintext: Uint8Array;
    }[] = [];
    for (const entry of snapshot.metadata) {
      if (entry.name === "ente-otp-state") continue;
      retainedMetadata.push({
        name: entry.name,
        schemaVersion: 1,
        plaintext: await this.store.decryptMetadata(entry, this.context),
      });
    }
    if (mutation.state !== null)
      retainedMetadata.push({
        name: "ente-otp-state",
        schemaVersion: 1,
        plaintext: encoder.encode(canonicalJson(parseEnteOtpSyncState(mutation.state))),
      });
    try {
      const staged = await this.store.stage({
        expectedRoot,
        wrappedKey: expectedRoot.wrappedKey,
        records: snapshot.records,
        journal: snapshot.journal,
        receipts: snapshot.receipts,
        metadata: retainedMetadata,
        context: this.context,
      });
      const verified = await this.store.verify(staged, this.context);
      try {
        await this.store.activate(verified, this.context);
        return "activated";
      } catch (error) {
        if (error instanceof StorageError && error.code === "EXTERNAL_ROOT_CHANGED")
          return "root-changed";
        throw error;
      }
    } finally {
      for (const entry of retainedMetadata) entry.plaintext.fill(0);
    }
  }
}
