import { decryptEnvelope, encryptEnvelope } from "@shardpass/crypto/aead";
import type { RandomSource } from "@shardpass/crypto/random";
import { sha256 } from "@noble/hashes/sha2.js";

import { decryptAndValidateJournalRecord } from "./change-journal";
import { decryptHotpReceipt } from "./hotp-receipt";
import { canonicalJson, decodeBase64, encodeBase64 } from "./serialization";
import {
  STORAGE_BATCH_KEYS,
  StorageError,
  storageGet,
  storageListKeys,
  storageRemove,
  storageSet,
  type StoragePort,
  type StorageValue,
} from "./storage-port";
import {
  EncryptedGenerationMetadataSchema,
  EncryptedHotpReceiptSchema,
  EncryptedJournalRecordSchema,
  EncryptedRecordSchema,
  GenerationManifestSchema,
  MAX_GENERATION_ENTRIES,
  MAX_GENERATION_METADATA_PLAINTEXT_BYTES,
  LegacyUnsignedGenerationManifestSchema,
  parseVaultItemPlaintext,
  ReceiptUnsignedGenerationManifestSchema,
  UnsignedGenerationManifestSchema,
  VAULT_FORMAT_VERSION,
  vaultItemMatchesRecord,
  VaultRootSchema,
  VerifiedGenerationSchema,
  type EncryptedGenerationMetadata,
  type EncryptedHotpReceipt,
  type EncryptedJournalRecord,
  type EncryptedRecord,
  type GenerationManifest,
  type GenerationMetadataName,
  type LegacyUnsignedGenerationManifest,
  type ManifestEntry,
  type ReceiptUnsignedGenerationManifest,
  type UnsignedGenerationManifest,
  type VaultRoot,
  type WrappedVaultKey,
} from "./vault-format";

export const ACTIVE_ROOT_KEY = "shardpass:v1:root";
export const GENERATION_PREFIX = "shardpass:v1:g:";
export type GenerationEntryCounts = Readonly<{
  records: number;
  journal: number;
  receipts: number;
  metadata: number;
}>;
export function generationEntryCount(counts: GenerationEntryCounts): number {
  const values = [counts.records, counts.journal, counts.receipts, counts.metadata];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) capacity();
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total > MAX_GENERATION_ENTRIES) capacity();
  return total;
}
const MANIFEST_AAD_PREFIX = "shardpass:manifest:v1:";
const MARKER_AAD_PREFIX = "shardpass:verified-marker:v1:";

export interface Clock {
  now(): string;
}
export interface IdSource {
  next(): string;
}
export interface VaultCryptoContext {
  readonly dek: Uint8Array;
  readonly random: RandomSource;
  readonly clock: Clock;
  readonly ids: IdSource;
}
export interface StagedGeneration {
  readonly generationId: string;
  readonly expectedRoot: VaultRoot | null;
  readonly root: VaultRoot;
  readonly manifest: GenerationManifest;
  readonly retainedNonces: ReadonlySet<string>;
}
export interface VerifiedStagedGeneration extends StagedGeneration {
  readonly verified: true;
}
export interface GenerationContents {
  readonly root: VaultRoot;
  readonly records: readonly EncryptedRecord[];
  readonly journal: readonly EncryptedJournalRecord[];
  readonly receipts: readonly EncryptedHotpReceipt[];
  readonly metadata: readonly EncryptedGenerationMetadata[];
  readonly manifest: GenerationManifest;
  readonly marker: ReturnType<typeof VerifiedGenerationSchema.parse> | null;
}

export function generationKeys(generationId: string) {
  const prefix = `${GENERATION_PREFIX}${generationId}:`;
  return {
    prefix,
    manifest: `${prefix}manifest`,
    verified: `${prefix}verified`,
    record: (itemId: string) => `${prefix}record:${itemId}`,
    journal: (sequence: number) => `${prefix}journal:${sequence.toString().padStart(16, "0")}`,
    receipt: (receiptHash: string) => `${prefix}receipt:${receiptHash}`,
    metadata: (name: GenerationMetadataName) => `${prefix}metadata:${name}`,
  } as const;
}

export class GenerationStore {
  constructor(private readonly storage: StoragePort) {}

