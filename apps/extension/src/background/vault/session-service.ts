import {
  ARGON2ID_SALT_BYTES,
  DEFAULT_ARGON2ID_PARAMETERS,
  decryptEnvelope,
  encryptEnvelope,
  createVaultKeyMaterialFromKeyEncryptionKey,
  unwrapVaultDataKeyWithKeyEncryptionKey,
  wrapVaultDataKeyWithKeyEncryptionKey,
  type RandomSource,
} from "@shardpass/crypto";
import { OtpItemSchema, VaultItemSchema, type OtpItem, type VaultItem } from "@shardpass/domain";
import type {
  PortableBackupSnapshot,
  SafeBackupDescriptor,
  VaultLockSettings,
  VaultState,
} from "@shardpass/messaging";
import type {
  CreateManyOutcome,
  PortableFolderOutcome,
  PortableItemKindCounts,
  PortableOtpImportStatus,
  TombstoneResult,
  VaultItemMetadata,
} from "@shardpass/storage";
import {
  ACTIVE_ROOT_KEY,
  GENERATION_PREFIX,
  GenerationStore,
  StorageError,
  VaultRepository,
  VaultRootSchema,
  canonicalJson,
  validateCanonicalBase64,
  decryptVaultRecord,
  encryptVaultRecord,
  type Clock,
  type GenerationContents,
  type IdSource,
  type GenerationMetadataName,
  type OtpImportCandidate,
  type StoragePort,
  type VaultCryptoContext,
  type VaultRoot,
  type VerifiedStagedGeneration,
} from "@shardpass/storage";

import {
  createSessionVaultRepository,
  type SessionVaultRepository,
} from "./session-vault-repository";

const ATTEMPTS_KEY = "shardpass:v1:unlock-attempts";
/**
 * The unlocked data key, kept in chrome.storage.session (memory-only, extension-private,
 * cleared when the browser closes) so an MV3 service-worker teardown -- which happens after
 * ~30 s of idleness -- does not lock the vault. Without this, "auto-lock after 15 minutes"
 * was a promise the worker could not keep. Bound to the active root it was unlocked against.
 */
const SESSION_KEY = "shardpass:v1:session";
const ATTEMPT_VERSION = 1;
const CHALLENGE_LIFETIME_MS = 300_000;
const FAILURE_THRESHOLD = 5;
const BASE_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 86_400_000;
const MAX_FAILURES = Number.MAX_SAFE_INTEGER;
/**
 * How old a staged-but-never-activated generation must be before orphan collection reclaims
 * it. A migration staged by a previous worker instance is resumed from storage by the next
 * one, so anything younger than this is presumed to be in flight.
 */
export const ORPHAN_GENERATION_GRACE_MS = 60 * 60 * 1000;

type AttemptState = Readonly<{
  version: 1;
  failures: number;
  deadline: number;
  observedAt: number;
}>;

export type VaultSessionErrorCode =
  | "CHALLENGE_INVALID"
  | "INVALID_CREDENTIALS"
  | "THROTTLED"
  | "VAULT_ALREADY_CONFIGURED"
  | "VAULT_LOCKED"
  | "VAULT_NOT_CONFIGURED"
  | "VAULT_UNAVAILABLE";

export class VaultSessionError extends Error {
  constructor(
    readonly code: VaultSessionErrorCode,
    readonly retryAfterMs = 0,
  ) {
    super(code);
    this.name = "VaultSessionError";
  }
}

type ChallengePurpose = "setup" | "unlock" | "change-current" | "change-new";
export type SenderBinding = Readonly<{
  extensionId: string;
  contextKind: "popup" | "vault";
  senderUrl: string;
  documentId: string;
  tabId?: number;
  frameId?: number;
}>;
type Challenge = Readonly<{
  challengeId: string;
  purpose: ChallengePurpose;
  salt: Uint8Array;
  rootBinding: string;
  senderBinding: SenderBinding;
  expiresAt: number;
}>;

export type MutationOutcome = Readonly<{
  committed: boolean;
  state: "unlocked" | "locked";
}>;
export type MigrationCapability = Readonly<{
  epoch: number;
  activeGenerationId: string;
}>;
/** Opaque authority validated only by this session instance. */
export type BackupSessionAuthority = Readonly<Record<never, never>>;
export type MigrationMetadataPlaintext = Readonly<{
  name: GenerationMetadataName;
  schemaVersion: 1;
  plaintext: Uint8Array;
}>;
export type MigrationStageInput = Readonly<{
  generationId?: string;
  items: readonly OtpItem[];
  metadata: readonly MigrationMetadataPlaintext[];
}>;
export type MigrationStageReference = Readonly<{ generationId: string }>;
export type MigrationReadResult = Readonly<{
  items: readonly OtpItem[];
  metadata: readonly MigrationMetadataPlaintext[];
}>;
export type MigrationTransactionEnvelope = Readonly<{
  format: "shardpass:migration-transaction";
  version: 2;
  transactionId: string;
  nonce: string;
  ciphertext: string;
}>;

const MIGRATION_TRANSACTION_FORMAT = "shardpass:migration-transaction";
const MIGRATION_TRANSACTION_VERSION = 2;
const MAX_MIGRATION_TRANSACTION_BYTES = 256 * 1024;
const XCHACHA_NONCE_BYTES = 24;
const AEAD_TAG_BYTES = 16;

class AsyncMutex {
  private tail = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

type SessionDependencies = Readonly<{
  local: StoragePort;
  session: StoragePort;
  random: RandomSource;
  now(): number;
  isoNow(): string;
  nextId(): string;
}>;

export class SessionService {
  private readonly generations: GenerationStore;
  private readonly challenges = new Map<string, Challenge>();
  private readonly mutationMutex = new AsyncMutex();
  private readonly credentialMutex = new AsyncMutex();
  private readonly lockCallbacks = new Set<() => void>();
  readonly vaultRepository: SessionVaultRepository;
  private readonly migrationCapabilities = new WeakMap<
    MigrationCapability,
    { epoch: number; root: VaultRoot }
  >();
  private readonly migrationStages = new WeakMap<
    MigrationStageReference,
    {
      capability: MigrationCapability;
      verified: VerifiedStagedGeneration;
    }
  >();
  private readonly backupAuthorities = new Map<
    BackupSessionAuthority,
    { epoch: number; root: VaultRoot }
  >();
  private commitCandidate: string | null = null;
  private rootObservationSequence = 0;
  private lastNonCandidateRootObservationSequence = 0;
  /** Opaque local-generation CAS revision; never exposes the root or key. */
  private repositoryRevision = 0;
  private dek: Uint8Array | null = null;
  private expectedRoot: VaultRoot | null = null;
  private epoch = 0;
  /**
   * The last generation this session authenticated in full (hash and AEAD over every record,
   * journal entry, receipt, metadata blob, the manifest, and the marker) with the current key,
   * remembered so a request costs one root read instead of three full passes.
   *
   * Invariant: an entry is trusted only while (1) the session is unlocked with the key that
   * did the authentication -- lock, an epoch change, and clearLockedState drop it, and it is
   * never carried across lock/unlock; (2) nothing has been observed to change under it --
   * activation, every storage-change notification, and any failed operation drop it; and
   * (3) the stored root still equals the entry's root, which is re-read and compared on every
   * use, so a root swapped underneath the cache is detected before the cache is honoured.
   * A hit therefore proves "the root this session is bound to is still the one in storage,
   * and its contents authenticated under this key". It never stands in for the
   * authentication a repository operation performs on its own load, which still reads and
   * validates every entry before use.
   */
  private authenticatedActive: {
    readonly epoch: number;
    readonly revision: number;
    readonly root: string;
    readonly contents: GenerationContents;
  } | null = null;
  /** Generations this instance is staging outside the mutation mutex (migrations). */
  private readonly stagingGenerationIds = new Set<string>();
  private orphanCollectionScheduled = false;

