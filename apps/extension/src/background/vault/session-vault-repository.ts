import type { OtpItem, VaultItem, Folder } from "@shardpass/domain";
import type {
  CreateManyOutcome,
  GenerationMetadataName,
  HotpReservationCommitResult,
  PendingHotpReservation,
  ImportOtpItemsResult,
  ImportPortableOtpItemsResult,
  ImportPortableStateResult,
  OtpImportCandidate,
  PortableImportDescriptor,
  PortableImportPreview,
  PortableOtpImportStatus,
  PortableVaultState,
  TombstoneResult,
  VaultItemMetadata,
} from "@shardpass/storage";

export interface EnteSessionVaultRepository {
  readGenerationMetadata(name: GenerationMetadataName): Promise<Uint8Array | null>;
  readOtpItemsAndMetadata(
    name: GenerationMetadataName,
  ): Promise<
    Readonly<{ sessionEpoch: number; items: readonly OtpItem[]; metadata: Uint8Array | null }>
  >;
  replaceOtpItemsAndMetadata(
    candidates: readonly OtpItem[],
    metadata: Readonly<{ name: GenerationMetadataName; schemaVersion: 1; plaintext: Uint8Array }>,
  ): Promise<void>;
  replaceOtpItemsAndMetadataIfEpoch(
    expectedSessionEpoch: number,
    candidates: readonly OtpItem[],
    metadata: Readonly<{ name: GenerationMetadataName; schemaVersion: 1; plaintext: Uint8Array }>,
  ): Promise<"activated" | "root-changed">;
  removeOtpMetadataIfEpoch(
    expectedSessionEpoch: number,
    candidates: readonly OtpItem[],
    name: GenerationMetadataName,
  ): Promise<"activated" | "root-changed">;
}

export interface SessionVaultRepository {
  /** SessionService always supplies this narrow Ente bridge; legacy test doubles may omit it. */
  readGenerationMetadata?: EnteSessionVaultRepository["readGenerationMetadata"];
  readOtpItemsAndMetadata?: EnteSessionVaultRepository["readOtpItemsAndMetadata"];
  replaceOtpItemsAndMetadata?: EnteSessionVaultRepository["replaceOtpItemsAndMetadata"];
  replaceOtpItemsAndMetadataIfEpoch?: EnteSessionVaultRepository["replaceOtpItemsAndMetadataIfEpoch"];
  removeOtpMetadataIfEpoch?: EnteSessionVaultRepository["removeOtpMetadataIfEpoch"];
  listItems(): Promise<readonly OtpItem[]>;
  /**
   * Lists every vault item of every kind, undecoded to the OTP-only view. Used by the
   * generic item CRUD surface (Task 7); unlike {@link listItems}, this never throws on
   * a non-OTP item, since mixed-kind vaults are the norm once other item kinds exist.
   */
  listAllItems(): Promise<readonly VaultItem[]>;
  /** Generic item lookup by id, any kind. Returns null for a missing or tombstoned item. */
  getItem(itemId: string): Promise<VaultItem | null>;
  /** Generic item creation, any kind. */
  createItem(candidate: VaultItem): Promise<VaultItem>;
  /** Batch creation under one commit; see VaultRepository.createMany. */
  createItems(candidates: readonly VaultItem[]): Promise<readonly CreateManyOutcome[]>;
  /** Vault-wide folder metadata (names, nesting). Encrypted alongside everything else. */
  readFolders(): Promise<readonly Folder[]>;
  replaceFolders(folders: readonly Folder[]): Promise<void>;
  /** Generic item update, any kind. The repository re-derives id/kind/schemaVersion/revision/timestamps. */
  updateItem(candidate: VaultItem, expectedRevision: number): Promise<VaultItem>;
  readPortableState(): Promise<PortableVaultState>;
  previewPortableImport(
    candidates: readonly VaultItem[],
    descriptor: PortableImportDescriptor,
  ): Promise<PortableImportPreview>;
  importPortableState(
    candidates: readonly VaultItem[],
    descriptor: PortableImportDescriptor,
    expected: PortableImportPreview,
  ): Promise<ImportPortableStateResult>;
  previewPortableOtpItems(
    candidates: readonly OtpItem[],
  ): Promise<Readonly<{ statuses: readonly PortableOtpImportStatus[] }>>;
  importPortableOtpItems(
    candidates: readonly OtpItem[],
    expectedStatuses: readonly PortableOtpImportStatus[],
  ): Promise<ImportPortableOtpItemsResult>;
  listMetadata(): Promise<readonly VaultItemMetadata[]>;
  get(itemId: string): Promise<OtpItem | null>;
  create(candidate: OtpItem): Promise<OtpItem>;
  importOtpBatch(
    candidates: readonly OtpImportCandidate[],
    expectedStatuses: readonly ("accepted" | "duplicate")[],
    observeOwnedCandidates?: (candidates: readonly OtpImportCandidate[]) => void,
  ): Promise<ImportOtpItemsResult>;
  update(candidate: OtpItem, expectedRevision: number): Promise<OtpItem>;
  tombstone(itemId: string, expectedRevision: number): Promise<TombstoneResult>;
  commitHotpReservation(
    reservationId: string,
    binding: PendingHotpReservation["binding"],
  ): Promise<HotpReservationCommitResult>;
  cancelHotpReservation(
    reservationId: string,
    binding: PendingHotpReservation["binding"],
  ): Promise<boolean>;
  savePendingHotpReservation(
    candidate: Omit<PendingHotpReservation, "sessionEpoch">,
  ): Promise<void>;
  /**
   * Persists the current item schema version onto every stored record still
   * declaring a legacy one. Returns the number of records rewritten; a no-op
   * (returns 0, commits nothing) once every record is already current. Safe to
   * call on every unlock — see {@link VaultRepository.migrateLegacyItemSchema}.
   */
  migrateLegacySchema(): Promise<number>;
}