  async stage(input: {
    readonly generationId?: string;
    readonly expectedRoot: VaultRoot | null;
    readonly wrappedKey: WrappedVaultKey;
    readonly records: readonly EncryptedRecord[];
    readonly journal: readonly EncryptedJournalRecord[];
    readonly receipts?: readonly EncryptedHotpReceipt[];
    readonly metadata?: readonly Readonly<{
      name: GenerationMetadataName;
      schemaVersion: 1;
      plaintext: Uint8Array;
    }>[];
    readonly newEnvelopeNonces?: ReadonlySet<string>;
    readonly retainedNonces?: ReadonlySet<string>;
    readonly context: VaultCryptoContext;
  }): Promise<StagedGeneration> {
    const inputReceipts = input.receipts ?? [];
    const inputMetadata = input.metadata ?? [];
    generationEntryCount({
      records: input.records.length,
      journal: input.journal.length,
      receipts: inputReceipts.length,
      metadata: inputMetadata.length,
    });
    if (
      inputMetadata.some(
        (entry) => entry.plaintext.byteLength > MAX_GENERATION_METADATA_PLAINTEXT_BYTES,
      )
    )
      capacity();
    assertUnique(inputMetadata.map((entry) => entry.name));
    const generationId = input.generationId ?? input.context.ids.next();
    const keys = generationKeys(generationId);
    const records = input.records.map(parseRecord).sort((a, b) => a.itemId.localeCompare(b.itemId));
    const journal = input.journal.map(parseJournal).sort((a, b) => a.sequence - b.sequence);
    const receipts = inputReceipts
      .map(parseReceipt)
      .sort((a, b) => a.receiptHash.localeCompare(b.receiptHash));
    const metadata: EncryptedGenerationMetadata[] = [];
    for (const entry of [...inputMetadata].sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const header = {
        format: "shardpass-encrypted-generation-metadata" as const,
        formatVersion: VAULT_FORMAT_VERSION,
        generationId,
        name: entry.name,
        schemaVersion: entry.schemaVersion,
      };
      const envelope = await encryptEnvelope(
        input.context.dek,
        entry.plaintext,
        metadataAssociatedData(header),
        input.context.random,
      );
      metadata.push(
        parseMetadata({
          ...header,
          nonce: encodeBase64(envelope.nonce),
          ciphertext: encodeBase64(envelope.ciphertext),
          encoding: "base64",
        }),
      );
    }
    assertUnique(records.map((record) => record.itemId));
    assertUnique(receipts.map((receipt) => receipt.receiptHash));
    validateSequence(journal);
    assertUniqueNonces([...records, ...journal, ...receipts, ...metadata]);
    const candidateNonces = new Set(
      [...records, ...journal, ...receipts, ...metadata].map((value) => value.nonce),
    );
    const retainedNonces = input.retainedNonces ?? new Set<string>();
    const newEnvelopeNonces = input.newEnvelopeNonces ?? candidateNonces;
    if ([...newEnvelopeNonces].some((nonce) => !candidateNonces.has(nonce))) corrupt();
    rejectRetainedNonceReuse(newEnvelopeNonces, retainedNonces);

    // Every record is authenticated before anything is written, then written in batches:
    // each key is immutable and content-addressed by the manifest, so a batch loses no
    // atomicity (the manifest still lands last and activation is unchanged) while a large
    // vault no longer costs one storage round-trip per record.
    for (const record of records) await validateVaultRecord(record, input.context.dek);
    for (let offset = 0; offset < records.length; offset += STORAGE_BATCH_KEYS) {
      const batch: Record<string, StorageValue> = {};
      for (const record of records.slice(offset, offset + STORAGE_BATCH_KEYS))
        batch[keys.record(record.itemId)] = record;
      await storageSet(this.storage, batch);
    }
    for (const entry of journal) {
      await decryptAndValidateJournalRecord(entry, input.context.dek);
      await storageSet(this.storage, { [keys.journal(entry.sequence)]: entry });
    }
    for (const entry of metadata)
      await storageSet(this.storage, { [keys.metadata(entry.name)]: entry });
    const receiptPayloads = [];
    for (const receipt of receipts) {
      receiptPayloads.push(await decryptHotpReceipt(receipt, input.context.dek));
      await storageSet(this.storage, { [keys.receipt(receipt.receiptHash)]: receipt });
    }

    const orderedReceiptSequences = receiptPayloads
      .map((receipt) => receipt.receiptSequence)
      .sort((left, right) => left - right);
    validateContiguousNumbers(orderedReceiptSequences);

    const root = parseRoot({
      format: "shardpass-vault",
      formatVersion: VAULT_FORMAT_VERSION,
      activeGenerationId: generationId,
      ...(input.expectedRoot === null
        ? {}
        : { previousGenerationId: input.expectedRoot.activeGenerationId }),
      wrappedKey: input.wrappedKey,
    });
    const unsigned = parseUnsigned({
      format: "shardpass-generation-manifest",
      formatVersion: VAULT_FORMAT_VERSION,
      root,
      generation: {
        format: "shardpass-vault-generation",
        formatVersion: VAULT_FORMAT_VERSION,
        id: generationId,
        createdAt: input.context.clock.now(),
        recordCount: records.length,
        journalCount: journal.length,
        receiptCount: receipts.length,
        metadataCount: metadata.length,
        receiptStartSequence: orderedReceiptSequences.at(0) ?? 1,
        nextReceiptSequence: (orderedReceiptSequences.at(-1) ?? 0) + 1,
        journalStartSequence: journal.at(0)?.sequence ?? 1,
        nextJournalSequence: (journal.at(-1)?.sequence ?? 0) + 1,
        entryCount: records.length + journal.length + receipts.length + metadata.length,
        manifestHashAlgorithm: "SHA256",
      },
      recordEntries: records.map((record) => entryFor(keys.record(record.itemId), record)),
      journalEntries: journal.map((entry) => entryFor(keys.journal(entry.sequence), entry)),
      receiptEntries: receipts.map((receipt) =>
        entryFor(keys.receipt(receipt.receiptHash), receipt),
      ),
      metadataEntries: metadata
        .map((entry) => entryFor(keys.metadata(entry.name), entry))
        .sort(
          (left, right) => left.key.localeCompare(right.key) || left.hash.localeCompare(right.hash),
        ),
    });
    validateManifestInvariants(unsigned);
    const manifestHash = hashCanonical(unsigned);
    const authenticationEnvelope = await encryptEnvelope(
      input.context.dek,
      decodeBase64(manifestHash),
      aad(MANIFEST_AAD_PREFIX, generationId),
      input.context.random,
    );
    const manifestNonce = encodeBase64(authenticationEnvelope.nonce);
    assertNonceAbsent(manifestNonce, [...records, ...journal, ...receipts, ...metadata]);
    rejectRetainedNonceReuse(new Set([manifestNonce]), retainedNonces);
    const manifest = parseManifest({
      ...unsigned,
      manifestHash,
      authentication: {
        algorithm: "xchacha20-poly1305",
        nonce: manifestNonce,
        ciphertext: encodeBase64(authenticationEnvelope.ciphertext),
        encoding: "base64",
      },
    });
    await storageSet(this.storage, { [keys.manifest]: asStorage(manifest) });
    return { generationId, expectedRoot: input.expectedRoot, root, manifest, retainedNonces };
  }