  constructor(private readonly dependencies: SessionDependencies) {
    this.generations = new GenerationStore(dependencies.local);
    this.vaultRepository = createSessionVaultRepository({
      listItems: () => this.repositoryListItems(),
      listAllItems: () => this.repositoryListAllItems(),
      getItem: (itemId) => this.repositoryGetItem(itemId),
      createItem: (candidate) => this.repositoryCreateItem(candidate),
      createItems: (candidates) => this.repositoryCreateItems(candidates),
      readFolders: () =>
        this.#runRepositoryOperation((repository, context) => repository.readFolders(context)),
      replaceFolders: (folders) =>
        this.#runRepositoryOperation((repository, context) =>
          repository.replaceFolders(folders, context),
        ),
      updateItem: (candidate, expectedRevision) =>
        this.repositoryUpdateItem(candidate, expectedRevision),
      readGenerationMetadata: (name) =>
        this.#runRepositoryOperation((repository, context) =>
          repository.readGenerationMetadata(name, context),
        ),
      readOtpItemsAndMetadata: (name) => this.readOtpItemsAndMetadata(name),
      replaceOtpItemsAndMetadata: (candidates, metadata) => {
        const owned = candidates.map(copyOtpItem);
        const ownedMetadata = { ...metadata, plaintext: metadata.plaintext.slice() };
        return this.#runRepositoryOperation((repository, context) =>
          repository.replaceOtpItemsAndMetadata(owned, ownedMetadata, context),
        ).finally(() => {
          owned.splice(0);
          ownedMetadata.plaintext.fill(0);
        });
      },
      replaceOtpItemsAndMetadataIfEpoch: (expectedSessionEpoch, candidates, metadata) =>
        this.replaceOtpItemsAndMetadataIfEpoch(expectedSessionEpoch, candidates, metadata),
      removeOtpMetadataIfEpoch: (expectedSessionEpoch, candidates, name) =>
        this.removeOtpMetadataIfEpoch(expectedSessionEpoch, candidates, name),
      readPortableState: () =>
        this.#runRepositoryOperation((repository, context) =>
          repository.readPortableState(context),
        ),
      previewPortableImport: (candidates, descriptor) => {
        const owned = candidates.map(copyVaultItem);
        return this.#runRepositoryOperation((repository, context) =>
          repository.previewPortableImport(owned, descriptor, context),
        ).finally(() => owned.splice(0));
      },
      importPortableState: (candidates, descriptor, expected) => {
        const owned = candidates.map(copyVaultItem);
        return this.#runRepositoryOperation((repository, context) =>
          repository.importPortableState(owned, descriptor, expected, context),
        ).finally(() => owned.splice(0));
      },
      previewPortableOtpItems: (candidates) => {
        const owned = candidates.map(copyOtpItem);
        return this.#runRepositoryOperation((repository, context) =>
          repository.previewPortableOtpItems(owned, context),
        ).finally(() => owned.splice(0));
      },
      importPortableOtpItems: (candidates, expectedStatuses) => {
        const owned = candidates.map(copyOtpItem);
        const ownedStatuses = [...expectedStatuses];
        return this.#runRepositoryOperation((repository, context) =>
          repository.importPortableOtpItems(owned, ownedStatuses, context),
        ).finally(() => {
          owned.splice(0);
          ownedStatuses.splice(0);
        });
      },
      listMetadata: () => this.repositoryListMetadata(),
      get: (itemId) => this.repositoryGet(itemId),
      create: (candidate) => this.repositoryCreate(candidate),
      importOtpBatch: async (candidates, expectedStatuses, observeOwnedCandidates) => {
        const owned = candidates.map(copyImportCandidate);
        const ownedStatuses = [...expectedStatuses];
        observeOwnedCandidates?.(owned);
        try {
          return await this.#runRepositoryOperation((repository, context) =>
            repository.importOtpItems(owned, ownedStatuses, context),
          );
        } finally {
          owned.splice(0);
          ownedStatuses.splice(0);
        }
      },
      update: (candidate, expectedRevision) => this.repositoryUpdate(candidate, expectedRevision),
      tombstone: (itemId, expectedRevision) => this.repositoryTombstone(itemId, expectedRevision),
      commitHotpReservation: (reservationId, binding) =>
        this.#runRepositoryOperation((repository, context) =>
          repository.commitPendingHotpReservation(
            reservationId,
            binding,
            this.epoch,
            this.dependencies.now(),
            context,
          ),
        ),
      cancelHotpReservation: (reservationId, binding) =>
        this.#runRepositoryOperation((repository, context) =>
          repository.cancelPendingHotpReservation(
            reservationId,
            binding,
            this.epoch,
            this.dependencies.now(),
            context,
          ),
        ),
      savePendingHotpReservation: (candidate) =>
        this.#runRepositoryOperation((repository, context) =>
          repository.savePendingHotpReservation(
            { ...candidate, sessionEpoch: this.epoch },
            this.epoch,
            this.dependencies.now(),
            context,
          ),
        ),
      migrateLegacySchema: () =>
        this.#runRepositoryOperation((repository, context) =>
          repository.migrateLegacyItemSchema(context),
        ),
    });
  }

  async getState(): Promise<{ state: VaultState; retryAfterMs: number }> {
    if (this.dek !== null) await this.assertActiveRoot();
    const root = await this.readRoot();
    const retryAfterMs = await this.retryAfter();
    return {
      state: root === null ? "unconfigured" : this.dek === null ? "locked" : "unlocked",
      retryAfterMs,
    };
  }

  async createChallenge(purpose: ChallengePurpose, sender: SenderBinding) {
    if (!sender.documentId) throw new VaultSessionError("CHALLENGE_INVALID");
    if (this.dek !== null) await this.assertActiveRoot();
    const retryAfterMs = await this.credentialMutex.run(() => this.retryAfter());
    if (retryAfterMs > 0) throw new VaultSessionError("THROTTLED", retryAfterMs);
    const root = await this.readRoot();
    if (purpose === "setup" && root !== null)
      throw new VaultSessionError("VAULT_ALREADY_CONFIGURED");
    if (purpose !== "setup" && root === null) throw new VaultSessionError("VAULT_NOT_CONFIGURED");
    if ((purpose === "change-current" || purpose === "change-new") && this.dek === null)
      throw new VaultSessionError("VAULT_LOCKED");
    const salt =
      purpose === "setup" || purpose === "change-new"
        ? this.dependencies.random.randomBytes(ARGON2ID_SALT_BYTES)
        : decodeBase64(root!.wrappedKey.kdf.salt);
    const challenge: Challenge = {
      challengeId: hex(this.dependencies.random.randomBytes(16)),
      purpose,
      salt,
      rootBinding: canonicalJson(root),
      senderBinding: sender,
      expiresAt: safeAdd(this.now(), CHALLENGE_LIFETIME_MS),
    };
    this.challenges.set(challenge.challengeId, challenge);
    return {
      challengeId: challenge.challengeId,
      purpose,
      kdf:
        purpose === "setup" || purpose === "change-new"
          ? { ...DEFAULT_ARGON2ID_PARAMETERS, salt: encodeBase64(salt) }
          : root!.wrappedKey.kdf,
      expiresAt: challenge.expiresAt,
    };
  }

  createBackupStepUpChallenge(sender: SenderBinding) {
    return this.createChallenge("change-current", sender);
  }

  authorizeBackupExport(
    challengeId: string,
    keyEncryptionKey: Uint8Array,
    sender: SenderBinding,
  ): Promise<BackupSessionAuthority> {
    return this.credentialMutex.run(() =>
      this.authorizeBackupExportInternal(challengeId, keyEncryptionKey, sender),
    );
  }

  private async authorizeBackupExportInternal(
    challengeId: string,
    keyEncryptionKey: Uint8Array,
    sender: SenderBinding,
  ): Promise<BackupSessionAuthority> {
    const operationEpoch = this.epoch;
    let verifiedDek: Uint8Array | null = null;
    try {
      const challenge = this.consume(challengeId, "change-current", sender);
      const retryAfterMs = await this.retryAfter();
      if (retryAfterMs > 0) throw new VaultSessionError("THROTTLED", retryAfterMs);
      this.assertEpoch(operationEpoch);
      await this.assertActiveRoot();
      this.assertEpoch(operationEpoch);
      const root = await this.readRoot();
      this.assertEpoch(operationEpoch);
      if (this.dek === null || root === null || challenge.rootBinding !== canonicalJson(root)) {
        await this.recordFailure();
        this.assertEpoch(operationEpoch);
        throw new VaultSessionError("INVALID_CREDENTIALS");
      }
      verifiedDek = await unwrapVaultDataKeyWithKeyEncryptionKey(keyEncryptionKey, root.wrappedKey);
      this.assertEpoch(operationEpoch);
      if (!equalBytes(verifiedDek, this.dek)) throw new Error("credential mismatch");
      verifiedDek.fill(0);
      verifiedDek = null;
      await this.clearAttempts();
      this.assertEpoch(operationEpoch);
      const authority = Object.freeze({}) as BackupSessionAuthority;
      this.backupAuthorities.set(authority, { epoch: this.epoch, root });
      return authority;
    } catch (error) {
      verifiedDek?.fill(0);
      if (
        error instanceof VaultSessionError &&
        (error.code === "CHALLENGE_INVALID" ||
          error.code === "THROTTLED" ||
          error.code === "VAULT_LOCKED")
      )
        throw error;
      await this.recordFailure();
      this.assertEpoch(operationEpoch);
      throw new VaultSessionError("INVALID_CREDENTIALS");
    } finally {
      keyEncryptionKey.fill(0);
    }
  }

  async captureBackupSession(): Promise<BackupSessionAuthority> {
    const operationEpoch = this.epoch;
    await this.assertActiveRoot();
    this.assertEpoch(operationEpoch);
    if (this.dek === null || this.expectedRoot === null)
      throw new VaultSessionError("VAULT_LOCKED");
    const authority = Object.freeze({}) as BackupSessionAuthority;
    this.backupAuthorities.set(authority, { epoch: this.epoch, root: this.expectedRoot });
    return authority;
  }

  async updateLockSettings(settings: VaultLockSettings): Promise<MutationOutcome> {
    const normalized = {
      autoLockMinutes: normalizePortableAutoLockMinutes(settings.autoLockMinutes),
      lockOnScreenLock: settings.lockOnScreenLock,
    };
    await this.#runRepositoryOperation((repository, context) =>
      repository.updatePortableSettings(normalized, context),
    );
    return { committed: true, state: "unlocked" };
  }

  async readPortableBackupSnapshot(
    authority: BackupSessionAuthority,
    readSettings: () => VaultLockSettings | Promise<VaultLockSettings> = () => ({
      autoLockMinutes: 15,
      lockOnScreenLock: true,
    }),
  ): Promise<PortableBackupSnapshot> {
    await this.assertBackupSession(authority);
    const state = await this.vaultRepository.readPortableState();
    await this.assertBackupSession(authority);
    const settings = state.settings ?? (await readSettings());
    await this.assertBackupSession(authority);
    return {
      schemaVersion: 2,
      exportedAt: this.dependencies.isoNow(),
      items: state.items.map(copyVaultItem),
      folders: state.folders.map((folder) => ({ ...folder })),
      settings: {
        autoLockMinutes: normalizePortableAutoLockMinutes(settings.autoLockMinutes),
        lockOnScreenLock: settings.lockOnScreenLock,
      },
      history: {
        journal: state.journal.map((entry) => ({ ...entry })),
        tombstones: state.tombstones.map((entry) => ({ ...entry })),
      },
    };
  }

  async previewPortableBackupImport(
    descriptor: SafeBackupDescriptor,
    candidates: readonly VaultItem[],
    authority: BackupSessionAuthority,
  ) {
    await this.assertBackupSession(authority);
    const result = await this.vaultRepository.previewPortableImport(candidates, descriptor);
    await this.assertBackupSession(authority);
    return summarizePortablePreview(result);
  }

  async confirmPortableBackupImport(
    descriptor: SafeBackupDescriptor,
    candidates: readonly VaultItem[],
    expected: Readonly<{
      rows: readonly Readonly<{
        status: "accepted" | "duplicate" | "conflict" | "rejected";
      }>[];
      settings: "unchanged" | "replace";
      history: Readonly<{ journalAdded: number; tombstonesAdded: number }>;
      byKind: PortableItemKindCounts;
      folders: PortableFolderOutcome;
    }>,
    authority: BackupSessionAuthority,
  ) {
    await this.assertBackupSession(authority);
    const statuses = expected.rows.map((row) => row.status).filter(isPortableOtpImportStatus);
    if (statuses.length !== expected.rows.length) throw new VaultSessionError("VAULT_UNAVAILABLE");
    const expectedPreview = {
      statuses,
      settings: expected.settings,
      history: expected.history,
      byKind: expected.byKind,
      folders: expected.folders,
    } as const;
    const result = await this.vaultRepository.importPortableState(
      candidates,
      descriptor,
      expectedPreview,
    );
    const binding = this.backupAuthorities.get(authority);
    if (binding !== undefined && this.expectedRoot !== null)
      this.backupAuthorities.set(authority, { epoch: binding.epoch, root: this.expectedRoot });
    await this.assertBackupSession(authority);
    const current = result.previewChanged
      ? await this.vaultRepository.previewPortableImport(candidates, descriptor)
      : null;
    return result.previewChanged
      ? { previewChanged: true as const, preview: summarizePortablePreview(current!) }
      : {
          previewChanged: false as const,
          imported: result.imported,
          duplicate: result.duplicate,
          conflict: result.conflict,
          byKind: { ...result.byKind },
          folders: { ...result.folders },
        };
  }

  async assertBackupSession(authority: BackupSessionAuthority): Promise<void> {
    const binding = this.backupAuthorities.get(authority);
    if (
      binding === undefined ||
      binding.epoch !== this.epoch ||
      this.dek === null ||
      this.expectedRoot === null ||
      canonicalJson(binding.root) !== canonicalJson(this.expectedRoot)
    )
      throw new VaultSessionError("VAULT_LOCKED");
    await this.assertActiveRoot();
    if (
      binding.epoch !== this.epoch ||
      this.expectedRoot === null ||
      canonicalJson(binding.root) !== canonicalJson(this.expectedRoot)
    )
      throw new VaultSessionError("VAULT_LOCKED");
  }

  setup(
    challengeId: string,
    keyEncryptionKey: Uint8Array,
    sender: SenderBinding,
    settings: VaultLockSettings = { autoLockMinutes: 15, lockOnScreenLock: true },
  ): Promise<MutationOutcome> {
    return this.mutationMutex.run(() =>
      this.setupInternal(challengeId, keyEncryptionKey, sender, settings),
    );
  }

  private async setupInternal(
    challengeId: string,
    keyEncryptionKey: Uint8Array,
    sender: SenderBinding,
    settings: VaultLockSettings,
  ): Promise<MutationOutcome> {
    const operationEpoch = this.epoch;
    let candidateDek: Uint8Array | null = null;
    try {
      const challenge = this.consume(challengeId, "setup", sender);
      this.assertEpoch(operationEpoch);
      if ((await this.readRoot()) !== null) throw new VaultSessionError("VAULT_ALREADY_CONFIGURED");
      this.assertEpoch(operationEpoch);
      const material = await createVaultKeyMaterialFromKeyEncryptionKey(
        keyEncryptionKey,
        challenge.salt,
        DEFAULT_ARGON2ID_PARAMETERS,
        this.dependencies.random,
      );
      candidateDek = material.vaultDataKey;
      this.assertEpoch(operationEpoch);
      const context = this.context(candidateDek);
      const staged = await this.generations.stage({
        expectedRoot: null,
        wrappedKey: material.wrappedKey,
        records: [],
        journal: [],
        metadata: [
          {
            name: "lock-settings",
            schemaVersion: 1,
            plaintext: new TextEncoder().encode(
              canonicalJson({
                autoLockMinutes: normalizePortableAutoLockMinutes(settings.autoLockMinutes),
                lockOnScreenLock: settings.lockOnScreenLock,
              }),
            ),
          },
        ],
        context,
      });
      this.assertEpoch(operationEpoch);
      const verified = await this.generations.verify(staged, context);
      this.assertEpoch(operationEpoch);
      const outcome = await this.commitRoot(verified, context, operationEpoch, candidateDek);
      if (outcome.state === "locked") {
        candidateDek.fill(0);
        candidateDek = null;
        return outcome;
      }
      this.dek = candidateDek;
      candidateDek = null;
      await this.clearAttempts();
      this.assertEpoch(operationEpoch);
      await this.rememberSession();
      return outcome;
    } catch (error) {
      candidateDek?.fill(0);
      if (error instanceof VaultSessionError) throw error;
      throw new VaultSessionError("VAULT_UNAVAILABLE");
    } finally {
      keyEncryptionKey.fill(0);
    }
  }

  async unlock(
    challengeId: string,
    keyEncryptionKey: Uint8Array,
    sender: SenderBinding,
  ): Promise<void> {
    await this.credentialMutex.run(() =>
      this.unlockInternal(challengeId, keyEncryptionKey, sender),
    );
    this.scheduleOrphanCollection();
  }

  private async unlockInternal(
    challengeId: string,
    keyEncryptionKey: Uint8Array,
    sender: SenderBinding,
  ): Promise<void> {
    const operationEpoch = this.epoch;
    let candidateDek: Uint8Array | null = null;
    try {
      const challenge = this.consume(challengeId, "unlock", sender);
      const retryAfterMs = await this.retryAfter();
      if (retryAfterMs > 0) throw new VaultSessionError("THROTTLED", retryAfterMs);
      this.assertEpoch(operationEpoch);
      const root = await this.readRoot();
      this.assertEpoch(operationEpoch);
      if (root === null || canonicalJson(root) !== challenge.rootBinding) {
        await this.recordFailure();
        this.assertEpoch(operationEpoch);
        throw new VaultSessionError("INVALID_CREDENTIALS");
      }
      try {
        candidateDek = await unwrapVaultDataKeyWithKeyEncryptionKey(
          keyEncryptionKey,
          root.wrappedKey,
        );
        this.assertEpoch(operationEpoch);
        const active = await this.generations.readActive({ dek: candidateDek });
        this.assertEpoch(operationEpoch);
        this.dek = candidateDek;
        candidateDek = null;
        this.expectedRoot = root;
        this.rememberAuthenticatedActive(active);
        await this.clearAttempts();
        this.assertEpoch(operationEpoch);
        await this.rememberSession();
      } catch (error) {
        candidateDek?.fill(0);
        if (error instanceof VaultSessionError && error.code === "VAULT_LOCKED") throw error;
        this.dek = null;
        this.expectedRoot = null;
        await this.recordFailure();
        this.assertEpoch(operationEpoch);
        throw new VaultSessionError("INVALID_CREDENTIALS");
      }
    } finally {
      keyEncryptionKey.fill(0);
    }
  }

  changePassword(
    currentChallengeId: string,
    currentKeyEncryptionKey: Uint8Array,
    newChallengeId: string,
    newKeyEncryptionKey: Uint8Array,
    sender: SenderBinding,
  ): Promise<MutationOutcome> {
    return this.credentialMutex.run(() =>
      this.mutationMutex.run(() =>
        this.changePasswordInternal(
          currentChallengeId,
          currentKeyEncryptionKey,
          newChallengeId,
          newKeyEncryptionKey,
          sender,
        ),
      ),
    );
  }

  private async changePasswordInternal(
    currentChallengeId: string,
    currentKeyEncryptionKey: Uint8Array,
    newChallengeId: string,
    newKeyEncryptionKey: Uint8Array,
    sender: SenderBinding,
  ): Promise<MutationOutcome> {
    const operationEpoch = this.epoch;
    let verifiedDek: Uint8Array | null = null;
    try {
      const current = this.consume(currentChallengeId, "change-current", sender);
      const next = this.consume(newChallengeId, "change-new", sender);
      this.assertEpoch(operationEpoch);
      await this.assertActiveRoot();
      this.assertEpoch(operationEpoch);
      const root = await this.readRoot();
      this.assertEpoch(operationEpoch);
      if (
        this.dek === null ||
        root === null ||
        current.rootBinding !== canonicalJson(root) ||
        next.rootBinding !== canonicalJson(root)
      ) {
        await this.recordFailure();
        this.assertEpoch(operationEpoch);
        throw new VaultSessionError("INVALID_CREDENTIALS");
      }
      verifiedDek = await unwrapVaultDataKeyWithKeyEncryptionKey(
        currentKeyEncryptionKey,
        root.wrappedKey,
      );
      this.assertEpoch(operationEpoch);
      if (!equalBytes(verifiedDek, this.dek)) throw new Error("credential mismatch");
      verifiedDek.fill(0);
      verifiedDek = null;
      const replacement = await wrapVaultDataKeyWithKeyEncryptionKey(
        newKeyEncryptionKey,
        next.salt,
        DEFAULT_ARGON2ID_PARAMETERS,
        this.dek,
        this.dependencies.random,
      );
      this.assertEpoch(operationEpoch);
      const active = await this.generations.readActive({ dek: this.dek });
      this.assertEpoch(operationEpoch);
      if (active === null) throw new StorageError("STORAGE_CORRUPT");
      const context = this.context(this.dek);
      const retained = await this.generations.readRetained(context);
      this.assertEpoch(operationEpoch);
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
      const metadata = await Promise.all(
        active.metadata.map(async (entry) => ({
          name: entry.name,
          schemaVersion: entry.schemaVersion,
          plaintext: await this.generations.decryptMetadata(entry, context),
        })),
      );
      this.assertEpoch(operationEpoch);
      const staged = await this.generations.stage({
        expectedRoot: root,
        wrappedKey: replacement,
        records: active.records,
        journal: active.journal,
        receipts: active.receipts,
        metadata,
        retainedNonces,
        newEnvelopeNonces: new Set(),
        context,
      });
      this.assertEpoch(operationEpoch);
      const verified = await this.generations.verify(staged, context);
      this.assertEpoch(operationEpoch);
      const outcome = await this.commitRoot(verified, context, operationEpoch, this.dek);
      if (outcome.state === "locked") return outcome;
      await this.clearAttempts();
      this.assertEpoch(operationEpoch);
      return outcome;
    } catch (error) {
      verifiedDek?.fill(0);
      if (error instanceof VaultSessionError && error.code === "VAULT_LOCKED") throw error;
      // Inside the mutation mutex: lock in place rather than waiting on ourselves.
      if (error instanceof StorageError) this.lockWhileMutationHeld();
      else await this.recordFailure();
      throw new VaultSessionError(this.dek === null ? "VAULT_LOCKED" : "INVALID_CREDENTIALS");
    } finally {
      currentKeyEncryptionKey.fill(0);
      newKeyEncryptionKey.fill(0);
    }
  }

  lock(): Promise<void> {
    this.beginLock();
    return this.mutationMutex.run(() => {
      this.clearLockedState();
      return Promise.resolve();
    });
  }

  private beginLock(): void {
    this.epoch += 1;
    this.challenges.clear();
    for (const callback of [...this.lockCallbacks]) {
      try {
        callback();
      } catch {
        // Lock must continue even when cleanup callbacks fail.
      }
    }
  }

  private lockWhileMutationHeld(): void {
    this.beginLock();
    this.clearLockedState();
  }

  onLockOrDispose(callback: () => void): () => void {
    this.lockCallbacks.add(callback);
    return () => this.lockCallbacks.delete(callback);
  }

  async sealMigrationTransaction(
    transactionId: string,
    plaintext: Uint8Array,
  ): Promise<MigrationTransactionEnvelope> {
    const operationEpoch = this.epoch;
    await this.assertActiveRoot();
    if (
      this.dek === null ||
      !isUuid(transactionId) ||
      !(plaintext instanceof Uint8Array) ||
      plaintext.byteLength > MAX_MIGRATION_TRANSACTION_BYTES
    )
      throw new VaultSessionError("VAULT_UNAVAILABLE");
    const envelope = await encryptEnvelope(
      this.dek,
      plaintext,
      migrationTransactionAad(transactionId),
      this.dependencies.random,
    );
    this.assertEpoch(operationEpoch);
    await this.assertActiveRoot();
    return Object.freeze({
      format: MIGRATION_TRANSACTION_FORMAT,
      version: MIGRATION_TRANSACTION_VERSION,
      transactionId,
      nonce: encodeBase64(envelope.nonce),
      ciphertext: encodeBase64(envelope.ciphertext),
    });
  }

  async openMigrationTransaction(
    candidate: unknown,
  ): Promise<{ transactionId: string; plaintext: Uint8Array }> {
    const operationEpoch = this.epoch;
    await this.assertActiveRoot();
    if (this.dek === null || !isMigrationTransactionEnvelope(candidate))
      throw new VaultSessionError("VAULT_UNAVAILABLE");
    try {
      const plaintext = await decryptEnvelope(
        this.dek,
        { nonce: decodeBase64(candidate.nonce), ciphertext: decodeBase64(candidate.ciphertext) },
        migrationTransactionAad(candidate.transactionId),
      );
      if (plaintext.byteLength > MAX_MIGRATION_TRANSACTION_BYTES)
        throw new Error("migration transaction too large");
      this.assertEpoch(operationEpoch);
      await this.assertActiveRoot();
      return { transactionId: candidate.transactionId, plaintext };
    } catch (error) {
      if (error instanceof VaultSessionError) throw error;
      throw new VaultSessionError("VAULT_UNAVAILABLE");
    }
  }

  async beginMigration(): Promise<MigrationCapability> {
    await this.assertActiveRoot();
    if (this.dek === null || this.expectedRoot === null)
      throw new VaultSessionError("VAULT_LOCKED");
    const capability: MigrationCapability = Object.freeze({
      epoch: this.epoch,
      activeGenerationId: this.expectedRoot.activeGenerationId,
    });
    this.migrationCapabilities.set(capability, { epoch: this.epoch, root: this.expectedRoot });
    return capability;
  }

  async assertMigrationCapability(capability: MigrationCapability): Promise<void> {
    await this.assertActiveRoot();
    this.requireMigrationCapability(capability);
  }

  assertMigrationCapabilityCurrent(capability: MigrationCapability): void {
    this.requireMigrationCapability(capability);
  }

  reserveMigrationGeneration(capability: MigrationCapability): string {
    this.requireMigrationCapability(capability);
    const generationId = this.dependencies.nextId();
    this.stagingGenerationIds.add(generationId);
    return generationId;
  }

  async stageMigration(
    capability: MigrationCapability,
    input: MigrationStageInput,
  ): Promise<MigrationStageReference> {
    const binding = this.requireMigrationCapability(capability);
    if (this.dek === null) throw new VaultSessionError("VAULT_LOCKED");
    const context = this.stagingContext(this.dek);
    if (input.generationId !== undefined) this.stagingGenerationIds.add(input.generationId);
    const records = await Promise.all(
      input.items.map((item) => encryptVaultRecord(OtpItemSchema.parse(item), context)),
    );
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
    const staged = await this.generations.stage({
      ...(input.generationId === undefined ? {} : { generationId: input.generationId }),
      expectedRoot: binding.root,
      wrappedKey: binding.root.wrappedKey,
      records,
      journal: [],
      metadata: input.metadata,
      retainedNonces,
      context,
    });
    const verified = await this.generations.verify(staged, context);
    this.requireMigrationCapability(capability);
    const reference: MigrationStageReference = Object.freeze({ generationId: staged.generationId });
    this.migrationStages.set(reference, { capability, verified });
    return reference;
  }

  async resumeMigration(
    capability: MigrationCapability,
    generationId: string,
  ): Promise<MigrationStageReference> {
    const binding = this.requireMigrationCapability(capability);
    if (this.dek === null) throw new VaultSessionError("VAULT_LOCKED");
    this.stagingGenerationIds.add(generationId);
    const verified = await this.generations.reconstructVerified(
      binding.root,
      generationId,
      this.context(this.dek),
    );
    this.requireMigrationCapability(capability);
    const reference: MigrationStageReference = Object.freeze({ generationId });
    this.migrationStages.set(reference, { capability, verified });
    return reference;
  }

  async readMigration(reference: MigrationStageReference): Promise<MigrationReadResult> {
    const stage = this.requireMigrationStage(reference);
    if (this.dek === null) throw new VaultSessionError("VAULT_LOCKED");
    const contents = await this.generations.readStaged(stage.verified, { dek: this.dek });
    return {
      items: (
        await Promise.all(contents.records.map((record) => decryptVaultRecord(record, this.dek!)))
      ).filter((item): item is OtpItem => item.kind === "otp"),
      metadata: await Promise.all(
        contents.metadata.map(async (metadata) => ({
          name: metadata.name,
          schemaVersion: metadata.schemaVersion,
          plaintext: await this.generations.decryptMetadata(metadata, { dek: this.dek! }),
        })),
      ),
    };
  }

  async readActiveMigration(): Promise<MigrationReadResult & { generationId: string }> {
    await this.assertActiveRoot();
    if (this.dek === null) throw new VaultSessionError("VAULT_LOCKED");
    const contents = await this.generations.readActive({ dek: this.dek });
    if (contents === null) throw new VaultSessionError("VAULT_UNAVAILABLE");
    return {
      generationId: contents.root.activeGenerationId,
      items: (
        await Promise.all(contents.records.map((record) => decryptVaultRecord(record, this.dek!)))
      ).filter((item): item is OtpItem => item.kind === "otp"),
      metadata: await Promise.all(
        contents.metadata.map(async (metadata) => ({
          name: metadata.name,
          schemaVersion: metadata.schemaVersion,
          plaintext: await this.generations.decryptMetadata(metadata, { dek: this.dek! }),
        })),
      ),
    };
  }

  async isActiveMigrationGeneration(generationId: string): Promise<boolean> {
    await this.assertActiveRoot();
    return this.expectedRoot?.activeGenerationId === generationId;
  }

  commitMigration(reference: MigrationStageReference): Promise<MutationOutcome> {
    return this.mutationMutex.run(async () => {
      const stage = this.requireMigrationStage(reference);
      const binding = this.requireMigrationCapability(stage.capability);
      if (this.dek === null) throw new VaultSessionError("VAULT_LOCKED");
      await this.generations.readStaged(stage.verified, { dek: this.dek });
      return this.commitRoot(stage.verified, this.context(this.dek), binding.epoch, this.dek);
    });
  }

  private requireMigrationStage(reference: MigrationStageReference) {
    const stage = this.migrationStages.get(reference);
    if (stage === undefined) throw new VaultSessionError("VAULT_LOCKED");
    this.requireMigrationCapability(stage.capability);
    return stage;
  }

  private requireMigrationCapability(capability: MigrationCapability): {
    epoch: number;
    root: VaultRoot;
  } {
    const binding = this.migrationCapabilities.get(capability);
    if (
      binding === undefined ||
      this.dek === null ||
      this.expectedRoot === null ||
      binding.epoch !== this.epoch ||
      canonicalJson(binding.root) !== canonicalJson(this.expectedRoot)
    )
      throw new VaultSessionError("VAULT_LOCKED");
    return binding;
  }

  private repositoryListItems(): Promise<readonly OtpItem[]> {
    return this.#runRepositoryOperation(async (repository, context) => {
      const candidates = await repository.listItems(context);
      // Excludes (rather than asserts on) any record that is not a valid, live OTP
      // item: since Task 7 every other item kind lives in the same vault, so a
      // login/note/card/identity/secret record here is expected, not corruption.
      // OtpService.list() applies this same "skip on parse failure" policy itself;
      // this mirrors that policy so a mixed-kind vault never fails the OTP-only view.
      const items: OtpItem[] = [];
      for (const candidate of candidates) {
        const parsed = OtpItemSchema.safeParse(candidate);
        if (!parsed.success || parsed.data.deletedAt !== undefined) continue;
        items.push(freezeOtpItem(parsed.data));
      }
      return Object.freeze(items);
    });
  }

  /**
   * Lists every vault item of every kind. Unlike {@link repositoryListItems} (the
   * OTP-only view backing `otp.list`), a non-OTP item does not fail this snapshot:
   * once other item kinds exist in the same vault, asserting OTP-only shape here
   * would break every OTP consumer as soon as one login/note/card/identity/secret
   * item is created.
   */
  private repositoryListAllItems(): Promise<readonly VaultItem[]> {
    return this.#runRepositoryOperation(async (repository, context) => {
      const candidates = await repository.listItems(context);
      const items: VaultItem[] = [];
      for (const candidate of candidates) {
        const parsed = VaultItemSchema.safeParse(candidate);
        if (!parsed.success || parsed.data.deletedAt !== undefined) continue;
        items.push(freezeVaultItem(parsed.data));
      }
      return Object.freeze(items);
    });
  }

  private repositoryGetItem(itemId: string): Promise<VaultItem | null> {
    return this.#runRepositoryOperation(async (repository, context) => {
      const candidate = await repository.get(itemId, context);
      if (candidate === null) return null;
      const parsed = VaultItemSchema.safeParse(candidate);
      return parsed.success && parsed.data.deletedAt === undefined ? parsed.data : null;
    });
  }

  private repositoryCreateItem(candidate: VaultItem): Promise<VaultItem> {
    return this.#runRepositoryOperation((repository, context) =>
      repository.create(candidate, context),
    );
  }

  private repositoryCreateItems(
    candidates: readonly VaultItem[],
  ): Promise<readonly CreateManyOutcome[]> {
    return this.#runRepositoryOperation((repository, context) =>
      repository.createMany(candidates, context),
    );
  }

  private repositoryUpdateItem(candidate: VaultItem, expectedRevision: number): Promise<VaultItem> {
    return this.#runRepositoryOperation((repository, context) =>
      repository.update(candidate, expectedRevision, () => candidate, context),
    );
  }

  private repositoryListMetadata(): Promise<readonly VaultItemMetadata[]> {
    return this.#runRepositoryOperation((repository, context) => repository.listMetadata(context));
  }

  private repositoryGet(itemId: string): Promise<OtpItem | null> {
    return this.#runRepositoryOperation(async (repository, context) => {
      const item = await repository.get(itemId, context);
      return item !== null && item.kind === "otp" ? item : null;
    });
  }

  private repositoryCreate(candidate: OtpItem): Promise<OtpItem> {
    return this.#runRepositoryOperation(async (repository, context) => {
      const created = await repository.create(candidate, context);
      if (created.kind !== "otp") throw new StorageError("VAULT_INVALID");
      return created;
    });
  }

  private repositoryUpdate(candidate: OtpItem, expectedRevision: number): Promise<OtpItem> {
    return this.#runRepositoryOperation(async (repository, context) => {
      const updated = await repository.update(
        candidate,
        expectedRevision,
        () => candidate,
        context,
      );
      if (updated.kind !== "otp") throw new StorageError("VAULT_INVALID");
      return updated;
    });
  }

  private repositoryTombstone(itemId: string, expectedRevision: number): Promise<TombstoneResult> {
    return this.#runRepositoryOperation((repository, context) =>
      repository.tombstone(itemId, expectedRevision, context),
    );
  }

  private readOtpItemsAndMetadata(
    name: GenerationMetadataName,
  ): Promise<
    Readonly<{ sessionEpoch: number; items: readonly OtpItem[]; metadata: Uint8Array | null }>
  > {
    return this.#runRepositoryOperation(async (repository, context) => ({
      sessionEpoch: this.repositoryRevision,
      items: (await repository.listItems(context))
        .filter((item): item is OtpItem => item.kind === "otp")
        .map((item) => freezeOtpItem(item)),
      metadata: await repository.readGenerationMetadata(name, context),
    }));
  }

  private removeOtpMetadataIfEpoch(
    expectedSessionEpoch: number,
    candidates: readonly OtpItem[],
    name: GenerationMetadataName,
  ): Promise<"activated" | "root-changed"> {
    const owned = candidates.map(copyOtpItem);
    if (expectedSessionEpoch !== this.repositoryRevision) {
      owned.splice(0);
      return Promise.resolve("root-changed");
    }
    return this.#runRepositoryOperation((repository, context) => {
      if (expectedSessionEpoch !== this.repositoryRevision)
        return Promise.resolve("root-changed" as const);
      return repository.removeOtpMetadata(owned, name, context).then(() => "activated" as const);
    }).finally(() => owned.splice(0));
  }

  private replaceOtpItemsAndMetadataIfEpoch(
    expectedSessionEpoch: number,
    candidates: readonly OtpItem[],
    metadata: Readonly<{ name: GenerationMetadataName; schemaVersion: 1; plaintext: Uint8Array }>,
  ): Promise<"activated" | "root-changed"> {
    const owned = candidates.map(copyOtpItem);
    const ownedMetadata = { ...metadata, plaintext: metadata.plaintext.slice() };
    if (expectedSessionEpoch !== this.repositoryRevision) {
      owned.splice(0);
      ownedMetadata.plaintext.fill(0);
      return Promise.resolve("root-changed");
    }
    return this.#runRepositoryOperation((repository, context) => {
      if (expectedSessionEpoch !== this.repositoryRevision)
        return Promise.resolve("root-changed" as const);
      return repository
        .replaceOtpItemsAndMetadata(owned, ownedMetadata, context)
        .then(() => "activated" as const);
    }).finally(() => {
      owned.splice(0);
      ownedMetadata.plaintext.fill(0);
    });
  }

  #runRepositoryOperation<T>(
    operation: (repository: VaultRepository, context: VaultCryptoContext) => Promise<T>,
  ): Promise<T> {
    const operationEpoch = this.epoch;
    const observationStart = this.rootObservationSequence;
    return this.mutationMutex.run(() =>
      this.#runRepositoryOperationWhileMutationHeld(operation, operationEpoch, observationStart),
    );
  }

  async #runRepositoryOperationWhileMutationHeld<T>(
    operation: (repository: VaultRepository, context: VaultCryptoContext) => Promise<T>,
    operationEpoch: number,
    observationStart: number,
  ): Promise<T> {
    await this.assertActiveRootWhileMutationHeld(operationEpoch);
    if (this.dek === null || this.expectedRoot === null)
      throw new VaultSessionError("VAULT_LOCKED");
    const operationDek = this.dek.slice();
    const context = this.context(operationDek);
    const repository = new VaultRepository(
      this.dependencies.local,
      this.expectedRoot.wrappedKey,
      undefined,
      {
        beforeActivate: (candidate) => {
          this.assertEpoch(operationEpoch);
          this.commitCandidate = canonicalJson(candidate);
          return Promise.resolve();
        },
        afterActivate: async (activated) => {
          await this.acceptRepositoryActivation(activated, context, operationEpoch);
        },
        activationFailed: async (candidate) => {
          await this.reconcileRepositoryActivationFailure(candidate, context, operationEpoch);
        },
      },
    );
    try {
      const result = await operation(repository, context);
      this.assertEpoch(operationEpoch);
      this.assertNoCrossedRootObservation(observationStart);
      // The operation authenticated everything it loaded and, if it activated, the
      // activation re-authenticated the new generation; what is left to prove is that the
      // root is still the one this session is bound to.
      await this.assertActiveRootUnchangedWhileMutationHeld(operationEpoch);
      this.assertNoCrossedRootObservation(observationStart);
      return result;
    } catch (error) {
      // Whatever went wrong, the next request re-authenticates from storage.
      this.authenticatedActive = null;
      if (error instanceof VaultSessionError) {
        if (this.hasCrossedRootObservation(observationStart) && this.dek !== null)
          this.lockWhileMutationHeld();
        throw error;
      }
      if (
        this.epoch !== operationEpoch ||
        this.dek === null ||
        this.hasCrossedRootObservation(observationStart)
      ) {
        if (this.dek !== null) this.lockWhileMutationHeld();
        throw new VaultSessionError("VAULT_LOCKED");
      }
      throw error;
    } finally {
      operationDek.fill(0);
    }
  }

  private async acceptRepositoryActivation(
    activated: VaultRoot,
    context: VaultCryptoContext,
    operationEpoch: number,
  ): Promise<void> {
    const candidate = canonicalJson(activated);
    try {
      this.assertEpoch(operationEpoch);
      const active = await this.generations.readActive(context);
      this.assertEpoch(operationEpoch);
      if (active === null || canonicalJson(active.root) !== candidate)
        throw new StorageError("EXTERNAL_ROOT_CHANGED");
      this.expectedRoot = activated;
      this.repositoryRevision += 1;
      this.rememberAuthenticatedActive(active);
      this.rebindBackupAuthorities(activated);
      this.commitCandidate = null;
      await this.rememberSession();
    } catch {
      this.lockWhileMutationHeld();
      throw new VaultSessionError("VAULT_LOCKED");
    }
  }

  private async reconcileRepositoryActivationFailure(
    candidate: VaultRoot,
    context: VaultCryptoContext,
    operationEpoch: number,
  ): Promise<void> {
    const canonicalCandidate = canonicalJson(candidate);
    try {
      this.assertEpoch(operationEpoch);
      const active = await this.generations.readActive(context);
      this.assertEpoch(operationEpoch);
      if (active !== null && canonicalJson(active.root) === canonicalCandidate) {
        this.expectedRoot = active.root;
        await this.rememberSession();
      }
    } catch {
      // Any uncertainty is handled by fail-closed locking below.
    } finally {
      if (this.commitCandidate === canonicalCandidate) this.commitCandidate = null;
    }
    this.lockWhileMutationHeld();
  }

  private hasCrossedRootObservation(observationStart: number): boolean {
    return this.lastNonCandidateRootObservationSequence > observationStart;
  }

  private assertNoCrossedRootObservation(observationStart: number): void {
    if (!this.hasCrossedRootObservation(observationStart)) return;
    this.lockWhileMutationHeld();
    throw new VaultSessionError("VAULT_LOCKED");
  }

  private async assertActiveRootWhileMutationHeld(operationEpoch: number): Promise<void> {
    if (this.dek === null || this.expectedRoot === null)
      throw new VaultSessionError("VAULT_LOCKED");
    try {
      await this.authenticateExpectedRoot(this.dek, this.expectedRoot, operationEpoch);
    } catch (error) {
      if (error instanceof VaultSessionError && error.code === "VAULT_LOCKED") throw error;
      this.lockWhileMutationHeld();
      throw new VaultSessionError("VAULT_UNAVAILABLE");
    }
  }

  /** The post-operation check: the stored root is still the one this session is bound to. */
  private async assertActiveRootUnchangedWhileMutationHeld(operationEpoch: number): Promise<void> {
    if (this.dek === null || this.expectedRoot === null)
      throw new VaultSessionError("VAULT_LOCKED");
    try {
      const stored = await this.readStoredRootCanonical();
      this.assertEpoch(operationEpoch);
      if (stored !== canonicalJson(this.expectedRoot)) throw new Error("root changed");
    } catch (error) {
      if (error instanceof VaultSessionError && error.code === "VAULT_LOCKED") throw error;
      this.lockWhileMutationHeld();
      throw new VaultSessionError("VAULT_UNAVAILABLE");
    }
  }

  async assertActiveRoot(): Promise<void> {
    const operationEpoch = this.epoch;
    if (this.dek === null || this.expectedRoot === null)
      throw new VaultSessionError("VAULT_LOCKED");
    try {
      await this.authenticateExpectedRoot(this.dek, this.expectedRoot, operationEpoch);
    } catch (error) {
      if (error instanceof VaultSessionError && error.code === "VAULT_LOCKED") throw error;
      // Reached both from plain reads and from inside the mutation mutex; the in-place lock
      // is safe in both (in-flight mutations see the epoch change and fail closed).
      this.lockWhileMutationHeld();
      throw new VaultSessionError("VAULT_UNAVAILABLE");
    }
  }

  /**
   * Proves the active generation is the one this session is bound to and authenticates
   * under `dek`: either the cached authentication still applies (same key, epoch, revision,
   * and root, and the stored root re-read now is still that root), or the generation is read
   * and authenticated in full and the result cached. A stored root that no longer matches
   * the cache is not a verdict on its own: outside the mutation mutex a commit may have
   * moved the root and the session's binding together, so the slow path authenticates what
   * is in storage now and compares it against the binding as it stands after that read,
   * exactly as an uncached check always has. Throws on any mismatch.
   */
  private async authenticateExpectedRoot(
    dek: Uint8Array,
    expectedRoot: VaultRoot,
    operationEpoch: number,
  ): Promise<void> {
    const expected = canonicalJson(expectedRoot);
    const cached = this.authenticatedActive;
    if (
      cached !== null &&
      cached.epoch === this.epoch &&
      cached.revision === this.repositoryRevision &&
      cached.root === expected
    ) {
      const stored = await this.readStoredRootCanonical();
      this.assertEpoch(operationEpoch);
      if (stored === expected) return;
    }
    this.authenticatedActive = null;
    const active = await this.generations.readActive({ dek });
    this.assertEpoch(operationEpoch);
    if (
      active === null ||
      this.expectedRoot === null ||
      canonicalJson(active.root) !== canonicalJson(this.expectedRoot)
    )
      throw new Error("root changed");
    this.rememberAuthenticatedActive(active);
  }

  /** Caches `active` as authenticated, but only when it is the generation of the bound root. */
  private rememberAuthenticatedActive(active: GenerationContents | null): void {
    if (active === null || this.dek === null || this.expectedRoot === null) return;
    const root = canonicalJson(active.root);
    if (root !== canonicalJson(this.expectedRoot)) return;
    this.authenticatedActive = {
      epoch: this.epoch,
      revision: this.repositoryRevision,
      root,
      contents: active,
    };
  }

  /** The stored root as canonical JSON, null when absent; throws when it does not parse. */
  private async readStoredRootCanonical(): Promise<string | null> {
    const value = (await this.dependencies.local.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY];
    if (value === undefined) return null;
    return canonicalJson(VaultRootSchema.parse(value));
  }

  /**
   * Any change to vault storage that was not observed through {@link handleActiveRootChange}
   * (a record, journal, or manifest key) invalidates the cached authentication; the next
   * request re-authenticates from storage.
   */
  handleLocalStorageChange(changedKeys: readonly string[]): void {
    if (changedKeys.some((key) => key === ACTIVE_ROOT_KEY || key.startsWith(GENERATION_PREFIX)))
      this.authenticatedActive = null;
  }

  /**
   * Reclaims generations that were staged but never activated: at most a bounded number per
   * call, never the active generation or its direct predecessor, never one this instance is
   * still staging, and never one younger than {@link ORPHAN_GENERATION_GRACE_MS} that another
   * worker instance might still resume. Runs under the mutation mutex so no repository
   * staging interleaves with it. Returns the number of generations removed.
   */
  collectOrphans(): Promise<number> {
    const operationEpoch = this.epoch;
    return this.mutationMutex.run(async () => {
      if (this.dek === null || this.expectedRoot === null || this.epoch !== operationEpoch)
        return 0;
      const root = this.expectedRoot;
      const stored = await this.readStoredRootCanonical();
      if (stored !== canonicalJson(root) || this.epoch !== operationEpoch) return 0;
      return this.generations.collectOrphans(root, {
        exclude: this.stagingGenerationIds,
        olderThan: new Date(this.now() - ORPHAN_GENERATION_GRACE_MS).toISOString(),
      });
    });
  }

  /** Fires orphan collection once per worker instance, after the first successful unlock or restore. */
  private scheduleOrphanCollection(): void {
    if (this.orphanCollectionScheduled) return;
    this.orphanCollectionScheduled = true;
    void this.collectOrphans().catch(() => undefined);
  }

  handleActiveRootChange(value: unknown): Promise<void> {
    // Storage moved under the session; whatever was authenticated before is re-proven.
    this.authenticatedActive = null;
    const parsedObservation = VaultRootSchema.safeParse(value);
    const canonicalObservation = parsedObservation.success
      ? canonicalJson(parsedObservation.data)
      : null;
    const expected = this.expectedRoot === null ? null : canonicalJson(this.expectedRoot);
    this.rootObservationSequence += 1;
    if (
      canonicalObservation === null ||
      (canonicalObservation !== this.commitCandidate && canonicalObservation !== expected)
    )
      this.lastNonCandidateRootObservationSequence = this.rootObservationSequence;
    return this.mutationMutex.run(async () => {
      const parsed = VaultRootSchema.safeParse(value);
      if (parsed.success) {
        const canonical = canonicalJson(parsed.data);
        if (this.commitCandidate === canonical) {
          this.commitCandidate = null;
          return;
        }
        if (this.expectedRoot !== null && canonicalJson(this.expectedRoot) === canonical) return;
      }
      if (this.dek === null || this.expectedRoot === null) return;
      try {
        const active = await this.generations.readActive({ dek: this.dek });
        if (active !== null && canonicalJson(active.root) === canonicalJson(this.expectedRoot)) {
          this.rememberAuthenticatedActive(active);
          return;
        }
      } catch {
        // Current storage is not authenticated as the session root.
      }
      this.lockWhileMutationHeld();
    });
  }

  private clearLockedState(): void {
    this.dek?.fill(0);
    this.dek = null;
    this.expectedRoot = null;
    this.authenticatedActive = null;
    this.commitCandidate = null;
    this.backupAuthorities.clear();
    this.forgetSession();
  }

  /** Writes the unlocked key to session storage; best effort, the vault works without it. */
  private async rememberSession(): Promise<void> {
    if (this.dek === null || this.expectedRoot === null) return;
    try {
      await this.dependencies.session.set({
        [SESSION_KEY]: {
          version: 1,
          dek: bytesToBase64(this.dek),
          root: canonicalJson(this.expectedRoot),
        },
      });
    } catch {
      // The session simply will not survive a worker restart.
    }
  }

  private forgetSession(): void {
    void this.dependencies.session.remove([SESSION_KEY]).catch(() => undefined);
  }

  /**
   * Re-opens the session a previous service-worker instance left in session storage. The
   * key is accepted only for the exact root it was unlocked against and only if it still
   * decrypts the active generation; anything else is discarded and the vault stays locked.
   */
  async restoreSession(): Promise<"restored" | "locked"> {
    const outcome = await this.mutationMutex.run(async (): Promise<"restored" | "locked"> => {
      if (this.dek !== null) return "restored";
      let stored: unknown;
      try {
        stored = (await this.dependencies.session.get([SESSION_KEY]))[SESSION_KEY];
      } catch {
        return "locked";
      }
      if (stored === undefined) return "locked";
      const record = stored as { version?: unknown; dek?: unknown; root?: unknown };
      if (
        record.version !== 1 ||
        typeof record.dek !== "string" ||
        typeof record.root !== "string"
      ) {
        this.forgetSession();
        return "locked";
      }
      let dek: Uint8Array | null = null;
      try {
        dek = base64ToBytes(record.dek);
        if (dek.byteLength !== 32) throw new Error("wrong key length");
        const root = await this.readRoot();
        if (root === null || canonicalJson(root) !== record.root) throw new Error("root changed");
        const active = await this.generations.readActive({ dek });
        this.dek = dek;
        dek = null;
        this.expectedRoot = root;
        this.rememberAuthenticatedActive(active);
        return "restored";
      } catch {
        dek?.fill(0);
        this.forgetSession();
        return "locked";
      }
    });
    if (outcome === "restored") this.scheduleOrphanCollection();
    return outcome;
  }

  private rebindBackupAuthorities(root: VaultRoot): void {
    for (const [authority, binding] of this.backupAuthorities)
      if (binding.epoch === this.epoch)
        this.backupAuthorities.set(authority, { epoch: binding.epoch, root });
  }

  private async commitRoot(
    verified: Parameters<GenerationStore["activate"]>[0],
    context: VaultCryptoContext,
    operationEpoch: number,
    authenticationDek: Uint8Array,
  ): Promise<MutationOutcome> {
    const candidate = canonicalJson(verified.root);
    let wroteCandidate = false;
    this.commitCandidate = candidate;
    this.authenticatedActive = null;
    try {
      const activated = await this.generations.activate(verified, context, () =>
        this.assertEpoch(operationEpoch),
      );
      wroteCandidate = true;
      const actual = await this.generations.readActive({ dek: authenticationDek });
      if (actual === null || canonicalJson(actual.root) !== candidate)
        throw new StorageError("EXTERNAL_ROOT_CHANGED");
      if (this.epoch !== operationEpoch) {
        this.clearLockedState();
        return { committed: true, state: "locked" };
      }
      this.expectedRoot = activated;
      if (authenticationDek === this.dek) this.rememberAuthenticatedActive(actual);
      this.rebindBackupAuthorities(activated);
      // The root just moved on; the saved session must follow it, or the next worker restart
      // finds a stale binding and the vault shows up locked minutes after a save.
      await this.rememberSession();
      return { committed: true, state: "unlocked" };
    } catch {
      let exactTargetAuthenticated = false;
      try {
        const actual = await this.readRoot();
        if (actual !== null && canonicalJson(actual) === candidate) {
          const authenticated = await this.generations.readStaged(verified, {
            dek: authenticationDek,
          });
          exactTargetAuthenticated = canonicalJson(authenticated.root) === candidate;
        }
        if (
          actual !== null &&
          canonicalJson(actual) !== canonicalJson(verified.expectedRoot) &&
          !exactTargetAuthenticated
        )
          this.lockWhileMutationHeld();
      } catch {
        this.lockWhileMutationHeld();
        throw new VaultSessionError("VAULT_LOCKED");
      }
      if (exactTargetAuthenticated) {
        wroteCandidate = true;
        this.lockWhileMutationHeld();
        return { committed: true, state: "locked" };
      }
      if (this.dek !== null || this.expectedRoot !== null) this.lockWhileMutationHeld();
      throw new VaultSessionError("VAULT_LOCKED");
    } finally {
      if (!wroteCandidate && this.commitCandidate === candidate) this.commitCandidate = null;
      if (!wroteCandidate && this.epoch !== operationEpoch) this.expectedRoot = null;
    }
  }

  private context(dek: Uint8Array): VaultCryptoContext {
    const clock: Clock = { now: () => this.dependencies.isoNow() };
    const ids: IdSource = { next: () => this.dependencies.nextId() };
    return { dek, random: this.dependencies.random, clock, ids };
  }

  /** A context whose generation ids are registered as in-flight before they are written. */
  private stagingContext(dek: Uint8Array): VaultCryptoContext {
    const context = this.context(dek);
    return {
      ...context,
      ids: {
        next: () => {
          const generationId = context.ids.next();
          this.stagingGenerationIds.add(generationId);
          return generationId;
        },
      },
    };
  }

  private consume(id: string, purpose: ChallengePurpose, sender: SenderBinding): Challenge {
    const challenge = this.challenges.get(id);
    this.challenges.delete(id);
    if (
      challenge === undefined ||
      challenge.purpose !== purpose ||
      canonicalJson(challenge.senderBinding) !== canonicalJson(sender) ||
      challenge.expiresAt < this.now()
    )
      throw new VaultSessionError("CHALLENGE_INVALID");
    return challenge;
  }

  private assertEpoch(epoch: number): void {
    if (epoch !== this.epoch) throw new VaultSessionError("VAULT_LOCKED");
  }

  private async readRoot(): Promise<VaultRoot | null> {
    const value = (await this.dependencies.local.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY];
    if (value === undefined) return null;
    const parsed = VaultRootSchema.safeParse(value);
    if (!parsed.success) {
      // Called from inside mutation-held paths (setup, unlock, change password, commit), so
      // this must not queue behind the mutex it is already inside: that deadlocked the worker.
      this.lockWhileMutationHeld();
      throw new VaultSessionError("VAULT_UNAVAILABLE");
    }
    return parsed.data;
  }

  private now(): number {
    const value = this.dependencies.now();
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  private async retryAfter(): Promise<number> {
    const value = (await this.dependencies.session.get([ATTEMPTS_KEY]))[ATTEMPTS_KEY];
    const now = this.now();
    if (value === undefined) return 0;
    if (!isAttemptState(value) || now < value.observedAt) {
      const conservative = conservativeAttempt(now);
      await this.dependencies.session.set({ [ATTEMPTS_KEY]: conservative });
      return BASE_COOLDOWN_MS;
    }
    return Math.min(MAX_COOLDOWN_MS, Math.max(0, value.deadline - now));
  }

  private async recordFailure(): Promise<void> {
    const value = (await this.dependencies.session.get([ATTEMPTS_KEY]))[ATTEMPTS_KEY];
    const now = this.now();
    const previous: AttemptState =
      value === undefined
        ? { version: 1, failures: 0, deadline: 0, observedAt: now }
        : isAttemptState(value) && now >= value.observedAt
          ? value
          : conservativeAttempt(now);
    const failures = Math.min(MAX_FAILURES, previous.failures + 1);
    const level = Math.min(52, Math.max(0, failures - FAILURE_THRESHOLD));
    const cooldown =
      failures < FAILURE_THRESHOLD ? 0 : Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * 2 ** level);
    const state: AttemptState = {
      version: ATTEMPT_VERSION,
      failures,
      deadline: cooldown === 0 ? 0 : safeAdd(now, cooldown),
      observedAt: now,
    };
    await this.dependencies.session.set({ [ATTEMPTS_KEY]: state });
  }

  private async clearAttempts(): Promise<void> {
    await this.dependencies.session.remove([ATTEMPTS_KEY]);
  }
}