type SessionVaultRepositoryOperations = Readonly<{
  listItems(): Promise<readonly OtpItem[]>;
  listAllItems(): Promise<readonly VaultItem[]>;
  getItem(itemId: string): Promise<VaultItem | null>;
  createItem(candidate: VaultItem): Promise<VaultItem>;
  createItems(candidates: readonly VaultItem[]): Promise<readonly CreateManyOutcome[]>;
  readFolders(): Promise<readonly Folder[]>;
  replaceFolders(folders: readonly Folder[]): Promise<void>;
  updateItem(candidate: VaultItem, expectedRevision: number): Promise<VaultItem>;
  readGenerationMetadata(name: GenerationMetadataName): Promise<Uint8Array | null>;
  readOtpItemsAndMetadata(
    name: GenerationMetadataName,
  ): Promise<
    Readonly<{ sessionEpoch: number; items: readonly OtpItem[]; metadata: Uint8Array | null }>
  >;
  replaceOtpItemsAndMetadata(
    candidates: readonly OtpItem[],
    metadata: Readonly<{ name: GenerationMetadataName; schemaVersion: 1; plaintext: Uint8Array }>,
  ): Promise<void>;
  replaceOtpItemsAndMetadataIfEpoch(
    expectedSessionEpoch: number,
    candidates: readonly OtpItem[],
    metadata: Readonly<{ name: GenerationMetadataName; schemaVersion: 1; plaintext: Uint8Array }>,
  ): Promise<"activated" | "root-changed">;
  removeOtpMetadataIfEpoch(
    expectedSessionEpoch: number,
    candidates: readonly OtpItem[],
    name: GenerationMetadataName,
  ): Promise<"activated" | "root-changed">;
  readPortableState(): Promise<PortableVaultState>;
  previewPortableImport(
    candidates: readonly VaultItem[],
    descriptor: PortableImportDescriptor,
  ): Promise<PortableImportPreview>;
  importPortableState(
    candidates: readonly VaultItem[],
    descriptor: PortableImportDescriptor,
    expected: PortableImportPreview,
  ): Promise<ImportPortableStateResult>;
  previewPortableOtpItems(
    candidates: readonly OtpItem[],
  ): Promise<Readonly<{ statuses: readonly PortableOtpImportStatus[] }>>;
  importPortableOtpItems(
    candidates: readonly OtpItem[],
    expectedStatuses: readonly PortableOtpImportStatus[],
  ): Promise<ImportPortableOtpItemsResult>;
  listMetadata(): Promise<readonly VaultItemMetadata[]>;
  get(itemId: string): Promise<OtpItem | null>;
  create(candidate: OtpItem): Promise<OtpItem>;
  importOtpBatch(
    candidates: readonly OtpImportCandidate[],
    expectedStatuses: readonly ("accepted" | "duplicate")[],
    observeOwnedCandidates?: (candidates: readonly OtpImportCandidate[]) => void,
  ): Promise<ImportOtpItemsResult>;
  update(candidate: OtpItem, expectedRevision: number): Promise<OtpItem>;
  tombstone(itemId: string, expectedRevision: number): Promise<TombstoneResult>;
  commitHotpReservation(
    reservationId: string,
    binding: PendingHotpReservation["binding"],
  ): Promise<HotpReservationCommitResult>;
  cancelHotpReservation(
    reservationId: string,
    binding: PendingHotpReservation["binding"],
  ): Promise<boolean>;
  savePendingHotpReservation(
    candidate: Omit<PendingHotpReservation, "sessionEpoch">,
  ): Promise<void>;
  migrateLegacySchema(): Promise<number>;
}>;