  async verify(
    staged: StagedGeneration,
    context: VaultCryptoContext,
  ): Promise<VerifiedStagedGeneration> {
    const generation = await this.readGeneration(staged.root, staged.generationId, context, false);
    const fullManifestHash = hashCanonical(staged.manifest);
    const markerMetadata = {
      format: "shardpass-verified-generation" as const,
      formatVersion: VAULT_FORMAT_VERSION,
      generationId: staged.generationId,
      manifestHash: staged.manifest.manifestHash,
      manifestAuthenticationHash: fullManifestHash,
      verifiedAt: context.clock.now(),
      encoding: "base64" as const,
    };
    const binding = canonicalBytes({
      manifestHash: staged.manifest.manifestHash,
      manifestAuthenticationHash: fullManifestHash,
    });
    const envelope = await encryptEnvelope(
      context.dek,
      binding,
      markerAad(markerMetadata),
      context.random,
    );
    const nonce = encodeBase64(envelope.nonce);
    assertNonceAbsent(nonce, [
      ...generation.records,
      ...generation.journal,
      ...generation.receipts,
      ...generation.metadata,
      staged.manifest.authentication,
    ]);
    rejectRetainedNonceReuse(new Set([nonce]), staged.retainedNonces);
    const marker = VerifiedGenerationSchema.parse({
      ...markerMetadata,
      nonce,
      ciphertext: encodeBase64(envelope.ciphertext),
    });
    await storageSet(this.storage, { [generationKeys(staged.generationId).verified]: marker });
    return { ...staged, verified: true };
  }

  async activate(
    staged: VerifiedStagedGeneration,
    context: VaultCryptoContext,
    beforeActivation?: () => void,
  ): Promise<VaultRoot> {
    await this.readGeneration(staged.root, staged.generationId, context, true);
    const current = await this.readRoot();
    if (canonicalJson(current) !== canonicalJson(staged.expectedRoot)) conflict();
    beforeActivation?.();
    await storageSet(this.storage, { [ACTIVE_ROOT_KEY]: asStorage(staged.root) });
    // Reclaim the generations this activation just pushed out of the retained pair. The
    // chain is linear (each root records its predecessor), so walking back from the old
    // root's `previous` finds exactly the superseded ones and nothing else -- in particular
    // never a generation another owner has staged but not yet activated, which a blanket
    // sweep would destroy. Without this every commit stranded its predecessor's
    // predecessor, and a vault imported one item at a time grew until storage.local refused
    // further writes. Best-effort and bounded: the root is already durable, and anything
    // left over is reclaimed by the next activation.
    try {
      await this.reclaimSuperseded(current?.previousGenerationId, staged.root);
    } catch {
      // Left for the next activation.
    }
    return staged.root;
  }

  /** Upper bound on generations reclaimed per activation, so a long-leaked vault heals
   *  across a few commits instead of stalling one. */
  private static readonly RECLAIM_PER_ACTIVATION = 32;

  private async reclaimSuperseded(start: string | undefined, root: VaultRoot): Promise<void> {
    const preserve = new Set(
      [root.activeGenerationId, root.previousGenerationId].filter(
        (id): id is string => id !== undefined,
      ),
    );
    let victim = start;
    for (
      let count = 0;
      victim !== undefined && count < GenerationStore.RECLAIM_PER_ACTIVATION;
      count += 1
    ) {
      if (preserve.has(victim)) return;
      const manifest = await this.readOwnManifestLenient(victim);
      const next = manifest?.root.previousGenerationId;
      await this.removeGeneration(victim, manifest);
      victim = next;
    }
  }

  /**
   * Deletes one generation. Its manifest already lists every key it owns, so a readable
   * manifest turns the deletion into a handful of batched removes; only a missing or
   * unreadable manifest falls back to enumerating storage, which on Chrome means reading the
   * whole area once per page. The manifest itself goes last so an interrupted deletion can be
   * finished the cheap way next time. Keys are deleted only if they classify to this
   * generation, whatever a manifest claims.
   */
  private async removeGeneration(
    generationId: string,
    manifest: GenerationManifest | null,
  ): Promise<void> {
    if (manifest === null) {
      await this.removeGenerationByListing(generationId);
      return;
    }
    const keys = generationKeys(generationId);
    const owned = new Set<string>();
    for (const entry of manifestEntries(manifest))
      if (classifyGenerationStorageKey(entry.key)?.generationId === generationId)
        owned.add(entry.key);
    owned.delete(keys.manifest);
    owned.add(keys.verified);
    const removable = [...owned, keys.manifest];
    for (let offset = 0; offset < removable.length; offset += STORAGE_BATCH_KEYS)
      await storageRemove(this.storage, removable.slice(offset, offset + STORAGE_BATCH_KEYS));
  }

