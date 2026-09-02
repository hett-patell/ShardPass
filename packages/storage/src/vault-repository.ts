import { AEAD_TAG_BYTES, decryptEnvelope, encryptEnvelope } from "@shardpass/crypto/aead";
import {
  ITEM_SCHEMA_VERSION,
  OtpItemSchema,
  VaultItemSchema,
  type OtpItem,
  type VaultItem,
  type VaultItemKind,
} from "@shardpass/domain";

import { ChangeJournal, MAX_JOURNAL_ENTRIES, type ChangeJournalEntry } from "./change-journal";
import {
  GenerationStore,
  generationEntryCount,
  recordAssociatedData,
  type GenerationContents,
  type VaultCryptoContext,
} from "./generation-store";
import {
  decodePendingHotpReservations,
  encodePendingHotpReservations,
  PendingHotpReservationSchema,
  type PendingHotpReservation,
} from "./hotp-pending";
import {
  decryptHotpReceipt,
  encryptHotpReceipt,
  hotpReceiptHash,
  MAX_HOTP_RECEIPTS,
  type HotpCounterCommitReceipt,
} from "./hotp-receipt";
import { canonicalJson, decodeBase64, encodeBase64 } from "./serialization";
import { StorageError, type StoragePort } from "./storage-port";
import {
  EncryptedRecordSchema,
  MAX_ENCRYPTED_RECORD_BYTES,
  parseVaultItemPlaintext,
  RECORD_FORMAT_VERSION,
  vaultItemMatchesRecord,
  type EncryptedGenerationMetadata,
  type EncryptedHotpReceipt,
  type EncryptedJournalRecord,
  type EncryptedRecord,
  type GenerationMetadataName,
  type VaultRoot,
  type WrappedVaultKey,
} from "./vault-format";

const HOTP_RECEIPT_RETENTION_MS = 5 * 60_000;

export interface VaultItemMetadata {
  readonly id: string;
  readonly kind: VaultItemKind;
  readonly schemaVersion: number;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly favorite: boolean;
  readonly tags: readonly string[];
}

/** Type guard narrowing a decrypted vault item to an OTP item. */
function isOtpItem(item: VaultItem): item is OtpItem {
  return item.kind === "otp";
}

/** Type guard narrowing a change-journal entry to one describing an OTP-kind item. */
function isOtpJournalEntry(entry: ChangeJournalEntry): entry is OtpChangeJournalEntry {
  return entry.kind === "otp";
}

export interface TombstoneResult {
  readonly id: string;
  readonly revision: number;
  readonly deletedAt: string;
}

export type OtpImportCandidate = Readonly<{
  issuer: string;
  label: string;
  secret: string;
  otpType: "totp" | "hotp" | "steam";
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: number;
  period: number;
  counter?: number;
  favorite: boolean;
  tags: readonly string[];
  note: string;
}>;
export type PortableOtpImportStatus = "accepted" | "duplicate" | "conflict";
export type PortableLockSettings = Readonly<{
  autoLockMinutes: 0 | 5 | 15 | 30 | 60;
  lockOnScreenLock: boolean;
}>;
export type PortableHistory = Readonly<{
  journal: readonly ChangeJournalEntry[];
  tombstones: readonly Readonly<{ itemId: string; revision: number; deletedAt: string }>[];
}>;
export type PortableImportDescriptor = Readonly<{
  settings: PortableLockSettings;
  history: PortableHistory;
}>;
export type PortableImportPreview = Readonly<{
  statuses: readonly PortableOtpImportStatus[];
  settings: "unchanged" | "replace";
  history: Readonly<{ journalAdded: number; tombstonesAdded: number }>;
}>;
/** A change-journal entry known (by construction) to describe an OTP-kind item. */
export type OtpChangeJournalEntry = ChangeJournalEntry & { readonly kind: "otp" };
export type PortableVaultState = Readonly<{
  items: readonly OtpItem[];
  settings: PortableLockSettings | null;
  journal: readonly OtpChangeJournalEntry[];
  tombstones: readonly Readonly<{ itemId: string; revision: number; deletedAt: string }>[];
}>;
export type ImportOtpItemsResult = Readonly<{
  imported: number;
  duplicate: number;
  conflict?: number;
  previewChanged: boolean;
  items: readonly OtpItem[];
  statuses: readonly ("accepted" | "duplicate")[];
}>;
export type ImportPortableOtpItemsResult = Readonly<{
  imported: number;
  duplicate: number;
  conflict: number;
  previewChanged: boolean;
  items: readonly OtpItem[];
  statuses: readonly PortableOtpImportStatus[];
}>;

export interface HotpReservationCommitRequest {
  readonly itemId: string;
  readonly expectedRevision: number;
  readonly expectedCounter: number;
  readonly reservationId: string;
}
export interface HotpReservationCommitResult {
  readonly revision: number;
  readonly counter: number;
}
export interface HotpReservationBinding {
  readonly tabId: number;
  readonly frameId: number;
  readonly documentId: string;
}

export interface VaultRepositoryActivationCoordinator {
  beforeActivate(candidate: VaultRoot): Promise<void>;
  afterActivate(activated: VaultRoot): Promise<void>;
  activationFailed(candidate: VaultRoot): Promise<void>;
}

const NOOP_ACTIVATION_COORDINATOR: VaultRepositoryActivationCoordinator = {
  beforeActivate: () => Promise.resolve(),
  afterActivate: () => Promise.resolve(),
  activationFailed: () => Promise.resolve(),
};

type ItemUpdater = (current: VaultItem) => VaultItem;

export class VaultRepository {
  readonly changes: ChangeJournal;
  private readonly generations: GenerationStore;
  private mutationTail: Promise<void> = Promise.resolve();
  private readonly pendingCommits = new Map<string, Promise<HotpReservationCommitResult>>();

  constructor(
    storage: StoragePort,
    private readonly wrappedKey: WrappedVaultKey,
    private readonly limits: {
      readonly maxJournalEntries: number;
      readonly maxHotpReceipts: number;
      readonly maxGenerationEntries?: number;
    } = {
      maxJournalEntries: MAX_JOURNAL_ENTRIES,
      maxHotpReceipts: MAX_HOTP_RECEIPTS,
    },
    private readonly activationCoordinator: VaultRepositoryActivationCoordinator = NOOP_ACTIVATION_COORDINATOR,
  ) {
    this.generations = new GenerationStore(storage);
    validateLimits(this.limits);
    this.changes = new ChangeJournal(async (context) => {
      const active = await this.generations.readActive(context);
      return {
        records: active?.journal ?? [],
        startSequence:
          active !== null && active.manifest.formatVersion !== 1
            ? active.manifest.generation.journalStartSequence
            : 1,
      };
    });
  }

  async listItems(context: VaultCryptoContext): Promise<readonly VaultItem[]> {
    const loaded = await this.load(context);
    return Promise.all(loaded.records.map((record) => decryptVaultRecord(record, context.dek)));
  }

  /** Lists every vault item of the given kind, decrypted. */
  async listItemsByKind(
    kind: VaultItemKind,
    context: VaultCryptoContext,
  ): Promise<readonly VaultItem[]> {
    const items = await this.listItems(context);
    return items.filter((item) => item.kind === kind);
  }

  async listMetadata(context: VaultCryptoContext): Promise<readonly VaultItemMetadata[]> {
    const items = await this.listItems(context);
    return items.map((item) => ({
      id: item.id,
      kind: item.kind,
      schemaVersion: item.schemaVersion,
      revision: item.revision,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      favorite: item.favorite,
      tags: item.tags,
    }));
  }

  async get(itemId: string, context: VaultCryptoContext): Promise<VaultItem | null> {
    const loaded = await this.load(context);
    const record = loaded.records.find((candidate) => candidate.itemId === itemId);
    return record === undefined ? null : decryptVaultRecord(record, context.dek);
  }

  async readGenerationMetadata(
    name: GenerationMetadataName,
    context: VaultCryptoContext,
  ): Promise<Uint8Array | null> {
    const loaded = await this.load(context);
    const entry = loaded.metadata.find((candidate) => candidate.name === name);
    return entry === undefined ? null : this.generations.decryptMetadata(entry, context);
  }