function conservativeAttempt(now: number): AttemptState {
  return {
    version: ATTEMPT_VERSION,
    failures: FAILURE_THRESHOLD,
    deadline: safeAdd(now, BASE_COOLDOWN_MS),
    observedAt: now,
  };
}
function safeAdd(left: number, right: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}
function isAttemptState(value: unknown): value is AttemptState {
  if (typeof value !== "object" || value === null || Object.keys(value).length !== 4) return false;
  const candidate = value as Partial<AttemptState>;
  return (
    candidate.version === ATTEMPT_VERSION &&
    Number.isSafeInteger(candidate.failures) &&
    candidate.failures! >= 0 &&
    candidate.failures! <= MAX_FAILURES &&
    Number.isSafeInteger(candidate.deadline) &&
    candidate.deadline! >= 0 &&
    Number.isSafeInteger(candidate.observedAt) &&
    candidate.observedAt! >= 0
  );
}
function migrationTransactionAad(transactionId: string) {
  return {
    format: MIGRATION_TRANSACTION_FORMAT,
    formatVersion: MIGRATION_TRANSACTION_VERSION,
    itemId: transactionId,
    kind: "migration-transaction",
    schemaVersion: 1,
    revision: 1,
  } as const;
}
function isMigrationTransactionEnvelope(value: unknown): value is MigrationTransactionEnvelope {
  if (typeof value !== "object" || value === null || Object.keys(value).length !== 5) return false;
  const candidate = value as Partial<MigrationTransactionEnvelope>;
  if (typeof candidate.nonce !== "string" || typeof candidate.ciphertext !== "string") return false;
  const nonce = validateCanonicalBase64(candidate.nonce, XCHACHA_NONCE_BYTES);
  const ciphertext = validateCanonicalBase64(
    candidate.ciphertext,
    MAX_MIGRATION_TRANSACTION_BYTES + AEAD_TAG_BYTES,
  );
  return (
    candidate.format === MIGRATION_TRANSACTION_FORMAT &&
    candidate.version === MIGRATION_TRANSACTION_VERSION &&
    typeof candidate.transactionId === "string" &&
    isUuid(candidate.transactionId) &&
    nonce.valid &&
    nonce.decodedLength === XCHACHA_NONCE_BYTES &&
    ciphertext.valid &&
    ciphertext.decodedLength >= AEAD_TAG_BYTES
  );
}
function normalizePortableAutoLockMinutes(value: number): 0 | 5 | 15 | 30 | 60 {
  if (value === 0 || value === 5 || value === 15 || value === 30 || value === 60) return value;
  throw new VaultSessionError("VAULT_UNAVAILABLE");
}

