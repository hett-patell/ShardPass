import {
  BackupRequestSchema,
  BackupResponseSchema,
  isValidSenderContext,
  type BackupCountsByKind,
  type BackupFolderOutcome,
  type BackupRequest,
  type BackupResponse,
  type PortableBackupSnapshot,
  type SafeBackupDescriptor,
  type SenderContext,
  type VaultLockSettings,
} from "@shardpass/messaging";
import { VAULT_ITEM_KINDS, VaultItemSchema, type VaultItem } from "@shardpass/domain";

import type { SenderBinding } from "./session-service";

const CAPABILITY_TTL_MS = 300_000;
const MAX_PREVIEWS_PER_DOCUMENT = 4;
const MAX_LIVE_PREVIEWS = 32;
const MAX_TOKEN_ATTEMPTS = 16;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type PreviewRow = Readonly<{
  ordinal: number;
  status: "accepted" | "duplicate" | "conflict" | "rejected";
  reason:
    | "BACKUP_IMPORT_ACCEPTED"
    | "BACKUP_IMPORT_DUPLICATE"
    | "BACKUP_IMPORT_CONFLICT"
    | "BACKUP_IMPORT_INVALID"
    | "BACKUP_IMPORT_CAPACITY";
}>;
type PreviewResult = Readonly<{
  rows: readonly PreviewRow[];
  accepted: number;
  duplicate: number;
  conflict: number;
  rejected: number;
  settings: "unchanged" | "replace";
  history: Readonly<{ journalAdded: number; tombstonesAdded: number }>;
  byKind: BackupCountsByKind;
  folders: BackupFolderOutcome;
}>;
type ConfirmResult =
  | Readonly<{
      previewChanged: false;
      imported: number;
      duplicate: number;
      conflict: number;
      byKind: BackupCountsByKind;
      folders: BackupFolderOutcome;
    }>
  | Readonly<{ previewChanged: true; preview: PreviewResult }>;

/** Opaque session/root authority. Implementations must reject it after lock or root replacement. */
export type BackupSessionAuthority = object;

/** Deliberately excludes repositories, roots, DEKs, epochs, and callbacks. */
export type BackupSessionPort = Readonly<{
  createBackupStepUpChallenge(sender: SenderBinding): Promise<{
    challengeId: string;
    kdf: {
      algorithm: "argon2id";
      salt: string;
      memoryKiB: number;
      iterations: number;
      parallelism: number;
    };
    expiresAt: number;
  }>;
  authorizeBackupExport(
    challengeId: string,
    ownedKeyEncryptionKey: Uint8Array,
    sender: SenderBinding,
  ): Promise<BackupSessionAuthority>;
  captureBackupSession(): Promise<BackupSessionAuthority>;
  assertBackupSession(authority: BackupSessionAuthority): Promise<void>;
  readPortableBackupSnapshot(
    authority: BackupSessionAuthority,
    readSettings?: () => VaultLockSettings,
  ): Promise<PortableBackupSnapshot>;
  previewPortableBackupImport(
    descriptor: SafeBackupDescriptor,
    items: readonly VaultItem[],
    authority: BackupSessionAuthority,
  ): Promise<PreviewResult>;
  confirmPortableBackupImport(
    descriptor: SafeBackupDescriptor,
    items: readonly VaultItem[],
    expected: PreviewResult,
    authority: BackupSessionAuthority,
  ): Promise<ConfirmResult>;
  onLockOrDispose(callback: () => void): () => void;
}>;

type Dependencies = Readonly<{
  sessions: BackupSessionPort;
  readSettings?(): VaultLockSettings;
  applyImportedSettings?(settings: VaultLockSettings): Promise<void>;
  now(): number;
  nextId?(): string;
}>;
type ExportCapability = {
  token: string;
  senderKey: string;
  authority: BackupSessionAuthority;
  expiresAt: number;
  generation: number;
  state: "pending" | "reading";
};
type PreviewCapability = {
  token: string;
  senderKey: string;
  authority: BackupSessionAuthority;
  descriptor: SafeBackupDescriptor;
  items: VaultItem[];
  preview: PreviewResult;
  expiresAt: number;
  sequence: number;
  generation: number;
  state: "creating" | "pending" | "confirming";
};