  /**
   * Replaces the complete OTP record set and one metadata value in one staged,
   * verified generation. The existing journal, receipts, and unrelated metadata
   * are retained; item changes append their journal observations before the
   * single active-root write.
   */
  async replaceOtpItemsAndMetadata(
    candidates: readonly OtpItem[],
    metadata: Readonly<{
      name: GenerationMetadataName;
      schemaVersion: 1;
      plaintext: Uint8Array;
    }>,
    context: VaultCryptoContext,
  ): Promise<void> {
    return this.serialize(async () => {
      const loaded = await this.load(context);
      // Only OTP-kind records participate in this replace-the-complete-OTP-set operation;
      // records of every other kind are carried through untouched (not decrypted,
      // not re-encrypted, and never journaled as deleted).
      const otherRecords = loaded.records.filter((record) => record.kind !== "otp");
      const currentItems = (
        await Promise.all(
          loaded.records
            .filter((record) => record.kind === "otp")
            .map((record) => decryptVaultRecord(record, context.dek)),
        )
      ).filter(isOtpItem);
      const current = new Map(currentItems.map((item) => [item.id, item]));
      const requestedIds = new Set<string>();
      const now = context.clock.now();
      const items: OtpItem[] = [];
      let journal: readonly EncryptedJournalRecord[] = [...loaded.journal];
      const newNonces = new Set<string>();

      for (const candidate of candidates) {
        if (requestedIds.has(candidate.id)) conflict();
        requestedIds.add(candidate.id);
        const previous = current.get(candidate.id);
        const item = OtpItemSchema.parse(
          previous === undefined
            ? { ...candidate, revision: 1, createdAt: now, updatedAt: now, deletedAt: undefined }
            : canonicalJson(projectOtpContent(previous)) ===
                canonicalJson(projectOtpContent(candidate))
              ? previous
              : {
                  ...candidate,
                  revision: previous.revision + 1,
                  createdAt: previous.createdAt,
                  updatedAt: now,
                  deletedAt: undefined,
                },
        );
        items.push(item);
        if (previous === undefined || item !== previous) {
          journal = [
            ...(await this.changes.append(
              journal,
              journalEntry(item, previous === undefined ? "create" : "update", now),
              context.dek,
              context.random,
            )),
          ];
          newNonces.add(journal.at(-1)!.nonce);
        }
      }
      for (const previous of currentItems) {
        if (requestedIds.has(previous.id)) continue;
        journal = [
          ...(await this.changes.append(
            journal,
            {
              itemId: previous.id,
              kind: previous.kind,
              schemaVersion: previous.schemaVersion,
              revision: previous.revision + 1,
              operation: "delete",
              changedAt: now,
            },
            context.dek,
            context.random,
          )),
        ];
        newNonces.add(journal.at(-1)!.nonce);
      }
      journal = compact(journal, this.limits.maxJournalEntries);
      const records = await Promise.all(items.map((item) => encryptVaultRecord(item, context)));
      for (const record of records) newNonces.add(record.nonce);
      const metadataPlaintext = await Promise.all(
        loaded.metadata
          .filter((entry) => entry.name !== metadata.name)
          .map(async (entry) => ({
            name: entry.name,
            schemaVersion: entry.schemaVersion,
            plaintext: await this.generations.decryptMetadata(entry, context),
          })),
      );
      metadataPlaintext.push({
        name: metadata.name,
        schemaVersion: metadata.schemaVersion,
        plaintext: metadata.plaintext.slice(),
      });
      await this.commitPlaintextMetadata(
        loaded.root,
        [...otherRecords, ...records],
        journal,
        loaded.receipts,
        metadataPlaintext,
        newNonces,
        context,
      );
    });
  }

  async removeOtpMetadata(
    candidates: readonly OtpItem[],
    name: GenerationMetadataName,
    context: VaultCryptoContext,
  ): Promise<void> {
    return this.serialize(async () => {
      const loaded = await this.load(context);
      const currentOtpItems = (
        await Promise.all(
          loaded.records
            .filter((record) => record.kind === "otp")
            .map((record) => decryptVaultRecord(record, context.dek)),
        )
      ).filter(isOtpItem);
      if (canonicalJson(currentOtpItems) !== canonicalJson(candidates)) conflict();
      const metadataPlaintext = await Promise.all(
        loaded.metadata
          .filter((entry) => entry.name !== name)
          .map(async (entry) => ({
            name: entry.name,
            schemaVersion: entry.schemaVersion,
            plaintext: await this.generations.decryptMetadata(entry, context),
          })),
      );
      await this.commitPlaintextMetadata(
        loaded.root,
        loaded.records,
        loaded.journal,
        loaded.receipts,
        metadataPlaintext,
        new Set(),
        context,
      );
    });
  }

  async create(candidate: VaultItem, context: VaultCryptoContext): Promise<VaultItem> {
    return this.serialize(async () => {
      const loaded = await this.load(context);
      if (loaded.records.some((record) => record.itemId === candidate.id)) conflict();
      const now = context.clock.now();
      const item = parseCandidate({
        ...candidate,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: undefined,
      });
      const record = await encryptVaultRecord(item, context);
      const journal = compact(
        await this.changes.append(
          loaded.journal,
          journalEntry(item, "create", now),
          context.dek,
          context.random,
        ),
        this.limits.maxJournalEntries,
      );
      await this.commit(
        loaded.root,
        [...loaded.records, record],
        journal,
        new Set([record.nonce, journal.at(-1)!.nonce]),
        loaded.receipts,
        loaded.metadata,
        context,
      );
      return item;
    });
  }

  async readPortableState(context: VaultCryptoContext): Promise<PortableVaultState> {
    const loaded = await this.load(context);
    const items = await Promise.all(
      loaded.records.map((record) => decryptVaultRecord(record, context.dek)),
    );
    // The portable format is OTP-only: entries for other item kinds must not leak into
    // the exported journal (their ids, kinds, and change timestamps are not this format's
    // business), so the journal is filtered to OTP-kind entries before deriving tombstones.
    const journal = (
      await Promise.all(loaded.journal.map((record) => this.changes.decrypt(record, context.dek)))
    ).filter(isOtpJournalEntry);
    const tombstones = journal
      .filter((entry) => entry.operation === "delete")
      .map((entry) => ({
        itemId: entry.itemId,
        revision: entry.revision,
        deletedAt: entry.changedAt,
      }));
    return Object.freeze({
      items: Object.freeze(
        items
          .filter(isOtpItem)
          .map((item) => OtpItemSchema.parse({ ...item, tags: [...item.tags] })),
      ),
      settings: await readPortableSettings(loaded.metadata, context, this.generations),
      journal: Object.freeze(journal.map((entry) => Object.freeze({ ...entry }))),
      tombstones: Object.freeze(tombstones.map((entry) => Object.freeze(entry))),
    });
  }

  async updatePortableSettings(
    settings: PortableVaultState["settings"],
    context: VaultCryptoContext,
  ): Promise<boolean> {
    if (settings === null) throw new RangeError("Portable settings are required.");
    return this.serialize(async () => {
      const loaded = await this.load(context);
      const current = await readPortableSettings(loaded.metadata, context, this.generations);
      if (canonicalJson(current) === canonicalJson(settings)) return false;
      const metadata = await replacePortableSettingsMetadata(
        loaded.metadata,
        settings,
        context,
        this.generations,
      );
      await this.commitPlaintextMetadata(
        loaded.root,
        loaded.records,
        loaded.journal,
        loaded.receipts,
        metadata,
        new Set(),
        context,
      );
      return true;
    });
  }