function isPortableOtpImportStatus(value: string): value is PortableOtpImportStatus {
  return value === "accepted" || value === "duplicate" || value === "conflict";
}

function summarizePortablePreview(
  preview: Readonly<{
    statuses: readonly PortableOtpImportStatus[];
    settings: "unchanged" | "replace";
    history: Readonly<{ journalAdded: number; tombstonesAdded: number }>;
    byKind: PortableItemKindCounts;
    folders: PortableFolderOutcome;
  }>,
) {
  return Object.freeze({
    ...summarizePortableStatuses(preview.statuses),
    settings: preview.settings,
    history: Object.freeze({ ...preview.history }),
    byKind: Object.freeze({ ...preview.byKind }),
    folders: Object.freeze({ ...preview.folders }),
  });
}

function summarizePortableStatuses(statuses: readonly PortableOtpImportStatus[]) {
  const rows = statuses.map((status, index) => ({
    ordinal: index + 1,
    status,
    reason:
      status === "accepted"
        ? ("BACKUP_IMPORT_ACCEPTED" as const)
        : status === "duplicate"
          ? ("BACKUP_IMPORT_DUPLICATE" as const)
          : ("BACKUP_IMPORT_CONFLICT" as const),
  }));
  return Object.freeze({
    rows: Object.freeze(rows),
    statuses: Object.freeze([...statuses]),
    accepted: statuses.filter((status) => status === "accepted").length,
    duplicate: statuses.filter((status) => status === "duplicate").length,
    conflict: statuses.filter((status) => status === "conflict").length,
    rejected: 0,
  });
}