export type BackupServiceErrorCode =
  | "BACKUP_INVALID"
  | "BACKUP_AUTH_FAILED"
  | "BACKUP_EXPIRED"
  | "BACKUP_CHANGED"
  | "BACKUP_CAPACITY"
  | "BACKUP_UNAVAILABLE";

export class BackupServiceError extends Error {
  constructor(readonly code: BackupServiceErrorCode) {
    super(code);
    this.name = "BackupServiceError";
  }
}

export class BackupService {
  private readonly exports = new Map<string, ExportCapability>();
  private readonly previews = new Map<string, PreviewCapability>();
  private readonly unregisterCleanup: () => void;
  private generation = 0;
  private sequence = 0;
  private disposed = false;

  constructor(private readonly dependencies: Dependencies) {
    this.unregisterCleanup = dependencies.sessions.onLockOrDispose(() => this.clearForSession());
  }

  clearForSession(): void {
    this.generation += 1;
    this.exports.clear();
    for (const operation of this.previews.values()) clearPreview(operation);
    this.previews.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unregisterCleanup();
    this.clearForSession();
  }

  async handle(request: BackupRequest, sender: SenderContext): Promise<BackupResponse> {
    if (this.disposed) throw new BackupServiceError("BACKUP_UNAVAILABLE");
    const parsed = BackupRequestSchema.safeParse(request);
    if (!parsed.success || !isBackupSender(sender)) throw new BackupServiceError("BACKUP_INVALID");
    this.expire();
    try {
      switch (parsed.data.kind) {
        case "backup.beginExportStepUp":
          return this.beginStepUp(sender);
        case "backup.finishExportStepUp":
          return this.finishStepUp(parsed.data.challengeId, parsed.data.keyEncryptionKey, sender);
        case "backup.readPortableSnapshot":
          return this.readSnapshot(parsed.data.capability, sender);
        case "backup.previewImport":
          return this.previewImport(parsed.data.descriptor, parsed.data.items, sender);
        case "backup.confirmImport":
          return this.confirmImport(parsed.data.previewToken, sender);
        case "backup.cancelImport":
          this.cancelImport(parsed.data.previewToken, sender);
          return this.response({ version: 1, kind: "backup.importCancelled", cancelled: true });
      }
    } catch (error) {
      if (error instanceof BackupServiceError) throw error;
      throw mapSessionError(error);
    }
  }

  private async beginStepUp(sender: SenderBinding): Promise<BackupResponse> {
    const challenge = await this.dependencies.sessions.createBackupStepUpChallenge(sender);
    return this.response({
      version: 1,
      kind: "backup.exportStepUpChallenge",
      challengeId: challenge.challengeId,
      kdf: challenge.kdf,
      expiresAt: challenge.expiresAt,
    });
  }

  private async finishStepUp(
    challengeId: string,
    encodedKey: string,
    sender: SenderBinding,
  ): Promise<BackupResponse> {
    const key = decodeCanonicalKey(encodedKey);
    let authority: BackupSessionAuthority;
    try {
      authority = await this.dependencies.sessions.authorizeBackupExport(challengeId, key, sender);
    } finally {
      key.fill(0);
    }
    const operation = this.reserveExport(authority, senderKey(sender));
    return this.response({
      version: 1,
      kind: "backup.exportAuthorized",
      capability: operation.token,
      expiresAt: operation.expiresAt,
    });
  }

  private async readSnapshot(token: string, sender: SenderBinding): Promise<BackupResponse> {
    const operation = this.claimExport(token, sender);
    try {
      await this.dependencies.sessions.assertBackupSession(operation.authority);
      this.assertExportCurrent(operation);
      const payload =
        this.dependencies.readSettings === undefined
          ? await this.dependencies.sessions.readPortableBackupSnapshot(operation.authority)
          : await this.dependencies.sessions.readPortableBackupSnapshot(
              operation.authority,
              this.dependencies.readSettings,
            );
      this.assertExportCurrent(operation);
      await this.dependencies.sessions.assertBackupSession(operation.authority);
      this.assertExportCurrent(operation);
      return this.response({
        version: 1,
        kind: "backup.portableSnapshot",
        capability: operation.token,
        payload,
      });
    } catch (error) {
      throw mapCapabilityError(error);
    } finally {
      if (this.exports.get(operation.token) === operation) this.exports.delete(operation.token);
    }
  }