  async previewPortableImport(
    candidates: readonly OtpItem[],
    descriptor: PortableImportDescriptor,
    context: VaultCryptoContext,
  ): Promise<PortableImportPreview> {
    validatePortableDescriptor(descriptor);
    const loaded = await this.load(context);
    const existing = await Promise.all(
      loaded.records.map((record) => decryptVaultRecord(record, context.dek)),
    );
    const currentJournal = await Promise.all(
      loaded.journal.map((record) => this.changes.decrypt(record, context.dek)),
    );
    const currentSettings = await readPortableSettings(loaded.metadata, context, this.generations);
    return portablePreview(existing, candidates, currentSettings, currentJournal, descriptor);
  }

  async importPortableState(
    candidates: readonly OtpItem[],
    descriptor: PortableImportDescriptor,
    expected: PortableImportPreview,
    context: VaultCryptoContext,
  ): Promise<ImportPortableOtpItemsResult> {
    return this.serialize(async () => {
      validatePortableDescriptor(descriptor);
      const loaded = await this.load(context);
      const existing = await Promise.all(
        loaded.records.map((record) => decryptVaultRecord(record, context.dek)),
      );
      const currentJournal = await Promise.all(
        loaded.journal.map((record) => this.changes.decrypt(record, context.dek)),
      );
      const currentSettings = await readPortableSettings(
        loaded.metadata,
        context,
        this.generations,
      );
      const preview = portablePreview(
        existing,
        candidates,
        currentSettings,
        currentJournal,
        descriptor,
      );
      const duplicate = preview.statuses.filter((status) => status === "duplicate").length;
      const conflictCount = preview.statuses.filter((status) => status === "conflict").length;
      if (canonicalJson(preview) !== canonicalJson(expected))
        return portableImportResult(0, duplicate, conflictCount, true, [], preview.statuses);

      const classified = classifyPortableItems(existing, candidates);
      const now = context.clock.now();
      const records = [...loaded.records];
      const changed: OtpItem[] = [];
      const newNonces = new Set<string>();
      for (const accepted of classified.accepted) {
        const current = existing[accepted.existingIndex];
        // classifyPortableItems() only accepts a matching existingIndex whose item
        // already compared equal to an OTP candidate, so it is always OTP-kind here.
        if (current !== undefined && current.kind !== "otp") conflict();
        const item =
          current === undefined
            ? OtpItemSchema.parse({
                ...accepted.candidate,
                id: context.ids.next(),
                revision: 1,
                createdAt: now,
                updatedAt: now,
                deletedAt: undefined,
              })
            : OtpItemSchema.parse({
                ...current,
                counter: Math.max(current.counter ?? 0, accepted.candidate.counter ?? 0),
                revision: current.revision + 1,
                updatedAt: now,
              });
        const encrypted = await encryptVaultRecord(item, context);
        if (current === undefined) records.push(encrypted);
        else records[accepted.existingIndex] = encrypted;
        newNonces.add(encrypted.nonce);
        changed.push(item);
      }
      let logical = mergePortableHistory(
        currentJournal,
        descriptor.history,
        this.limits.maxJournalEntries,
      );
      for (const item of changed) {
        logical = [
          ...logical,
          {
            ...journalEntry(
              item,
              existing.some((candidate) => candidate.id === item.id) ? "update" : "create",
              now,
            ),
            sequence: logical.length + 1,
          },
        ];
        if (logical.length > this.limits.maxJournalEntries)
          logical = logical.slice(-this.limits.maxJournalEntries);
      }
      const journal: EncryptedJournalRecord[] = [];
      for (const [index, entry] of logical.entries()) {
        const payload = {
          itemId: entry.itemId,
          kind: entry.kind,
          schemaVersion: entry.schemaVersion,
          revision: entry.revision,
          operation: entry.operation,
          changedAt: entry.changedAt,
          ...(entry.mutationId === undefined ? {} : { mutationId: entry.mutationId }),
        };
        const appended = await this.changes.append(
          journal,
          payload,
          context.dek,
          context.random,
          index + 1,
        );
        journal.push(appended.at(-1)!);
        newNonces.add(journal.at(-1)!.nonce);
      }
      const metadata = await replacePortableSettingsMetadata(
        loaded.metadata,
        descriptor.settings,
        context,
        this.generations,
      );
      preflightOtpImportGenerationCapacity(
        {
          records: records.length,
          journal: journal.length,
          receipts: loaded.receipts.length,
          metadata: metadata.length,
        },
        0,
        this.limits.maxJournalEntries,
        this.limits.maxGenerationEntries,
      );
      const hasEffect =
        changed.length > 0 || preview.settings === "replace" || preview.history.journalAdded > 0;
      if (hasEffect)
        await this.commitPlaintextMetadata(
          loaded.root,
          records,
          journal,
          loaded.receipts,
          metadata,
          newNonces,
          context,
        );
      return portableImportResult(
        changed.length,
        duplicate,
        conflictCount,
        false,
        changed,
        preview.statuses,
      );
    });
  }

  async previewPortableOtpItems(
    candidates: readonly OtpItem[],
    context: VaultCryptoContext,
  ): Promise<Readonly<{ statuses: readonly PortableOtpImportStatus[] }>> {
    validatePortableCandidates(candidates);
    const loaded = await this.load(context);
    const existing = await Promise.all(
      loaded.records.map((record) => decryptVaultRecord(record, context.dek)),
    );
    return Object.freeze({
      statuses: Object.freeze(classifyPortableItems(existing, candidates).statuses),
    });
  }

  async importPortableOtpItems(
    candidates: readonly OtpItem[],
    expectedStatuses: readonly PortableOtpImportStatus[],
    context: VaultCryptoContext,
  ): Promise<ImportPortableOtpItemsResult> {
    return this.serialize(async () => {
      validatePortableCandidates(candidates);
      if (candidates.length !== expectedStatuses.length) throw new StorageError("VAULT_INVALID");
      const loaded = await this.load(context);
      const existing = await Promise.all(
        loaded.records.map((record) => decryptVaultRecord(record, context.dek)),
      );
      const classified = classifyPortableItems(existing, candidates);
      const duplicate = classified.statuses.filter((status) => status === "duplicate").length;
      const conflictCount = classified.statuses.filter((status) => status === "conflict").length;
      if (classified.statuses.some((status, index) => status !== expectedStatuses[index]))
        return portableImportResult(0, duplicate, conflictCount, true, [], classified.statuses);

      preflightOtpImportGenerationCapacity(
        {
          records: loaded.records.length,
          journal: loaded.journal.length,
          receipts: loaded.receipts.length,
          metadata: loaded.metadata.length,
        },
        classified.accepted.length,
        this.limits.maxJournalEntries,
        this.limits.maxGenerationEntries,
      );
      if (classified.accepted.length === 0)
        return portableImportResult(0, duplicate, conflictCount, false, [], classified.statuses);

      const now = context.clock.now();
      const records = [...loaded.records];
      let journal = loaded.journal;
      const changed: OtpItem[] = [];
      const newNonces = new Set<string>();
      for (const accepted of classified.accepted) {
        const current = existing[accepted.existingIndex];
        // classifyPortableItems() only accepts a matching existingIndex whose item
        // already compared equal to an OTP candidate, so it is always OTP-kind here.
        if (current !== undefined && current.kind !== "otp") conflict();
        const item =
          current === undefined
            ? OtpItemSchema.parse({
                ...accepted.candidate,
                id: context.ids.next(),
                revision: 1,
                createdAt: now,
                updatedAt: now,
                deletedAt: undefined,
              })
            : OtpItemSchema.parse({
                ...current,
                counter: Math.max(current.counter ?? 0, accepted.candidate.counter ?? 0),
                revision: current.revision + 1,
                updatedAt: now,
              });
        const encrypted = await encryptVaultRecord(item, context);
        if (current === undefined) records.push(encrypted);
        else records[accepted.existingIndex] = encrypted;
        newNonces.add(encrypted.nonce);
        journal = compact(
          await this.changes.append(
            journal,
            journalEntry(item, current === undefined ? "create" : "update", now),
            context.dek,
            context.random,
          ),
          this.limits.maxJournalEntries,
        );
        newNonces.add(journal.at(-1)!.nonce);
        changed.push(item);
      }
      await this.commit(
        loaded.root,
        records,
        journal,
        newNonces,
        loaded.receipts,
        loaded.metadata,
        context,
      );
      return portableImportResult(
        changed.length,
        duplicate,
        conflictCount,
        false,
        changed,
        classified.statuses,
      );
    });
  }