function copyOtpItem(candidate: OtpItem): OtpItem {
  return OtpItemSchema.parse({ ...candidate, tags: [...candidate.tags] });
}

/** A fresh object graph the caller cannot reach into afterwards. */
function copyVaultItem(candidate: VaultItem): VaultItem {
  return VaultItemSchema.parse(candidate);
}

function copyImportCandidate(candidate: OtpImportCandidate) {
  return Object.freeze({
    issuer: candidate.issuer,
    label: candidate.label,
    secret: candidate.secret,
    otpType: candidate.otpType,
    algorithm: candidate.algorithm,
    digits: candidate.digits,
    period: candidate.period,
    ...(candidate.counter === undefined ? {} : { counter: candidate.counter }),
    favorite: candidate.favorite,
    tags: Object.freeze([...candidate.tags]),
    note: candidate.note,
  });
}
function freezeOtpItem(item: OtpItem): OtpItem {
  return Object.freeze({ ...item, tags: Object.freeze([...item.tags]) }) as OtpItem;
}
function freezeVaultItem(item: VaultItem): VaultItem {
  return Object.freeze({ ...item, tags: Object.freeze([...item.tags]) }) as VaultItem;
}
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
function encodeBase64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}
function decodeBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value))
    throw new RangeError("Invalid base64.");
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
function hex(value: Uint8Array): string {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index++) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

export type { VaultLockSettings };

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
