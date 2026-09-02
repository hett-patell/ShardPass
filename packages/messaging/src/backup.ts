import { ItemTimestampSchema, OtpItemSchema } from "@shardpass/domain";
import { z } from "zod/mini";

import type { CommandSenderPolicy } from "./context";
import { MESSAGE_VERSION } from "./envelope";

export const MAX_BACKUP_IMPORT_ITEMS = 10_000;
export const MAX_BACKUP_JOURNAL_ENTRIES = 10_000;
export const MAX_BACKUP_TOMBSTONES = 10_000;

const challengeId = z.string().check(z.regex(/^[0-9a-f]{32}$/));
const opaqueToken = z.uuid();
const canonicalKeyEncryptionKey = z.string().check(z.regex(/^[A-Za-z0-9+/]{43}=$/));
const timestamp = z.number().check(z.int(), z.nonnegative(), z.maximum(Number.MAX_SAFE_INTEGER));
const count = z.int().check(z.nonnegative(), z.maximum(MAX_BACKUP_IMPORT_ITEMS));
const autoLockMinutes = z.union([
  z.literal(0),
  z.literal(5),
  z.literal(15),
  z.literal(30),
  z.literal(60),
]);
const settings = z.strictObject({
  autoLockMinutes,
  lockOnScreenLock: z.boolean(),
});
const journalEntry = z.strictObject({
  sequence: z.int().check(z.positive(), z.maximum(Number.MAX_SAFE_INTEGER)),
  itemId: z.uuid(),
  kind: z.literal("otp"),
  // Accepts both the legacy OTP-only item schema version (1) and the current
  // multi-kind version (2, the value @shardpass/domain's OtpItemSchema now requires)
  // so portable snapshots of real vaults stay valid. The backup format's own
  // top-level `schemaVersion` (below) is a separate, unrelated version number.
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  revision: z.int().check(z.positive(), z.maximum(Number.MAX_SAFE_INTEGER)),
  operation: z.enum(["create", "update", "delete"]),
  changedAt: ItemTimestampSchema,
  mutationId: z.optional(z.uuid()),
});
const tombstone = z.strictObject({
  itemId: z.uuid(),
  revision: z.int().check(z.positive(), z.maximum(Number.MAX_SAFE_INTEGER)),
  deletedAt: ItemTimestampSchema,
});
const history = z.strictObject({
  journal: z.array(journalEntry).check(z.maxLength(MAX_BACKUP_JOURNAL_ENTRIES)),
  tombstones: z.array(tombstone).check(z.maxLength(MAX_BACKUP_TOMBSTONES)),
});
const items = z.array(OtpItemSchema).check(z.maxLength(MAX_BACKUP_IMPORT_ITEMS));

export const SafeBackupDescriptorSchema = z.strictObject({
  sourceFormat: z.enum(["v2", "legacy-v1"]),
  exportedAt: ItemTimestampSchema,
  settings,
  history,
});
export const PortableBackupSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  exportedAt: ItemTimestampSchema,
  items,
  settings,
  history,
});

export const BackupBeginExportStepUpRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("backup.beginExportStepUp"),
});
export const BackupFinishExportStepUpRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("backup.finishExportStepUp"),
  challengeId,
  keyEncryptionKey: canonicalKeyEncryptionKey,
});
export const BackupReadPortableSnapshotRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("backup.readPortableSnapshot"),
  capability: opaqueToken,
});
export const BackupPreviewImportRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("backup.previewImport"),
  descriptor: SafeBackupDescriptorSchema,
  items,
});
export const BackupConfirmImportRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("backup.confirmImport"),
  previewToken: opaqueToken,
});
export const BackupCancelImportRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("backup.cancelImport"),
  previewToken: opaqueToken,
});
export const BackupRequestSchema = z.discriminatedUnion("kind", [
  BackupBeginExportStepUpRequestSchema,
  BackupFinishExportStepUpRequestSchema,
  BackupReadPortableSnapshotRequestSchema,
  BackupPreviewImportRequestSchema,
  BackupConfirmImportRequestSchema,
  BackupCancelImportRequestSchema,
]);

export const BackupExportStepUpChallengeSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("backup.exportStepUpChallenge"),
  challengeId,
  kdf: z.strictObject({
    algorithm: z.literal("argon2id"),
    salt: z.string().check(z.regex(/^[A-Za-z0-9+/]{22}==$/)),
    memoryKiB: z.int().check(z.minimum(8192), z.maximum(131072)),
    iterations: z.int().check(z.minimum(1), z.maximum(10)),
    parallelism: z.int().check(z.minimum(1), z.maximum(4)),
  }),
  expiresAt: timestamp,
});
export const BackupExportAuthorizedSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("backup.exportAuthorized"),
  capability: opaqueToken,
  expiresAt: timestamp,
});
export const BackupPortableSnapshotResultSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("backup.portableSnapshot"),
  capability: opaqueToken,
  payload: PortableBackupSnapshotSchema,
});
const previewRow = z.strictObject({
  ordinal: z.int().check(z.positive(), z.maximum(MAX_BACKUP_IMPORT_ITEMS)),
  status: z.enum(["accepted", "duplicate", "conflict", "rejected"]),
  reason: z.enum([
    "BACKUP_IMPORT_ACCEPTED",
    "BACKUP_IMPORT_DUPLICATE",
    "BACKUP_IMPORT_CONFLICT",
    "BACKUP_IMPORT_INVALID",
    "BACKUP_IMPORT_CAPACITY",
  ]),
});
const previewFields = {
  previewToken: opaqueToken,
  rows: z.array(previewRow).check(z.maxLength(MAX_BACKUP_IMPORT_ITEMS)),
  accepted: count,
  duplicate: count,
  conflict: count,
  rejected: count,
  settings: z.enum(["unchanged", "replace"]),
  history: z.strictObject({
    journalAdded: z.int().check(z.nonnegative(), z.maximum(MAX_BACKUP_JOURNAL_ENTRIES)),
    tombstonesAdded: z.int().check(z.nonnegative(), z.maximum(MAX_BACKUP_TOMBSTONES)),
  }),
  expiresAt: timestamp,
} as const;
const totalsMatch = (value: {
  rows: readonly unknown[];
  accepted: number;
  duplicate: number;
  conflict: number;
  rejected: number;
}) => value.rows.length === value.accepted + value.duplicate + value.conflict + value.rejected;
export const BackupImportPreviewResultSchema = z
  .strictObject({
    version: z.literal(MESSAGE_VERSION),
    kind: z.literal("backup.importPreview"),
    ...previewFields,
  })
  .check(z.refine(totalsMatch));
export const BackupImportPreviewChangedSchema = z
  .strictObject({
    version: z.literal(MESSAGE_VERSION),
    kind: z.literal("backup.importPreviewChanged"),
    ...previewFields,
  })
  .check(z.refine(totalsMatch));
export const BackupImportConfirmedSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("backup.importConfirmed"),
  imported: count,
  duplicate: count,
  conflict: count,
});
export const BackupImportCancelledSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("backup.importCancelled"),
  cancelled: z.boolean(),
});
export const BackupResponseSchema = z.discriminatedUnion("kind", [
  BackupExportStepUpChallengeSchema,
  BackupExportAuthorizedSchema,
  BackupPortableSnapshotResultSchema,
  BackupImportPreviewResultSchema,
  BackupImportPreviewChangedSchema,
  BackupImportConfirmedSchema,
  BackupImportCancelledSchema,
]);

export type SafeBackupDescriptor = z.infer<typeof SafeBackupDescriptorSchema>;
export type PortableBackupSnapshot = z.infer<typeof PortableBackupSnapshotSchema>;
export type BackupRequest = z.infer<typeof BackupRequestSchema>;
export type BackupResponse = z.infer<typeof BackupResponseSchema>;
export type BackupCommandKind = BackupRequest["kind"];
export type BackupResponseKind = BackupResponse["kind"];

export const backupResponseKindsByRequest = {
  "backup.beginExportStepUp": ["backup.exportStepUpChallenge"],
  "backup.finishExportStepUp": ["backup.exportAuthorized"],
  "backup.readPortableSnapshot": ["backup.portableSnapshot"],
  "backup.previewImport": ["backup.importPreview"],
  "backup.confirmImport": ["backup.importConfirmed", "backup.importPreviewChanged"],
  "backup.cancelImport": ["backup.importCancelled"],
} as const satisfies Record<BackupCommandKind, readonly BackupResponseKind[]>;

export function parseBackupResponseForRequest(request: BackupRequest, candidate: unknown) {
  const parsed = BackupResponseSchema.safeParse(candidate);
  if (
    !parsed.success ||
    !(backupResponseKindsByRequest[request.kind] as readonly string[]).includes(parsed.data.kind)
  )
    return { success: false as const };
  return { success: true as const, data: parsed.data };
}

const vaultDocumentOnly = { allowedContexts: ["vault"], requireDocument: true } as const;
export const backupSenderPolicy = {
  "backup.beginExportStepUp": vaultDocumentOnly,
  "backup.finishExportStepUp": vaultDocumentOnly,
  "backup.readPortableSnapshot": vaultDocumentOnly,
  "backup.previewImport": vaultDocumentOnly,
  "backup.confirmImport": vaultDocumentOnly,
  "backup.cancelImport": vaultDocumentOnly,
} satisfies Record<BackupCommandKind, CommandSenderPolicy>;