  private async previewImport(
    descriptor: SafeBackupDescriptor,
    items: readonly VaultItem[],
    sender: SenderBinding,
  ): Promise<BackupResponse> {
    const ownedDescriptor = copyDescriptor(descriptor);
    const ownedItems = items.map(copyItem);
    let operation: PreviewCapability | undefined;
    try {
      const authority = await this.dependencies.sessions.captureBackupSession();
      operation = this.reservePreview(ownedDescriptor, ownedItems, authority, senderKey(sender));
      const result = await this.dependencies.sessions.previewPortableBackupImport(
        operation.descriptor,
        operation.items,
        operation.authority,
      );
      this.assertPreviewCurrent(operation);
      await this.dependencies.sessions.assertBackupSession(operation.authority);
      this.assertPreviewCurrent(operation);
      operation.preview = copyPreview(result);
      operation.expiresAt = safeAdd(this.dependencies.now(), CAPABILITY_TTL_MS);
      operation.state = "pending";
      return this.previewResponse("backup.importPreview", operation);
    } catch (error) {
      if (operation !== undefined) this.removePreview(operation);
      else ownedItems.splice(0);
      throw mapCapabilityError(error, "BACKUP_UNAVAILABLE");
    }
  }

  private async confirmImport(token: string, sender: SenderBinding): Promise<BackupResponse> {
    const operation = this.claimPreview(token, sender);
    try {
      await this.dependencies.sessions.assertBackupSession(operation.authority);
      this.assertPreviewCurrent(operation);
      const result = await this.dependencies.sessions.confirmPortableBackupImport(
        operation.descriptor,
        operation.items,
        operation.preview,
        operation.authority,
      );
      this.assertPreviewCurrent(operation);
      await this.dependencies.sessions.assertBackupSession(operation.authority);
      this.assertPreviewCurrent(operation);
      if (result.previewChanged) {
        const descriptor = copyDescriptor(operation.descriptor);
        const items = operation.items.map(copyItem);
        this.removePreview(operation);
        const replacement = this.reservePreview(
          descriptor,
          items,
          operation.authority,
          operation.senderKey,
        );
        replacement.preview = copyPreview(result.preview);
        replacement.expiresAt = safeAdd(this.dependencies.now(), CAPABILITY_TTL_MS);
        replacement.state = "pending";
        return this.previewResponse("backup.importPreviewChanged", replacement);
      }
      try {
        await this.dependencies.applyImportedSettings?.({ ...operation.descriptor.settings });
      } catch {
        // The authenticated generation is already committed. Projection is retried at session boundaries.
      }
      return this.response({
        version: 1,
        kind: "backup.importConfirmed",
        imported: result.imported,
        duplicate: result.duplicate,
        conflict: result.conflict,
        byKind: { ...result.byKind },
        folders: { ...result.folders },
      });
    } catch (error) {
      throw mapCapabilityError(error);
    } finally {
      if (this.previews.get(operation.token) === operation) this.removePreview(operation);
    }
  }

  private reserveExport(authority: BackupSessionAuthority, binding: string): ExportCapability {
    const operation: ExportCapability = {
      token: this.allocateToken(),
      senderKey: binding,
      authority,
      expiresAt: safeAdd(this.dependencies.now(), CAPABILITY_TTL_MS),
      generation: this.generation,
      state: "pending",
    };
    this.exports.set(operation.token, operation);
    return operation;
  }

  private claimExport(token: string, sender: SenderBinding): ExportCapability {
    const operation = this.exports.get(token);
    if (
      operation === undefined ||
      operation.state !== "pending" ||
      operation.senderKey !== senderKey(sender) ||
      operation.generation !== this.generation ||
      operation.expiresAt < this.dependencies.now()
    ) {
      if (operation !== undefined && operation.expiresAt < this.dependencies.now())
        this.exports.delete(operation.token);
      throw new BackupServiceError("BACKUP_EXPIRED");
    }
    operation.state = "reading";
    return operation;
  }