  /**
   * Imports pre-built vault items of any kind, skipping any candidate whose id already
   * exists in the vault. Unlike {@link importOtpItems}, candidates are created one at a
   * time (one generation per accepted item) rather than staged into a single generation.
   */
  async importItems(
    items: readonly VaultItem[],
    context: VaultCryptoContext,
  ): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;
    for (const candidate of items) {
      const parsed = VaultItemSchema.parse(candidate);
      const existing = await this.get(parsed.id, context);
      if (existing !== null) {
        skipped++;
        continue;
      }
      await this.create(parsed, context);
      imported++;
    }
    return { imported, skipped };
  }

  async importOtpItems(
    candidates: readonly OtpImportCandidate[],
    expectedStatuses: readonly ("accepted" | "duplicate")[],
    context: VaultCryptoContext,
  ): Promise<ImportOtpItemsResult> {
    return this.serialize(async () => {
      if (
        candidates.length < 1 ||
        candidates.length > 1_000 ||
        candidates.length !== expectedStatuses.length
      )
        throw new StorageError("VAULT_INVALID");
      const loaded = await this.load(context);
      const existing = await Promise.all(
        loaded.records.map((record) => decryptVaultRecord(record, context.dek)),
      );
      const acceptedCandidates: OtpImportCandidate[] = [];
      const statuses = candidates.map((candidate) => {
        validateImportCandidate(candidate);
        const duplicate = [...existing, ...acceptedCandidates].some((item) =>
          sameOtpSemanticKey(item, candidate),
        );
        if (!duplicate) acceptedCandidates.push(candidate);
        return duplicate ? ("duplicate" as const) : ("accepted" as const);
      });
      const duplicate = statuses.filter((status) => status === "duplicate").length;
      if (statuses.some((status, index) => status !== expectedStatuses[index]))
        return Object.freeze({
          imported: 0,
          duplicate,
          previewChanged: true,
          items: Object.freeze([]),
          statuses: Object.freeze(statuses),
        });

      preflightOtpImportGenerationCapacity(
        {
          records: loaded.records.length,
          journal: loaded.journal.length,
          receipts: loaded.receipts.length,
          metadata: loaded.metadata.length,
        },
        acceptedCandidates.length,
        this.limits.maxJournalEntries,
        this.limits.maxGenerationEntries,
      );

      if (acceptedCandidates.length === 0)
        return Object.freeze({
          imported: 0,
          duplicate,
          previewChanged: false,
          items: Object.freeze([]),
          statuses: Object.freeze(statuses),
        });

      const now = context.clock.now();
      const items = acceptedCandidates.map((candidate) =>
        OtpItemSchema.parse({
          ...candidate,
          id: context.ids.next(),
          kind: "otp",
          schemaVersion: ITEM_SCHEMA_VERSION,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        }),
      );
      const encrypted = await Promise.all(items.map((item) => encryptVaultRecord(item, context)));
      let journal = loaded.journal;
      const newNonces = new Set(encrypted.map((record) => record.nonce));
      for (const item of items) {
        journal = compact(
          await this.changes.append(
            journal,
            journalEntry(item, "create", now),
            context.dek,
            context.random,
          ),
          this.limits.maxJournalEntries,
        );
        newNonces.add(journal.at(-1)!.nonce);
      }
      await this.commit(
        loaded.root,
        [...loaded.records, ...encrypted],
        journal,
        newNonces,
        loaded.receipts,
        loaded.metadata,
        context,
      );
      return Object.freeze({
        imported: items.length,
        duplicate,
        previewChanged: false,
        items: Object.freeze(items),
        statuses: Object.freeze(statuses),
      });
    });
  }

  async update(
    _candidate: VaultItem,
    expectedRevision: number,
    updater: ItemUpdater,
    context: VaultCryptoContext,
  ): Promise<VaultItem> {
    return this.serialize(async () => {
      const loaded = await this.load(context);
      const index = loaded.records.findIndex((record) => record.itemId === _candidate.id);
      if (index < 0 || loaded.records[index]!.revision !== expectedRevision) conflict();
      const current = await decryptVaultRecord(loaded.records[index]!, context.dek);
      const proposed = updater(current);
      const now = context.clock.now();
      const item = parseCandidate({
        ...proposed,
        id: current.id,
        kind: current.kind,
        schemaVersion: current.schemaVersion,
        revision: current.revision + 1,
        createdAt: current.createdAt,
        updatedAt: now,
        deletedAt: undefined,
      });
      const records = [...loaded.records];
      records[index] = await encryptVaultRecord(item, context);
      const newRecord = records[index];
      const journal = compact(
        await this.changes.append(
          loaded.journal,
          journalEntry(item, "update", now),
          context.dek,
          context.random,
        ),
        this.limits.maxJournalEntries,
      );
      await this.commit(
        loaded.root,
        records,
        journal,
        new Set([newRecord.nonce, journal.at(-1)!.nonce]),
        loaded.receipts,
        loaded.metadata,
        context,
      );
      return item;
    });
  }

  async lookupHotpReservationReceipt(
    request: HotpReservationCommitRequest,
    context: VaultCryptoContext,
  ): Promise<HotpReservationCommitResult | null> {
    const encrypted = await this.generations.readReceipt(
      hotpReceiptHash(request.reservationId),
      context,
    );
    if (encrypted === null) return null;
    const receipt = await decryptHotpReceipt(encrypted, context.dek);
    if (parseClockMilliseconds(context.clock.now()) >= receipt.expiresAt) return null;
    assertReceiptMatches(receipt, request);
    return { revision: receipt.resultRevision, counter: receipt.resultCounter };
  }

  async savePendingHotpReservation(
    candidate: PendingHotpReservation,
    context: VaultCryptoContext,
  ): Promise<void>;
  async savePendingHotpReservation(
    candidate: PendingHotpReservation,
    sessionEpoch: number,
    now: number,
    context: VaultCryptoContext,
  ): Promise<void>;
  async savePendingHotpReservation(
    candidate: PendingHotpReservation,
    epochOrContext: number | VaultCryptoContext,
    now?: number,
    suppliedContext?: VaultCryptoContext,
  ): Promise<void> {
    return this.serialize(async () => {
      const context = typeof epochOrContext === "number" ? suppliedContext! : epochOrContext;
      const sessionEpoch =
        typeof epochOrContext === "number" ? epochOrContext : candidate.sessionEpoch;
      const currentTime = typeof epochOrContext === "number" ? now! : candidate.createdAt;
      validateLifecycleAuthority(candidate.binding, sessionEpoch, currentTime);
      const value = PendingHotpReservationSchema.parse({ ...candidate, sessionEpoch });
      const loaded = await this.load(context);
      const existing = await readPendingHotpReservations(
        loaded.metadata,
        context,
        this.generations,
      );
      const retained = existing.filter(
        (entry) =>
          entry.sessionEpoch === sessionEpoch &&
          currentTime < entry.expiresAt &&
          !(entry.itemId === value.itemId && entry.sessionEpoch === sessionEpoch),
      );
      const matching = retained.find((entry) => entry.reservationId === value.reservationId);
      if (matching !== undefined && canonicalJson(matching) !== canonicalJson(value)) conflict();
      const reservations = [
        ...retained.filter((entry) => entry.reservationId !== value.reservationId),
        value,
      ];
      if (reservations.length > 100) capacity();
      await this.commitWithPendingReservations(loaded, reservations, context);
    });
  }

  async lookupPendingHotpReservation(
    reservationId: string,
    sessionEpoch: number,
    context: VaultCryptoContext,
  ): Promise<PendingHotpReservation | null> {
    const loaded = await this.load(context);
    const values = await readPendingHotpReservations(loaded.metadata, context, this.generations);
    const value = values.find((entry) => entry.reservationId === reservationId);
    return value === undefined || value.sessionEpoch !== sessionEpoch ? null : value;
  }

  async removePendingHotpReservation(
    reservationId: string,
    sessionEpoch: number,
    context: VaultCryptoContext,
  ): Promise<void> {
    return this.serialize(async () => {
      const loaded = await this.load(context);
      const existing = await readPendingHotpReservations(
        loaded.metadata,
        context,
        this.generations,
      );
      const reservations = existing.filter(
        (entry) => entry.reservationId !== reservationId || entry.sessionEpoch !== sessionEpoch,
      );
      if (reservations.length === existing.length) return;
      await this.commitWithPendingReservations(loaded, reservations, context);
    });
  }

  async cancelPendingHotpReservation(
    reservationId: string,
    binding: HotpReservationBinding,
    sessionEpoch: number,
    now: number,
    context: VaultCryptoContext,
  ): Promise<boolean> {
    return this.serialize(async () => {
      validateLifecycleAuthority(binding, sessionEpoch, now);
      const loaded = await this.load(context);
      const existing = await readPendingHotpReservations(
        loaded.metadata,
        context,
        this.generations,
      );
      const pending = existing.find((entry) => entry.reservationId === reservationId);
      if (
        pending === undefined ||
        pending.sessionEpoch !== sessionEpoch ||
        now >= pending.expiresAt ||
        !sameBinding(pending.binding, binding)
      )
        return false;
      const reservations = existing.filter((entry) => entry.reservationId !== reservationId);
      await this.commitWithPendingReservations(loaded, reservations, context);
      return true;
    });
  }

  commitPendingHotpReservation(
    reservationId: string,
    binding: HotpReservationBinding,
    sessionEpoch: number,
    now: number,
    context: VaultCryptoContext,
  ): Promise<HotpReservationCommitResult> {
    const existing = this.pendingCommits.get(reservationId);
    if (existing !== undefined) return existing;
    const operation = this.serialize(async () => {
      validateLifecycleAuthority(binding, sessionEpoch, now);
      const loaded = await this.load(context);
      const receipt = await findReceipt(loaded.receipts, reservationId, context.dek);
      if (receipt !== null && now < receipt.expiresAt) {
        assertReceiptAuthority(receipt, binding, sessionEpoch);
        return { revision: receipt.resultRevision, counter: receipt.resultCounter };
      }
      const pendingValues = await readPendingHotpReservations(
        loaded.metadata,
        context,
        this.generations,
      );
      const pending = pendingValues.find((entry) => entry.reservationId === reservationId);
      if (
        pending === undefined ||
        pending.sessionEpoch !== sessionEpoch ||
        now >= pending.expiresAt ||
        !sameBinding(pending.binding, binding)
      )
        conflict();
      const index = loaded.records.findIndex((record) => record.itemId === pending.itemId);
      if (index < 0 || loaded.records[index]!.revision !== pending.expectedRevision) conflict();
      const current = await decryptVaultRecord(loaded.records[index]!, context.dek);
      if (
        current.kind !== "otp" ||
        current.otpType !== "hotp" ||
        current.counter !== pending.expectedCounter ||
        current.counter >= Number.MAX_SAFE_INTEGER
      )
        conflict();
      const nowIso = context.clock.now();
      const liveReceipts = await retainLiveReceipts(
        loaded.receipts,
        now,
        this.limits.maxHotpReceipts,
        context.dek,
      );
      if (liveReceipts.length >= this.limits.maxHotpReceipts) capacity();
      const item = parseCandidate({
        ...current,
        revision: current.revision + 1,
        counter: current.counter + 1,
        updatedAt: nowIso,
      });
      const records = [...loaded.records];
      records[index] = await encryptVaultRecord(item, context);
      const journal = compact(
        await this.changes.append(
          loaded.journal,
          { ...journalEntry(item, "update", nowIso), mutationId: reservationId },
          context.dek,
          context.random,
        ),
        this.limits.maxJournalEntries,
      );
      const encryptedReceipt = await encryptHotpReceipt(
        {
          receiptVersion: 1,
          kind: "hotp-counter-commit",
          reservationId,
          itemId: pending.itemId,
          expectedRevision: pending.expectedRevision,
          expectedCounter: pending.expectedCounter,
          binding: pending.binding,
          sessionEpoch,
          resultRevision: item.revision,
          resultCounter: current.counter + 1,
          receiptSequence: await nextReceiptSequence(loaded.receipts, context.dek),
          committedAt: now,
          expiresAt: now + HOTP_RECEIPT_RETENTION_MS,
        },
        context.dek,
        context.random,
      );
      const metadataPlaintext = await pendingMetadataPlaintext(
        loaded.metadata,
        pendingValues.filter((entry) => entry.reservationId !== reservationId),
        context,
        this.generations,
      );
      await this.commitPlaintextMetadata(
        loaded.root,
        records,
        journal,
        [...liveReceipts, encryptedReceipt],
        metadataPlaintext,
        new Set([records[index].nonce, journal.at(-1)!.nonce, encryptedReceipt.nonce]),
        context,
      );
      return { revision: item.revision, counter: current.counter + 1 };
    }).finally(() => this.pendingCommits.delete(reservationId));
    this.pendingCommits.set(reservationId, operation);
    return operation;
  }

  async commitHotpReservation(
    request: HotpReservationCommitRequest,
    context: VaultCryptoContext,
  ): Promise<HotpReservationCommitResult> {
    return this.serialize(async () => {
      const replay = await this.lookupHotpReservationReceipt(request, context);
      if (replay !== null) return replay;
      const loaded = await this.load(context);
      const index = loaded.records.findIndex((record) => record.itemId === request.itemId);
      if (index < 0 || loaded.records[index]!.revision !== request.expectedRevision) conflict();
      const current = await decryptVaultRecord(loaded.records[index]!, context.dek);
      if (current.kind !== "otp") conflict();
      const counter = current.counter;
      if (
        current.otpType !== "hotp" ||
        counter === undefined ||
        counter !== request.expectedCounter
      )
        conflict();
      if (counter >= Number.MAX_SAFE_INTEGER) conflict();
      const now = context.clock.now();
      const nowMilliseconds = parseClockMilliseconds(now);
      const liveReceipts = await retainLiveReceipts(
        loaded.receipts,
        nowMilliseconds,
        this.limits.maxHotpReceipts,
        context.dek,
      );
      if (liveReceipts.length >= this.limits.maxHotpReceipts) capacity();
      const item = parseCandidate({
        ...current,
        revision: current.revision + 1,
        counter: counter + 1,
        updatedAt: now,
      });
      const records = [...loaded.records];
      records[index] = await encryptVaultRecord(item, context);
      const newRecord = records[index];
      const journal = compact(
        await this.changes.append(
          loaded.journal,
          { ...journalEntry(item, "update", now), mutationId: request.reservationId },
          context.dek,
          context.random,
        ),
        this.limits.maxJournalEntries,
      );
      const receipt = await encryptHotpReceipt(
        {
          receiptVersion: 1,
          kind: "hotp-counter-commit",
          reservationId: request.reservationId,
          itemId: request.itemId,
          expectedRevision: request.expectedRevision,
          expectedCounter: request.expectedCounter,
          binding: { tabId: 0, frameId: 0, documentId: "legacy-repository-committer" },
          sessionEpoch: 0,
          resultRevision: item.revision,
          resultCounter: counter + 1,
          receiptSequence: await nextReceiptSequence(loaded.receipts, context.dek),
          committedAt: nowMilliseconds,
          expiresAt: nowMilliseconds + HOTP_RECEIPT_RETENTION_MS,
        },
        context.dek,
        context.random,
      );
      const receipts = [...liveReceipts, receipt];
      await this.commit(
        loaded.root,
        records,
        journal,
        new Set([newRecord.nonce, journal.at(-1)!.nonce, receipt.nonce]),
        receipts,
        loaded.metadata,
        context,
      );
      return { revision: item.revision, counter: counter + 1 };
    });
  }

  async tombstone(
    itemId: string,
    expectedRevision: number,
    context: VaultCryptoContext,
  ): Promise<TombstoneResult> {
    return this.serialize(async () => {
      const loaded = await this.load(context);
      const index = loaded.records.findIndex((record) => record.itemId === itemId);
      if (index < 0 || loaded.records[index]!.revision !== expectedRevision) conflict();
      const current = await decryptVaultRecord(loaded.records[index]!, context.dek);
      const deletedAt = context.clock.now();
      const revision = current.revision + 1;
      const records = loaded.records.filter((_, recordIndex) => recordIndex !== index);
      const journal = compact(
        await this.changes.append(
          loaded.journal,
          {
            itemId,
            kind: current.kind,
            schemaVersion: current.schemaVersion,
            revision,
            operation: "delete",
            changedAt: deletedAt,
          },
          context.dek,
          context.random,
        ),
        this.limits.maxJournalEntries,
      );
      await this.commit(
        loaded.root,
        records,
        journal,
        new Set([journal.at(-1)!.nonce]),
        loaded.receipts,
        loaded.metadata,
        context,
      );
      return { id: itemId, revision, deletedAt };
    });
  }

  async listChangesAfter(cursor: number, limit: number, context: VaultCryptoContext) {
    return this.changes.listAfter(cursor, limit, context);
  }

  async rollback(context: VaultCryptoContext): Promise<VaultRoot> {
    return this.serialize(() => this.generations.rollback(context));
  }

  /**
   * Persists the current item schema version onto every stored record still
   * declaring a legacy version (schema widening: pre-multi-kind vaults only ever
   * held `kind: "otp"` records at item schema version 1). {@link decryptVaultRecord}
   * (via `parseVaultItemPlaintext`) already upgrades such a record's in-memory
   * `schemaVersion` transparently on every read, so this changes nothing about item
   * content, `revision`, or `updatedAt` — it only makes that upgrade durable in the
   * stored record's associated data by re-encrypting with a fresh nonce. No journal
   * entry is appended, since nothing observable about the item changed. A no-op
   * (nothing is committed, no new generation is created) once every stored record
   * already declares the current schema version, so calling this on every unlock is
   * cheap after the first successful migration.
   */
  async migrateLegacyItemSchema(context: VaultCryptoContext): Promise<number> {
    return this.serialize(async () => {
      const loaded = await this.load(context);
      const stale = loaded.records
        .map((record, index) => ({ record, index }))
        .filter(({ record }) => record.schemaVersion !== ITEM_SCHEMA_VERSION);
      if (stale.length === 0) return 0;
      const records = [...loaded.records];
      const newNonces = new Set<string>();
      for (const { record, index } of stale) {
        const item = await decryptVaultRecord(record, context.dek);
        const encrypted = await encryptVaultRecord(item, context);
        records[index] = encrypted;
        newNonces.add(encrypted.nonce);
      }
      await this.commit(
        loaded.root,
        records,
        loaded.journal,
        newNonces,
        loaded.receipts,
        loaded.metadata,
        context,
      );
      return stale.length;
    });
  }

  async collectGarbage(context: VaultCryptoContext): Promise<void> {
    await this.generations.collect(context);
  }

  private async load(context: VaultCryptoContext): Promise<{
    root: VaultRoot | null;
    records: readonly EncryptedRecord[];
    journal: readonly EncryptedJournalRecord[];
    receipts: readonly EncryptedHotpReceipt[];
    metadata: readonly EncryptedGenerationMetadata[];
  }> {
    const contents: GenerationContents | null = await this.generations.readActive(context);
    return contents ?? { root: null, records: [], journal: [], receipts: [], metadata: [] };
  }

  private async commitWithPendingReservations(
    loaded: {
      root: VaultRoot | null;
      records: readonly EncryptedRecord[];
      journal: readonly EncryptedJournalRecord[];
      receipts: readonly EncryptedHotpReceipt[];
      metadata: readonly EncryptedGenerationMetadata[];
    },
    reservations: readonly PendingHotpReservation[],
    context: VaultCryptoContext,
  ): Promise<void> {
    const metadata = await pendingMetadataPlaintext(
      loaded.metadata,
      reservations,
      context,
      this.generations,
    );
    await this.commitPlaintextMetadata(
      loaded.root,
      loaded.records,
      loaded.journal,
      loaded.receipts,
      metadata,
      new Set(),
      context,
    );
  }

  private async commitPlaintextMetadata(
    root: VaultRoot | null,
    records: readonly EncryptedRecord[],
    journal: readonly EncryptedJournalRecord[],
    receipts: readonly EncryptedHotpReceipt[],
    metadata: readonly {
      name: GenerationMetadataName;
      schemaVersion: 1;
      plaintext: Uint8Array;
    }[],
    newEnvelopeNonces: ReadonlySet<string>,
    context: VaultCryptoContext,
  ): Promise<void> {
    const retained = await this.generations.readRetained(context);
    const retainedNonces = collectRetainedNonces(retained);
    const staged = await this.generations.stage({
      expectedRoot: root,
      wrappedKey: this.wrappedKey,
      records,
      journal,
      receipts,
      metadata,
      newEnvelopeNonces,
      retainedNonces,
      context,
    });
    const verified = await this.generations.verify(staged, context);
    await this.activationCoordinator.beforeActivate(verified.root);
    try {
      const activated = await this.generations.activate(verified, context);
      await this.activationCoordinator.afterActivate(activated);
    } catch (error) {
      await this.activationCoordinator.activationFailed(verified.root);
      throw error;
    }
  }

  private async commit(
    root: VaultRoot | null,
    records: readonly EncryptedRecord[],
    journal: readonly EncryptedJournalRecord[],
    newEnvelopeNonces: ReadonlySet<string>,
    receipts: readonly EncryptedHotpReceipt[],
    metadata: readonly EncryptedGenerationMetadata[],
    context: VaultCryptoContext,
  ): Promise<void> {
    const retained = await this.generations.readRetained(context);
    const retainedNonces = new Set<string>();
    for (const generation of retained) {
      for (const envelope of [
        ...generation.records,
        ...generation.journal,
        ...generation.receipts,
        ...generation.metadata,
      ])
        retainedNonces.add(envelope.nonce);
      retainedNonces.add(generation.manifest.authentication.nonce);
      if (generation.marker !== null) retainedNonces.add(generation.marker.nonce);
    }
    const metadataPlaintext = await Promise.all(
      metadata.map(async (entry) => ({
        name: entry.name,
        schemaVersion: entry.schemaVersion,
        plaintext: await this.generations.decryptMetadata(entry, context),
      })),
    );
    const staged = await this.generations.stage({
      expectedRoot: root,
      wrappedKey: this.wrappedKey,
      records,
      journal,
      receipts,
      metadata: metadataPlaintext,
      newEnvelopeNonces,
      retainedNonces,
      context,
    });
    const verified = await this.generations.verify(staged, context);
    await this.activationCoordinator.beforeActivate(verified.root);
    try {
      const activated = await this.generations.activate(verified, context);
      await this.activationCoordinator.afterActivate(activated);
    } catch (error) {
      await this.activationCoordinator.activationFailed(verified.root);
      throw error;
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export async function encryptVaultRecord(
  item: VaultItem,
  context: VaultCryptoContext,
): Promise<EncryptedRecord> {
  const plaintext = new TextEncoder().encode(canonicalJson(item));
  if (plaintext.byteLength + AEAD_TAG_BYTES > MAX_ENCRYPTED_RECORD_BYTES) capacity();
  const metadata = {
    format: "shardpass-encrypted-record" as const,
    formatVersion: RECORD_FORMAT_VERSION,
    itemId: item.id,
    kind: item.kind,
    schemaVersion: item.schemaVersion,
    revision: item.revision,
  };
  const envelope = await encryptEnvelope(context.dek, plaintext, metadata, context.random);
  return EncryptedRecordSchema.parse({
    ...metadata,
    nonce: encodeBase64(envelope.nonce),
    ciphertext: encodeBase64(envelope.ciphertext),
    encoding: "base64",
  });
}

export async function decryptVaultRecord(
  record: EncryptedRecord,
  key: Uint8Array,
): Promise<VaultItem> {
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
    return item;
  } catch {
    throw new StorageError("VAULT_INVALID");
  }
}

function parseCandidate(candidate: unknown): VaultItem {
  try {
    return VaultItemSchema.parse(candidate);
  } catch {
    throw new StorageError("VAULT_INVALID");
  }
}

function projectOtpContent(item: OtpItem) {
  return {
    issuer: item.issuer,
    label: item.label,
    secret: item.secret,
    otpType: item.otpType,
    algorithm: item.algorithm,
    digits: item.digits,
    period: item.period,
    ...(item.counter === undefined ? {} : { counter: item.counter }),
    favorite: item.favorite,
    tags: [...item.tags],
    note: item.note,
  };
}

function journalEntry(item: VaultItem, operation: "create" | "update", changedAt: string) {
  return {
    itemId: item.id,
    kind: item.kind,
    schemaVersion: item.schemaVersion,
    revision: item.revision,
    operation,
    changedAt,
  } as const;
}
async function nextReceiptSequence(
  receipts: readonly EncryptedHotpReceipt[],
  key: Uint8Array,
): Promise<number> {
  let latest = 0;
  for (const receipt of receipts)
    latest = Math.max(latest, (await decryptHotpReceipt(receipt, key)).receiptSequence);
  return latest + 1;
}
async function retainLiveReceipts(
  values: readonly EncryptedHotpReceipt[],
  now: number,
  maximum: number,
  key: Uint8Array,
): Promise<readonly EncryptedHotpReceipt[]> {
  const sequenced = await Promise.all(
    values.map(async (receipt) => ({
      receipt,
      payload: await decryptHotpReceipt(receipt, key),
    })),
  );
  const live = sequenced
    .filter(({ payload }) => now < payload.expiresAt)
    .sort((left, right) => left.payload.receiptSequence - right.payload.receiptSequence);
  if (live.length > maximum) capacity();
  return live.map(({ receipt }) => receipt);
}

function parseClockMilliseconds(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new StorageError("VAULT_INVALID");
  return parsed;
}
async function findReceipt(
  values: readonly EncryptedHotpReceipt[],
  reservationId: string,
  key: Uint8Array,
): Promise<HotpCounterCommitReceipt | null> {
  const hash = hotpReceiptHash(reservationId);
  const encrypted = values.find((entry) => entry.receiptHash === hash);
  return encrypted === undefined ? null : decryptHotpReceipt(encrypted, key);
}

function validateLifecycleAuthority(
  binding: HotpReservationBinding,
  sessionEpoch: number,
  now: number,
): void {
  if (
    !Number.isSafeInteger(binding.tabId) ||
    binding.tabId < 0 ||
    !Number.isSafeInteger(binding.frameId) ||
    binding.frameId < 0 ||
    binding.documentId.length < 1 ||
    binding.documentId.length > 512 ||
    !Number.isSafeInteger(sessionEpoch) ||
    sessionEpoch < 0 ||
    !Number.isSafeInteger(now) ||
    now < 0
  )
    throw new StorageError("VAULT_INVALID");
}

function sameBinding(left: HotpReservationBinding, right: HotpReservationBinding): boolean {
  return (
    left.tabId === right.tabId &&
    left.frameId === right.frameId &&
    left.documentId === right.documentId
  );
}

function assertReceiptAuthority(
  receipt: HotpCounterCommitReceipt,
  binding: HotpReservationBinding,
  sessionEpoch: number,
): void {
  if (receipt.sessionEpoch !== sessionEpoch || !sameBinding(receipt.binding, binding)) conflict();
}

async function pendingMetadataPlaintext(
  metadata: readonly EncryptedGenerationMetadata[],
  reservations: readonly PendingHotpReservation[],
  context: VaultCryptoContext,
  generations: GenerationStore,
) {
  const preserved = await Promise.all(
    metadata
      .filter((entry) => entry.name !== "hotp-pending-state")
      .map(async (entry) => ({
        name: entry.name,
        schemaVersion: entry.schemaVersion,
        plaintext: await generations.decryptMetadata(entry, context),
      })),
  );
  return reservations.length === 0
    ? preserved
    : [
        ...preserved,
        {
          name: "hotp-pending-state" as const,
          schemaVersion: 1 as const,
          plaintext: encodePendingHotpReservations(reservations),
        },
      ];
}

function collectRetainedNonces(retained: readonly GenerationContents[]): Set<string> {
  const nonces = new Set<string>();
  for (const generation of retained) {
    for (const envelope of [
      ...generation.records,
      ...generation.journal,
      ...generation.receipts,
      ...generation.metadata,
    ])
      nonces.add(envelope.nonce);
    nonces.add(generation.manifest.authentication.nonce);
    if (generation.marker !== null) nonces.add(generation.marker.nonce);
  }
  return nonces;
}

async function readPendingHotpReservations(
  metadata: readonly EncryptedGenerationMetadata[],
  context: VaultCryptoContext,
  generations: GenerationStore,
): Promise<readonly PendingHotpReservation[]> {
  const entry = metadata.find((candidate) => candidate.name === "hotp-pending-state");
  return entry === undefined
    ? []
    : decodePendingHotpReservations(await generations.decryptMetadata(entry, context));
}

async function readPortableSettings(
  metadata: readonly EncryptedGenerationMetadata[],
  context: VaultCryptoContext,
  generations: GenerationStore,
): Promise<PortableLockSettings | null> {
  const entry = metadata.find((candidate) => candidate.name === "lock-settings");
  if (entry === undefined) return null;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
      await generations.decryptMetadata(entry, context),
    );
    const value = JSON.parse(decoded) as PortableLockSettings;
    if (decoded !== canonicalJson(value)) throw new Error("noncanonical settings");
    validatePortableSettings(value);
    return Object.freeze({ ...value });
  } catch {
    throw new StorageError("STORAGE_CORRUPT");
  }
}

