import type { OtpItem } from "@shardpass/domain";
import type {
  GenerationMetadataName,
  HotpReservationCommitResult,
  PendingHotpReservation,
  ImportOtpItemsResult,
  ImportPortableOtpItemsResult,
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
  readPortableState(): Promise<PortableVaultState>;
  previewPortableImport(
    candidates: readonly OtpItem[],
    descriptor: PortableImportDescriptor,
  ): Promise<PortableImportPreview>;
  importPortableState(
    candidates: readonly OtpItem[],
    descriptor: PortableImportDescriptor,
    expected: PortableImportPreview,
  ): Promise<ImportPortableOtpItemsResult>;
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
}

type SessionVaultRepositoryOperations = Readonly<{
  listItems(): Promise<readonly OtpItem[]>;
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
    candidates: readonly OtpItem[],
    descriptor: PortableImportDescriptor,
  ): Promise<PortableImportPreview>;
  importPortableState(
    candidates: readonly OtpItem[],
    descriptor: PortableImportDescriptor,
    expected: PortableImportPreview,
  ): Promise<ImportPortableOtpItemsResult>;
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
}>;

export function createSessionVaultRepository(
  operations: SessionVaultRepositoryOperations,
): SessionVaultRepository {
  const bridge: SessionVaultRepository = {
    listItems: () => operations.listItems(),
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
  };
  return Object.freeze(bridge);
}