export function createSessionVaultRepository(
  operations: SessionVaultRepositoryOperations,
): SessionVaultRepository {
  const bridge: SessionVaultRepository = {
    listItems: () => operations.listItems(),
    listAllItems: () => operations.listAllItems(),
    getItem: (itemId) => operations.getItem(itemId),
    createItem: (candidate) => operations.createItem(candidate),
    createItems: (candidates) => operations.createItems(candidates),
    readFolders: () => operations.readFolders(),
    replaceFolders: (folders) => operations.replaceFolders(folders),
    updateItem: (candidate, expectedRevision) => operations.updateItem(candidate, expectedRevision),
    readGenerationMetadata: (name) => operations.readGenerationMetadata(name),
    readOtpItemsAndMetadata: (name) => operations.readOtpItemsAndMetadata(name),
    replaceOtpItemsAndMetadata: (candidates, metadata) =>
      operations.replaceOtpItemsAndMetadata(candidates, metadata),
    replaceOtpItemsAndMetadataIfEpoch: (expectedSessionEpoch, candidates, metadata) =>
      operations.replaceOtpItemsAndMetadataIfEpoch(expectedSessionEpoch, candidates, metadata),
    removeOtpMetadataIfEpoch: (expectedSessionEpoch, candidates, name) =>
      operations.removeOtpMetadataIfEpoch(expectedSessionEpoch, candidates, name),
    readPortableState: () => operations.readPortableState(),
    previewPortableImport: (candidates, descriptor) =>
      operations.previewPortableImport(candidates, descriptor),
    importPortableState: (candidates, descriptor, expected) =>
      operations.importPortableState(candidates, descriptor, expected),
    previewPortableOtpItems: (candidates) => operations.previewPortableOtpItems(candidates),
    importPortableOtpItems: (candidates, expectedStatuses) =>
      operations.importPortableOtpItems(candidates, expectedStatuses),
    listMetadata: () => operations.listMetadata(),
    get: (itemId) => operations.get(itemId),
    create: (candidate) => operations.create(candidate),
    importOtpBatch: (candidates, expectedStatuses, observeOwnedCandidates) =>
      operations.importOtpBatch(candidates, expectedStatuses, observeOwnedCandidates),
    update: (candidate, expectedRevision) => operations.update(candidate, expectedRevision),
    tombstone: (itemId, expectedRevision) => operations.tombstone(itemId, expectedRevision),
    commitHotpReservation: (reservationId, binding) =>
      operations.commitHotpReservation(reservationId, binding),
    cancelHotpReservation: (reservationId, binding) =>
      operations.cancelHotpReservation(reservationId, binding),
    savePendingHotpReservation: (candidate) => operations.savePendingHotpReservation(candidate),
    migrateLegacySchema: () => operations.migrateLegacySchema(),
  };
  return Object.freeze(bridge);
}