async function replacePortableSettingsMetadata(
  metadata: readonly EncryptedGenerationMetadata[],
  settings: PortableLockSettings,
  context: VaultCryptoContext,
  generations: GenerationStore,
) {
  const preserved = await Promise.all(
    metadata
      .filter((entry) => entry.name !== "lock-settings")
      .map(async (entry) => ({
        name: entry.name,
        schemaVersion: entry.schemaVersion,
        plaintext: await generations.decryptMetadata(entry, context),
      })),
  );
  return [
    ...preserved,
    {
      name: "lock-settings" as const,
      schemaVersion: 1 as const,
      plaintext: new TextEncoder().encode(canonicalJson(settings)),
    },
  ];
}

function validatePortableSettings(settings: PortableLockSettings): void {
  if (
    ![0, 5, 15, 30, 60].includes(settings.autoLockMinutes) ||
    typeof settings.lockOnScreenLock !== "boolean" ||
    Object.keys(settings).length !== 2
  )
    throw new StorageError("VAULT_INVALID");
}

function validatePortableDescriptor(descriptor: PortableImportDescriptor): void {
  validatePortableSettings(descriptor.settings);
  let previous = 0;
  const revisions = new Map<string, number>();
  for (const entry of descriptor.history.journal) {
    if (entry.sequence <= previous) throw new StorageError("VAULT_INVALID");
    previous = entry.sequence;
    const prior = revisions.get(entry.itemId) ?? 0;
    if (entry.revision <= prior || (entry.operation === "create" && entry.revision !== 1))
      throw new StorageError("VAULT_INVALID");
    revisions.set(entry.itemId, entry.revision);
  }
  for (const tombstone of descriptor.history.tombstones) {
    const matching = descriptor.history.journal.find(
      (entry) =>
        entry.itemId === tombstone.itemId &&
        entry.operation === "delete" &&
        entry.revision === tombstone.revision &&
        entry.changedAt === tombstone.deletedAt,
    );
    if (matching === undefined) throw new StorageError("VAULT_INVALID");
  }
}