  private assertExportCurrent(operation: ExportCapability): void {
    if (
      this.disposed ||
      operation.generation !== this.generation ||
      this.exports.get(operation.token) !== operation ||
      operation.state !== "reading"
    )
      throw new BackupServiceError("BACKUP_EXPIRED");
  }

  private reservePreview(
    descriptor: SafeBackupDescriptor,
    items: VaultItem[],
    authority: BackupSessionAuthority,
    binding: string,
  ): PreviewCapability {
    this.evictOwnPreview(binding);
    if (this.previews.size >= MAX_LIVE_PREVIEWS) {
      items.splice(0);
      throw new BackupServiceError("BACKUP_CAPACITY");
    }
    const operation: PreviewCapability = {
      token: this.allocateToken(),
      senderKey: binding,
      authority,
      descriptor,
      items,
      preview: emptyPreview(),
      expiresAt: 0,
      sequence: this.sequence++,
      generation: this.generation,
      state: "creating",
    };
    this.previews.set(operation.token, operation);
    return operation;
  }

  private claimPreview(token: string, sender: SenderBinding): PreviewCapability {
    const operation = this.previews.get(token);
    if (
      operation === undefined ||
      operation.state !== "pending" ||
      operation.senderKey !== senderKey(sender) ||
      operation.generation !== this.generation ||
      operation.expiresAt < this.dependencies.now()
    ) {
      if (operation !== undefined && operation.expiresAt < this.dependencies.now())
        this.removePreview(operation);
      throw new BackupServiceError("BACKUP_EXPIRED");
    }
    operation.state = "confirming";
    return operation;
  }

  private cancelImport(token: string, sender: SenderBinding): void {
    const operation = this.previews.get(token);
    if (
      operation !== undefined &&
      operation.state !== "confirming" &&
      operation.senderKey === senderKey(sender)
    )
      this.removePreview(operation);
  }

  private assertPreviewCurrent(operation: PreviewCapability): void {
    if (
      this.disposed ||
      operation.generation !== this.generation ||
      this.previews.get(operation.token) !== operation
    )
      throw new BackupServiceError("BACKUP_EXPIRED");
  }

  private evictOwnPreview(binding: string): void {
    const own = [...this.previews.values()]
      .filter((operation) => operation.senderKey === binding && operation.state !== "confirming")
      .sort((left, right) => left.sequence - right.sequence);
    while (own.length >= MAX_PREVIEWS_PER_DOCUMENT) this.removePreview(own.shift()!);
  }

  private removePreview(operation: PreviewCapability): void {
    if (this.previews.get(operation.token) === operation) this.previews.delete(operation.token);
    clearPreview(operation);
  }

  private expire(): void {
    const now = this.dependencies.now();
    for (const operation of this.exports.values())
      if (operation.state === "pending" && operation.expiresAt < now)
        this.exports.delete(operation.token);
    for (const operation of this.previews.values())
      if (operation.state === "pending" && operation.expiresAt < now) this.removePreview(operation);
  }

  private allocateToken(): string {
    for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt++) {
      const token = this.dependencies.nextId?.() ?? crypto.randomUUID();
      if (UUID.test(token) && !this.exports.has(token) && !this.previews.has(token)) return token;
    }
    throw new BackupServiceError("BACKUP_UNAVAILABLE");
  }

  private previewResponse(
    kind: "backup.importPreview" | "backup.importPreviewChanged",
    operation: PreviewCapability,
  ): BackupResponse {
    return this.response({
      version: 1,
      kind,
      previewToken: operation.token,
      rows: operation.preview.rows.map((row) => ({ ...row })),
      accepted: operation.preview.accepted,
      duplicate: operation.preview.duplicate,
      conflict: operation.preview.conflict,
      rejected: operation.preview.rejected,
      byKind: { ...operation.preview.byKind },
      settings: operation.preview.settings,
      history: { ...operation.preview.history },
      folders: { ...operation.preview.folders },
      expiresAt: operation.expiresAt,
    });
  }

  private response(candidate: BackupResponse): BackupResponse {
    const parsed = BackupResponseSchema.safeParse(candidate);
    if (!parsed.success) throw new BackupServiceError("BACKUP_UNAVAILABLE");
    return parsed.data;
  }
}