  private async removeGenerationByListing(generationId: string): Promise<void> {
    const prefix = `${GENERATION_PREFIX}${generationId}`;
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    for (;;) {
      const page = await storageListKeys(this.storage, prefix, cursor);
      const removable = page.keys.filter(
        (key) => classifyGenerationStorageKey(key)?.generationId === generationId,
      );
      for (let offset = 0; offset < removable.length; offset += STORAGE_BATCH_KEYS)
        await storageRemove(this.storage, removable.slice(offset, offset + STORAGE_BATCH_KEYS));
      if (page.complete) break;
      if (page.nextCursor === undefined || seenCursors.has(page.nextCursor)) storageFailed();
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
  }

  /**
   * The manifest stored for `generationId`, or null when it is missing, does not parse, or
   * describes some other generation -- the cases where it cannot be trusted to drive
   * deletion. Storage failures still propagate.
   */
  private async readOwnManifestLenient(generationId: string): Promise<GenerationManifest | null> {
    try {
      const manifest = await this.readManifest(generationId);
      return manifest !== null && manifest.generation.id === generationId ? manifest : null;
    } catch (error) {
      if (error instanceof StorageError && error.code === "STORAGE_CORRUPT") return null;
      throw error;
    }
  }

  async readReceipt(
    receiptHash: string,
    context: { readonly dek: Uint8Array },
  ): Promise<EncryptedHotpReceipt | null> {
    const root = await this.readRoot();
    if (root === null) return null;
    const manifest = await this.readManifest(root.activeGenerationId);
    if (manifest === null) corrupt();
    const unsigned = unsignedManifest(manifest);
    validateManifestInvariants(unsigned);
    if (
      canonicalJson(manifest.root) !== canonicalJson(root) ||
      hashCanonical(unsigned) !== manifest.manifestHash
    )
      corrupt();
    await authenticateManifest(manifest, context.dek);
    await this.authenticateMarker(manifest, context.dek);
    if (manifest.formatVersion === 1) return null;
    const key = generationKeys(root.activeGenerationId).receipt(receiptHash);
    const indexed = manifest.receiptEntries.find((entry) => entry.key === key);
    if (indexed === undefined) return null;
    const value = (await storageGet(this.storage, [key]))[key];
    if (value === undefined || hashCanonical(value) !== indexed.hash) corrupt();
    const receipt = parseReceipt(value);
    await decryptHotpReceipt(receipt, context.dek);
    return receipt;
  }

  async readStaged(
    staged: Pick<StagedGeneration, "root" | "generationId">,
    context: { readonly dek: Uint8Array },
  ): Promise<GenerationContents> {
    return this.readGeneration(staged.root, staged.generationId, context, true);
  }

  async reconstructVerified(
    expectedRoot: VaultRoot,
    generationId: string,
    context: VaultCryptoContext,
  ): Promise<VerifiedStagedGeneration> {
    const root = VaultRootSchema.parse({
      format: "shardpass-vault",
      formatVersion: VAULT_FORMAT_VERSION,
      activeGenerationId: generationId,
      previousGenerationId: expectedRoot.activeGenerationId,
      wrappedKey: expectedRoot.wrappedKey,
    });
    const contents = await this.readGeneration(root, generationId, context, true);
    return {
      generationId,
      expectedRoot,
      root,
      manifest: contents.manifest,
      retainedNonces: new Set<string>(),
      verified: true,
    };
  }

  async decryptMetadata(
    metadata: EncryptedGenerationMetadata,
    context: { readonly dek: Uint8Array },
  ): Promise<Uint8Array> {
    try {
      const parsed = parseMetadata(metadata);
      const plaintext = await decryptEnvelope(
        context.dek,
        { nonce: decodeBase64(parsed.nonce), ciphertext: decodeBase64(parsed.ciphertext) },
        metadataAssociatedData(parsed),
      );
      if (plaintext.byteLength > MAX_GENERATION_METADATA_PLAINTEXT_BYTES) capacity();
      return plaintext;
    } catch (error) {
      if (error instanceof StorageError) throw error;
      corrupt();
    }
  }

  async readActive(context: { readonly dek: Uint8Array }): Promise<GenerationContents | null> {
    const root = await this.readRoot();
    return root === null ? null : this.readGeneration(root, root.activeGenerationId, context, true);
  }

  async readRetained(context: {
    readonly dek: Uint8Array;
  }): Promise<readonly GenerationContents[]> {
    const active = await this.readActive(context);
    if (active === null) return [];
    if (active.root.previousGenerationId === undefined) return [active];
    const previousManifest = await this.readManifest(active.root.previousGenerationId);
    if (previousManifest === null) corrupt();
    const previous = await this.readGeneration(
      previousManifest.root,
      active.root.previousGenerationId,
      context,
      true,
    );
    return [active, previous];
  }

  async rollback(context: VaultCryptoContext): Promise<VaultRoot> {
    const active = await this.readActive(context);
    if (active?.root.previousGenerationId === undefined) corrupt();
    const previousManifest = await this.readManifest(active.root.previousGenerationId);
    if (previousManifest === null) corrupt();
    await this.readGeneration(
      previousManifest.root,
      active.root.previousGenerationId,
      context,
      true,
    );
    const current = await this.readRoot();
    if (canonicalJson(current) !== canonicalJson(active.root)) conflict();
    await storageSet(this.storage, { [ACTIVE_ROOT_KEY]: asStorage(previousManifest.root) });
    return previousManifest.root;
  }

  async collect(context: VaultCryptoContext): Promise<void> {
    const active = await this.readActive(context);
    if (active === null) return;
    await this.sweep(
      new Set(
        [active.root.activeGenerationId, active.root.previousGenerationId].filter(
          (id): id is string => id !== undefined,
        ),
      ),
    );
  }

  /**
   * Reclaims generations that are neither the active one nor its direct predecessor: what a
   * staging that never activated leaves behind (a failed verify or activate, a worker that
   * died mid-commit). Unlike {@link collect} it needs no key, works from an already
   * authenticated root, and is bounded like {@link reclaimSuperseded} so a long-leaked vault
   * heals across several calls instead of stalling one. Two guards keep it from destroying
   * work in flight: `exclude` names generations the caller is still staging, and a generation
   * whose readable manifest was created at or after `olderThan` (ISO-8601) is kept -- a
   * staged-but-uncommitted migration another worker instance left behind must survive until
   * its owner resumes it. A generation without a readable manifest can never be resumed and
   * is reclaimed regardless. Returns the number of generations removed.
   */
  async collectOrphans(
    root: VaultRoot,
    options: Readonly<{
      exclude?: ReadonlySet<string>;
      olderThan?: string;
      limit?: number;
    }> = {},
  ): Promise<number> {
    const preserve = new Set(
      [root.activeGenerationId, root.previousGenerationId].filter(
        (id): id is string => id !== undefined,
      ),
    );
    const limit = options.limit ?? GenerationStore.RECLAIM_PER_ACTIVATION;
    const olderThan = options.olderThan === undefined ? undefined : Date.parse(options.olderThan);
    if (olderThan !== undefined && Number.isNaN(olderThan)) storageFailed();
    let removed = 0;
    let pending: { generationId: string; keys: string[] } | null = null;
    const flush = async (): Promise<void> => {
      if (pending === null) return;
      const { generationId, keys } = pending;
      pending = null;
      const manifestKey = generationKeys(generationId).manifest;
      if (olderThan !== undefined && keys.includes(manifestKey)) {
        const manifest = await this.readOwnManifestLenient(generationId);
        if (manifest !== null) {
          const createdAt = Date.parse(manifest.generation.createdAt);
          if (Number.isNaN(createdAt) || createdAt >= olderThan) return;
        }
      }
      const removable = [...keys.filter((key) => key !== manifestKey), manifestKey];
      for (let offset = 0; offset < removable.length; offset += STORAGE_BATCH_KEYS)
        await storageRemove(this.storage, removable.slice(offset, offset + STORAGE_BATCH_KEYS));
      removed += 1;
    };
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    for (;;) {
      const page = await storageListKeys(this.storage, GENERATION_PREFIX, cursor);
      for (const key of page.keys) {
        const classified = classifyGenerationStorageKey(key);
        if (
          classified === null ||
          preserve.has(classified.generationId) ||
          options.exclude?.has(classified.generationId) === true
        )
          continue;
        // Keys are listed in order and every key of one generation shares its prefix, so a
        // generation's keys arrive contiguously (possibly across a page boundary).
        if (pending !== null && pending.generationId !== classified.generationId) {
          await flush();
          if (removed >= limit) return removed;
        }
        pending ??= { generationId: classified.generationId, keys: [] };
        pending.keys.push(key);
      }
      if (page.complete) break;
      if (page.nextCursor === undefined || seenCursors.has(page.nextCursor)) storageFailed();
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
    if (removed < limit) await flush();
    return removed;
  }

  /** Removes every generation key whose generation id is not in `preserve`. */
  private async sweep(preserve: ReadonlySet<string>): Promise<void> {
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    for (;;) {
      const page = await storageListKeys(this.storage, GENERATION_PREFIX, cursor);
      const removable = page.keys.filter((key) => {
        const classified = classifyGenerationStorageKey(key);
        return classified !== null && !preserve.has(classified.generationId);
      });
      for (let offset = 0; offset < removable.length; offset += STORAGE_BATCH_KEYS) {
        await storageRemove(this.storage, removable.slice(offset, offset + STORAGE_BATCH_KEYS));
      }
      if (page.complete) break;
      if (page.nextCursor === undefined || seenCursors.has(page.nextCursor)) storageFailed();
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
  }

  private async readRoot(): Promise<VaultRoot | null> {
    const value = (await storageGet(this.storage, [ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY];
    return value === undefined ? null : parseRoot(value);
  }

  private async readManifest(generationId: string): Promise<GenerationManifest | null> {
    const key = generationKeys(generationId).manifest;
    const value = (await storageGet(this.storage, [key]))[key];
    return value === undefined ? null : parseManifest(value);
  }

  private async readGeneration(
    root: VaultRoot,
    generationId: string,
    context: { readonly dek: Uint8Array },
    requireMarker: boolean,
  ): Promise<GenerationContents> {
    const manifest = await this.readManifest(generationId);
    if (manifest === null) corrupt();
    const unsigned = unsignedManifest(manifest);
    validateManifestInvariants(unsigned);
    if (
      manifest.generation.id !== generationId ||
      manifest.root.activeGenerationId !== generationId ||
      canonicalJson(manifest.root) !== canonicalJson(root) ||
      hashCanonical(unsigned) !== manifest.manifestHash
    )
      corrupt();
    await authenticateManifest(manifest, context.dek);
    const marker = requireMarker ? await this.authenticateMarker(manifest, context.dek) : null;
    const receiptEntries = manifest.formatVersion === 1 ? [] : manifest.receiptEntries;
    const metadataEntries = manifest.formatVersion === 3 ? manifest.metadataEntries : [];
    const entries = manifestEntries(manifest);
    const values: Record<string, StorageValue> = {};
    for (let offset = 0; offset < entries.length; offset += STORAGE_BATCH_KEYS) {
      Object.assign(
        values,
        await storageGet(
          this.storage,
          entries.slice(offset, offset + STORAGE_BATCH_KEYS).map((entry) => entry.key),
        ),
      );
    }
    const records: EncryptedRecord[] = [];
    const journal: EncryptedJournalRecord[] = [];
    const receipts: EncryptedHotpReceipt[] = [];
    const metadata: EncryptedGenerationMetadata[] = [];
    for (const entry of manifest.recordEntries) {
      const value = values[entry.key];
      if (value === undefined || hashCanonical(value) !== entry.hash) corrupt();
      const record = parseRecord(value);
      if (entry.key !== generationKeys(generationId).record(record.itemId)) corrupt();
      await validateVaultRecord(record, context.dek);
      records.push(record);
    }
    for (const entry of manifest.journalEntries) {
      const value = values[entry.key];
      if (value === undefined || hashCanonical(value) !== entry.hash) corrupt();
      const record = parseJournal(value);
      if (entry.key !== generationKeys(generationId).journal(record.sequence)) corrupt();
      await decryptAndValidateJournalRecord(record, context.dek);
      journal.push(record);
    }
    const receiptSequences: number[] = [];
    for (const entry of receiptEntries) {
      const value = values[entry.key];
      if (value === undefined || hashCanonical(value) !== entry.hash) corrupt();
      const receipt = parseReceipt(value);
      if (entry.key !== generationKeys(generationId).receipt(receipt.receiptHash)) corrupt();
      const payload = await decryptHotpReceipt(receipt, context.dek);
      receiptSequences.push(payload.receiptSequence);
      receipts.push(receipt);
    }
    for (const entry of metadataEntries) {
      const value = values[entry.key];
      if (value === undefined || hashCanonical(value) !== entry.hash) corrupt();
      const parsed = parseMetadata(value);
      if (entry.key !== generationKeys(generationId).metadata(parsed.name)) corrupt();
      await this.decryptMetadata(parsed, context);
      metadata.push(parsed);
    }
    receiptSequences.sort((left, right) => left - right);
    validateContiguousNumbers(receiptSequences);
    if (
      manifest.formatVersion !== 1 &&
      ((receiptSequences.at(0) ?? 1) !== manifest.generation.receiptStartSequence ||
        (receiptSequences.at(-1) ?? 0) + 1 !== manifest.generation.nextReceiptSequence)
    )
      corrupt();
    validateSequence(journal);
    assertUniqueNonces([
      ...records,
      ...journal,
      ...receipts,
      ...metadata,
      manifest.authentication,
      ...(marker === null ? [] : [marker]),
    ]);
    return { root: manifest.root, records, journal, receipts, metadata, manifest, marker };
  }

  /**
   * One record of the active generation, verified as thoroughly as a full read verifies it:
   * the root and the manifest are authenticated first, then the record's stored bytes are
   * checked against the hash the manifest pins, bound to their key, and authenticated under
   * the data key before anything is returned.
   *
   * What it does not do is verify the other records. A full read has to -- it returns them --
   * but reading one login should not cost a pass over the whole vault. On a vault of a
   * thousand items that pass was about 250 ms, paid again for every password revealed and
   * twice for every one-time code shown. Tampering with a record is still caught the moment
   * that record is read, and every read that returns the whole vault still checks all of it.
   */
  async readActiveRecord(
    itemId: string,
    context: { readonly dek: Uint8Array },
  ): Promise<EncryptedRecord | null> {
    const root = await this.readRoot();
    if (root === null) return null;
    const generationId = root.activeGenerationId;
    const manifest = await this.readManifest(generationId);
    if (manifest === null) corrupt();
    const unsigned = unsignedManifest(manifest);
    validateManifestInvariants(unsigned);
    if (
      manifest.generation.id !== generationId ||
      manifest.root.activeGenerationId !== generationId ||
      canonicalJson(manifest.root) !== canonicalJson(root) ||
      hashCanonical(unsigned) !== manifest.manifestHash
    )
      corrupt();
    await authenticateManifest(manifest, context.dek);
    await this.authenticateMarker(manifest, context.dek);
    const key = generationKeys(generationId).record(itemId);
    const entry = manifest.recordEntries.find((candidate) => candidate.key === key);
    if (entry === undefined) return null;
    const value = (await storageGet(this.storage, [entry.key]))[entry.key];
    if (value === undefined || hashCanonical(value) !== entry.hash) corrupt();
    const record = parseRecord(value);
    if (entry.key !== generationKeys(generationId).record(record.itemId)) corrupt();
    await validateVaultRecord(record, context.dek);
    return record;
  }

  private async authenticateMarker(manifest: GenerationManifest, key: Uint8Array) {
    const markerKey = generationKeys(manifest.generation.id).verified;
    const candidate = (await storageGet(this.storage, [markerKey]))[markerKey];
    try {
      const marker = VerifiedGenerationSchema.parse(candidate);
      const fullManifestHash = hashCanonical(manifest);
      if (
        marker.generationId !== manifest.generation.id ||
        marker.manifestHash !== manifest.manifestHash ||
        marker.manifestAuthenticationHash !== fullManifestHash
      )
        throw new Error("mismatch");
      const plaintext = await decryptEnvelope(
        key,
        { nonce: decodeBase64(marker.nonce), ciphertext: decodeBase64(marker.ciphertext) },
        markerAad(marker),
      );
      if (
        new TextDecoder("utf-8", { fatal: true }).decode(plaintext) !==
        canonicalJson({
          manifestHash: manifest.manifestHash,
          manifestAuthenticationHash: fullManifestHash,
        })
      )
        throw new Error("mismatch");
      return marker;
    } catch {
      corrupt();
    }
  }
}

export function recordAssociatedData(
  record: Pick<
    EncryptedRecord,
    "format" | "formatVersion" | "itemId" | "kind" | "schemaVersion" | "revision"
  >,
) {
  return {
    format: record.format,
    formatVersion: record.formatVersion,
    itemId: record.itemId,
    kind: record.kind,
    schemaVersion: record.schemaVersion,
    revision: record.revision,
  };
}

const GENERATION_UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

export function parseGenerationStorageKey(key: string): { generationId: string } {
  const match = new RegExp(
    `^shardpass:v1:g:(${GENERATION_UUID_PATTERN}):(manifest|verified|record:${GENERATION_UUID_PATTERN}|journal:[0-9]{16}|receipt:[0-9a-f]{64}|metadata:(?:migration-descriptor|lock-settings|ente-otp-state|hotp-pending-state))$`,
  ).exec(key);
  if (match?.[1] === undefined) corrupt();
  return { generationId: match[1] };
}
function classifyGenerationStorageKey(key: string): { generationId: string } | null {
  const suffix = `(?:manifest|verified|record:${GENERATION_UUID_PATTERN}|journal:[0-9]{16}|receipt:[0-9a-f]{64}|metadata:(?:migration-descriptor|lock-settings|ente-otp-state|hotp-pending-state))`;
  const match = new RegExp(`^shardpass:v1:g:(${GENERATION_UUID_PATTERN}):${suffix}$`).exec(key);
  return match?.[1] === undefined ? null : { generationId: match[1] };
}

async function authenticateManifest(manifest: GenerationManifest, key: Uint8Array): Promise<void> {
  try {
    const plaintext = await decryptEnvelope(
      key,
      {
        nonce: decodeBase64(manifest.authentication.nonce),
        ciphertext: decodeBase64(manifest.authentication.ciphertext),
      },
      aad(MANIFEST_AAD_PREFIX, manifest.generation.id),
    );
    if (encodeBase64(plaintext) !== manifest.manifestHash) throw new Error("mismatch");
  } catch {
    corrupt();
  }
}
async function validateVaultRecord(record: EncryptedRecord, key: Uint8Array): Promise<void> {
  try {
    const plaintext = await decryptEnvelope(
      key,
      { nonce: decodeBase64(record.nonce), ciphertext: decodeBase64(record.ciphertext) },
      recordAssociatedData(record),
    );
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    const raw: unknown = JSON.parse(decoded);
    if (decoded !== canonicalJson(raw)) throw new Error("noncanonical plaintext");
    const { item, upgradedFromLegacySchemaVersion } = parseVaultItemPlaintext(raw);
    if (!vaultItemMatchesRecord(item, record, upgradedFromLegacySchemaVersion))
      throw new Error("mismatch");
  } catch {
    corrupt();
  }
}
function validateManifestInvariants(
  manifest:
    | UnsignedGenerationManifest
    | ReceiptUnsignedGenerationManifest
    | LegacyUnsignedGenerationManifest,
): void {
  const id = manifest.generation.id;
  const recordKeys = manifest.recordEntries.map((entry) => entry.key);
  const journalKeys = manifest.journalEntries.map((entry) => entry.key);
  const receiptKeys =
    manifest.formatVersion === 1 ? [] : manifest.receiptEntries.map((entry) => entry.key);
  const metadataKeys =
    manifest.formatVersion === 3 ? manifest.metadataEntries.map((entry) => entry.key) : [];
  if (
    manifest.generation.entryCount > MAX_GENERATION_ENTRIES ||
    !strictlySorted(recordKeys) ||
    !strictlySorted(journalKeys) ||
    !strictlySorted(receiptKeys) ||
    !strictlySorted(metadataKeys)
  )
    corrupt();
  if (
    new Set([...recordKeys, ...journalKeys, ...receiptKeys, ...metadataKeys]).size !==
    recordKeys.length + journalKeys.length + receiptKeys.length + metadataKeys.length
  )
    corrupt();
  for (const key of recordKeys) {
    const parsed = parseGenerationStorageKey(key);
    if (parsed.generationId !== id || !key.startsWith(`${generationKeys(id).prefix}record:`))
      corrupt();
  }
  for (let index = 0; index < journalKeys.length; index += 1) {
    if (
      journalKeys[index] !==
      generationKeys(id).journal(
        (manifest.formatVersion === 1 ? 1 : manifest.generation.journalStartSequence) + index,
      )
    )
      corrupt();
  }
  for (const key of receiptKeys)
    if (!key.startsWith(`${generationKeys(id).prefix}receipt:`)) corrupt();
  for (const key of metadataKeys)
    if (!key.startsWith(`${generationKeys(id).prefix}metadata:`)) corrupt();
}
function validateContiguousNumbers(values: readonly number[]): void {
  for (let index = 1; index < values.length; index += 1)
    if (values[index] !== values[index - 1]! + 1) corrupt();
}
function validateSequence(journal: readonly EncryptedJournalRecord[]): void {
  for (let index = 1; index < journal.length; index += 1)
    if (journal[index]!.sequence !== journal[index - 1]!.sequence + 1) corrupt();
}
function unsignedManifest(
  manifest: GenerationManifest,
):
  | UnsignedGenerationManifest
  | ReceiptUnsignedGenerationManifest
  | LegacyUnsignedGenerationManifest {
  const common = {
    format: manifest.format,
    formatVersion: manifest.formatVersion,
    root: manifest.root,
    generation: manifest.generation,
    recordEntries: manifest.recordEntries,
    journalEntries: manifest.journalEntries,
  };
  if (manifest.formatVersion === 1) return parseLegacyUnsigned(common);
  if (manifest.formatVersion === 2)
    return parseReceiptUnsigned({ ...common, receiptEntries: manifest.receiptEntries });
  return parseUnsigned({
    ...common,
    receiptEntries: manifest.receiptEntries,
    metadataEntries: manifest.metadataEntries,
  });
}
function entryFor(key: string, value: StorageValue) {
  return { key, hash: hashCanonical(value) };
}
/** Every storage entry a manifest lists, whatever its format version. */
function manifestEntries(manifest: GenerationManifest): readonly ManifestEntry[] {
  return [
    ...manifest.recordEntries,
    ...manifest.journalEntries,
    ...(manifest.formatVersion === 1 ? [] : manifest.receiptEntries),
    ...(manifest.formatVersion === 3 ? manifest.metadataEntries : []),
  ];
}
function hashCanonical(value: unknown): string {
  return encodeBase64(sha256(canonicalBytes(value)));
}
function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}
function aad(prefix: string, generationId: string): Uint8Array {
  return new TextEncoder().encode(`${prefix}${generationId}`);
}
export function metadataAssociatedData(
  metadata: Pick<
    EncryptedGenerationMetadata,
    "format" | "formatVersion" | "generationId" | "name" | "schemaVersion"
  >,
): Uint8Array {
  return canonicalBytes({
    domain: "shardpass:generation-metadata:v3",
    format: metadata.format,
    formatVersion: metadata.formatVersion,
    generationId: metadata.generationId,
    name: metadata.name,
    schemaVersion: metadata.schemaVersion,
  });
}
function markerAad(
  marker: Pick<
    ReturnType<typeof VerifiedGenerationSchema.parse>,
    | "format"
    | "formatVersion"
    | "generationId"
    | "manifestHash"
    | "manifestAuthenticationHash"
    | "verifiedAt"
    | "encoding"
  >,
): Uint8Array {
  return canonicalBytes({
    domain: MARKER_AAD_PREFIX,
    format: marker.format,
    formatVersion: marker.formatVersion,
    generationId: marker.generationId,
    manifestHash: marker.manifestHash,
    manifestAuthenticationHash: marker.manifestAuthenticationHash,
    verifiedAt: marker.verifiedAt,
    encoding: marker.encoding,
  });
}
function parseRoot(value: unknown): VaultRoot {
  try {
    return VaultRootSchema.parse(value);
  } catch {
    corrupt();
  }
}
function parseLegacyUnsigned(value: unknown): LegacyUnsignedGenerationManifest {
  try {
    return LegacyUnsignedGenerationManifestSchema.parse(value);
  } catch {
    corrupt();
  }
}
function parseReceiptUnsigned(value: unknown) {
  try {
    return ReceiptUnsignedGenerationManifestSchema.parse(value);
  } catch {
    corrupt();
  }
}
function parseUnsigned(value: unknown): UnsignedGenerationManifest {
  try {
    return UnsignedGenerationManifestSchema.parse(value);
  } catch {
    corrupt();
  }
}
function parseManifest(value: unknown): GenerationManifest {
  try {
    return GenerationManifestSchema.parse(value);
  } catch {
    corrupt();
  }
}
function parseRecord(value: unknown): EncryptedRecord {
  try {
    return EncryptedRecordSchema.parse(value);
  } catch {
    corrupt();
  }
}
function parseMetadata(value: unknown): EncryptedGenerationMetadata {
  try {
    return EncryptedGenerationMetadataSchema.parse(value);
  } catch {
    corrupt();
  }
}
function parseReceipt(value: unknown): EncryptedHotpReceipt {
  try {
    return EncryptedHotpReceiptSchema.parse(value);
  } catch {
    corrupt();
  }
}
function parseJournal(value: unknown): EncryptedJournalRecord {
  try {
    return EncryptedJournalRecordSchema.parse(value);
  } catch {
    corrupt();
  }
}
function asStorage(value: unknown): StorageValue {
  return JSON.parse(canonicalJson(value)) as StorageValue;
}
function strictlySorted(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! < value);
}
function assertUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) corrupt();
}
function assertUniqueNonces(values: readonly { readonly nonce: string }[]): void {
  if (new Set(values.map((value) => value.nonce)).size !== values.length)
    throw new StorageError("DUPLICATE_NONCE");
}
function assertNonceAbsent(nonce: string, values: readonly { readonly nonce: string }[]): void {
  if (values.some((value) => value.nonce === nonce)) throw new StorageError("DUPLICATE_NONCE");
}
function rejectRetainedNonceReuse(
  newNonces: ReadonlySet<string>,
  retainedNonces: ReadonlySet<string>,
): void {
  if ([...newNonces].some((nonce) => retainedNonces.has(nonce)))
    throw new StorageError("DUPLICATE_NONCE");
}
function capacity(): never {
  throw new StorageError("STORAGE_CAPACITY_EXCEEDED");
}
function conflict(): never {
  throw new StorageError("EXTERNAL_ROOT_CHANGED");
}
function storageFailed(): never {
  throw new StorageError("STORAGE_FAILED");
}
function corrupt(): never {
  throw new StorageError("STORAGE_CORRUPT");
}