function logicalHistoryKey(entry: ChangeJournalEntry): string {
  return canonicalJson({
    itemId: entry.itemId,
    revision: entry.revision,
    operation: entry.operation,
    changedAt: entry.changedAt,
    mutationId: entry.mutationId,
  });
}

function mergePortableHistory(
  current: readonly ChangeJournalEntry[],
  imported: PortableHistory,
  maximum: number,
): ChangeJournalEntry[] {
  const seen = new Set<string>();
  const merged: ChangeJournalEntry[] = [];
  for (const entry of [...current, ...imported.journal]) {
    const key = logicalHistoryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...entry, sequence: merged.length + 1 });
  }
  const bounded = merged.slice(-maximum);
  return bounded.map((entry, index) => ({ ...entry, sequence: index + 1 }));
}

function portablePreview(
  existing: readonly VaultItem[],
  candidates: readonly OtpItem[],
  currentSettings: PortableLockSettings | null,
  currentJournal: readonly ChangeJournalEntry[],
  descriptor: PortableImportDescriptor,
): PortableImportPreview {
  validatePortableCandidates(candidates);
  const statuses = classifyPortableItems(existing, candidates).statuses;
  const currentKeys = new Set(currentJournal.map(logicalHistoryKey));
  const importedUnique = new Set(
    descriptor.history.journal.map(logicalHistoryKey).filter((key) => !currentKeys.has(key)),
  );
  const tombstoneKeys = new Set(
    currentJournal
      .filter((entry) => entry.operation === "delete")
      .map((entry) => `${entry.itemId}:${entry.revision}:${entry.changedAt}`),
  );
  const tombstonesAdded = new Set(
    descriptor.history.tombstones
      .map((entry) => `${entry.itemId}:${entry.revision}:${entry.deletedAt}`)
      .filter((key) => !tombstoneKeys.has(key)),
  ).size;
  return Object.freeze({
    statuses: Object.freeze([...statuses]),
    settings:
      currentSettings !== null &&
      canonicalJson(currentSettings) === canonicalJson(descriptor.settings)
        ? "unchanged"
        : "replace",
    history: Object.freeze({ journalAdded: importedUnique.size, tombstonesAdded }),
  });
}