function isBackupSender(sender: SenderContext): sender is SenderBinding {
  return (
    isValidSenderContext(sender) &&
    sender.contextKind === "vault" &&
    sender.documentId !== undefined
  );
}
function senderKey(sender: SenderBinding): string {
  return `${sender.extensionId}\n${sender.senderUrl}\n${sender.documentId}\n${sender.tabId ?? ""}\n${sender.frameId ?? ""}`;
}
function decodeCanonicalKey(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]{43}=$/u.test(value)) throw new BackupServiceError("BACKUP_INVALID");
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  if (bytes.byteLength !== 32 || btoa(String.fromCharCode(...bytes)) !== value) {
    bytes.fill(0);
    throw new BackupServiceError("BACKUP_INVALID");
  }
  return bytes;
}
/** A fresh, frozen object graph: nothing the sender handed over is kept by reference. */
function copyItem(item: VaultItem): VaultItem {
  return Object.freeze(VaultItemSchema.parse(item));
}
function copyDescriptor(descriptor: SafeBackupDescriptor): SafeBackupDescriptor {
  return {
    sourceFormat: descriptor.sourceFormat,
    exportedAt: descriptor.exportedAt,
    settings: { ...descriptor.settings },
    history: {
      journal: descriptor.history.journal.map((entry) => ({ ...entry })),
      tombstones: descriptor.history.tombstones.map((entry) => ({ ...entry })),
    },
    ...(descriptor.folders === undefined
      ? {}
      : { folders: descriptor.folders.map((folder) => ({ ...folder })) }),
  };
}
function copyPreview(result: PreviewResult): PreviewResult {
  return Object.freeze({
    rows: Object.freeze(result.rows.map((row) => Object.freeze({ ...row }))),
    accepted: result.accepted,
    duplicate: result.duplicate,
    conflict: result.conflict,
    rejected: result.rejected,
    settings: result.settings,
    history: Object.freeze({ ...result.history }),
    byKind: Object.freeze({ ...result.byKind }),
    folders: Object.freeze({ ...result.folders }),
  });
}
function emptyPreview(): PreviewResult {
  return {
    rows: [],
    accepted: 0,
    duplicate: 0,
    conflict: 0,
    rejected: 0,
    settings: "unchanged",
    history: { journalAdded: 0, tombstonesAdded: 0 },
    byKind: Object.fromEntries(VAULT_ITEM_KINDS.map((kind) => [kind, 0])) as BackupCountsByKind,
    folders: { created: 0, unfiled: 0 },
  };
}
function clearPreview(operation: PreviewCapability): void {
  operation.items.splice(0);
  operation.preview = emptyPreview();
}
function safeAdd(left: number, right: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}
function mapCapabilityError(error: unknown, fallback: BackupServiceErrorCode = "BACKUP_EXPIRED") {
  if (error instanceof BackupServiceError) return error;
  const code = errorCode(error);
  if (code === "STORAGE_CAPACITY_EXCEEDED" || code === "BACKUP_CAPACITY")
    return new BackupServiceError("BACKUP_CAPACITY");
  return new BackupServiceError(fallback);
}
function mapSessionError(error: unknown): BackupServiceError {
  const code = errorCode(error);
  if (code === "INVALID_CREDENTIALS" || code === "THROTTLED")
    return new BackupServiceError("BACKUP_AUTH_FAILED");
  if (code === "STORAGE_CAPACITY_EXCEEDED" || code === "BACKUP_CAPACITY")
    return new BackupServiceError("BACKUP_CAPACITY");
  if (code === "CHALLENGE_INVALID") return new BackupServiceError("BACKUP_EXPIRED");
  if (code === "VAULT_LOCKED") return new BackupServiceError("BACKUP_EXPIRED");
  return new BackupServiceError("BACKUP_UNAVAILABLE");
}
function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}