function compact<T>(values: readonly T[], maximum: number): readonly T[] {
  return values.slice(Math.max(0, values.length - maximum));
}
function assertReceiptMatches(
  receipt: HotpCounterCommitReceipt,
  request: HotpReservationCommitRequest,
): void {
  if (
    receipt.reservationId !== request.reservationId ||
    receipt.itemId !== request.itemId ||
    receipt.expectedRevision !== request.expectedRevision ||
    receipt.expectedCounter !== request.expectedCounter
  )
    conflict();
}
function validateLimits(limits: {
  readonly maxJournalEntries: number;
  readonly maxHotpReceipts: number;
  readonly maxGenerationEntries?: number;
}): void {
  if (
    !Number.isSafeInteger(limits.maxJournalEntries) ||
    limits.maxJournalEntries < 1 ||
    limits.maxJournalEntries > MAX_JOURNAL_ENTRIES ||
    !Number.isSafeInteger(limits.maxHotpReceipts) ||
    limits.maxHotpReceipts < 1 ||
    limits.maxHotpReceipts > MAX_HOTP_RECEIPTS ||
    (limits.maxGenerationEntries !== undefined &&
      (!Number.isSafeInteger(limits.maxGenerationEntries) || limits.maxGenerationEntries < 1))
  )
    throw new StorageError("VAULT_INVALID");
}
export function preflightOtpImportGenerationCapacity(
  current: Readonly<{ records: number; journal: number; receipts: number; metadata: number }>,
  accepted: number,
  maxJournalEntries: number,
  maximum?: number,
): number {
  if (!Number.isSafeInteger(accepted) || accepted < 0) capacity();
  const journal = Math.min(maxJournalEntries, current.journal + accepted);
  const total = generationEntryCount({
    records: current.records + accepted,
    journal,
    receipts: current.receipts,
    metadata: current.metadata,
  });
  if (maximum !== undefined && total > maximum) capacity();
  return total;
}
function validateImportCandidate(candidate: OtpImportCandidate): void {
  OtpItemSchema.parse({
    ...candidate,
    id: "00000000-0000-4000-8000-000000000000",
    kind: "otp",
    schemaVersion: ITEM_SCHEMA_VERSION,
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}
function validatePortableCandidates(candidates: readonly OtpItem[]): void {
  if (candidates.length > 10_000) throw new StorageError("VAULT_INVALID");
  for (const candidate of candidates) OtpItemSchema.parse(candidate);
}
function classifyPortableItems(existing: readonly VaultItem[], candidates: readonly OtpItem[]) {
  const accepted: Array<{ candidate: OtpItem; existingIndex: number }> = [];
  const claimedIds = new Set<string>();
  const statuses = candidates.map((candidate): PortableOtpImportStatus => {
    if (claimedIds.has(candidate.id)) return "conflict";
    claimedIds.add(candidate.id);
    const existingIndex = existing.findIndex((item) => item.id === candidate.id);
    if (existingIndex >= 0) {
      const current = existing[existingIndex]!;
      if (!samePortableStableIdentity(current, candidate)) return "conflict";
      if (
        current.kind === "otp" &&
        current.otpType === "hotp" &&
        (candidate.counter ?? 0) > (current.counter ?? 0)
      ) {
        accepted.push({ candidate, existingIndex });
        return "accepted";
      }
      return "duplicate";
    }
    if (existing.some((item) => sameOtpSemanticKeyIgnoringCounter(item, candidate)))
      return "duplicate";
    accepted.push({ candidate, existingIndex: -1 });
    return "accepted";
  });
  return { accepted, statuses };
}
function samePortableStableIdentity(left: VaultItem, right: OtpItem): boolean {
  return left.id === right.id && sameOtpSemanticKeyIgnoringCounter(left, right);
}
/**
 * Non-OTP vault items never match an OTP candidate: `VaultItem` values narrow to
 * `OtpItem` when their `kind` is `"otp"`; `OtpImportCandidate` values (which carry no
 * `kind` discriminant) are always OTP-shaped.
 */
function isOtpComparable(
  value: VaultItem | OtpImportCandidate,
): value is OtpItem | OtpImportCandidate {
  return !("kind" in value) || value.kind === "otp";
}
function sameOtpSemanticKeyIgnoringCounter(
  left: VaultItem | OtpImportCandidate,
  right: VaultItem | OtpImportCandidate,
): boolean {
  if (!isOtpComparable(left) || !isOtpComparable(right)) return false;
  return (
    left.otpType === right.otpType &&
    left.secret === right.secret &&
    left.algorithm === right.algorithm &&
    left.digits === right.digits &&
    left.period === right.period &&
    left.issuer.normalize("NFKC") === right.issuer.normalize("NFKC") &&
    left.label.normalize("NFKC") === right.label.normalize("NFKC")
  );
}
function portableImportResult(
  imported: number,
  duplicate: number,
  conflictCount: number,
  previewChanged: boolean,
  items: readonly OtpItem[],
  statuses: readonly PortableOtpImportStatus[],
): ImportPortableOtpItemsResult {
  return Object.freeze({
    imported,
    duplicate,
    conflict: conflictCount,
    previewChanged,
    items: Object.freeze([...items]),
    statuses: Object.freeze([...statuses]),
  });
}
function sameOtpSemanticKey(
  left: VaultItem | OtpImportCandidate,
  right: OtpImportCandidate,
): boolean {
  if (!isOtpComparable(left)) return false;
  return (
    left.otpType === right.otpType &&
    left.secret === right.secret &&
    left.algorithm === right.algorithm &&
    left.digits === right.digits &&
    left.period === right.period &&
    (left.counter ?? null) === (right.counter ?? null) &&
    left.issuer.normalize("NFKC") === right.issuer.normalize("NFKC") &&
    left.label.normalize("NFKC") === right.label.normalize("NFKC")
  );
}
function capacity(): never {
  throw new StorageError("STORAGE_CAPACITY_EXCEEDED");
}
function conflict(): never {
  throw new StorageError("REVISION_CONFLICT");
}
