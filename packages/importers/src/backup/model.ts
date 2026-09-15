import {
  FolderSchema,
  ItemTimestampSchema,
  MAX_FOLDER_DEPTH,
  MAX_FOLDERS,
  OtpItemSchema,
  VaultItemSchema,
  type Folder,
} from "@shardpass/domain";
import { z } from "zod/mini";

export const BACKUP_V2_LIMITS = Object.freeze({
  maxEnvelopeBytes: 8_388_608,
  maxCiphertextBytes: 8_000_000,
  maxItems: 20_000,
  maxFolders: MAX_FOLDERS,
  maxJournalEntries: 10_000,
  maxTombstones: 10_000,
});

/** The payload schema version a freshly created backup carries. */
export const PORTABLE_BACKUP_PAYLOAD_VERSION = 2 as const;

const AutoLockMinutesSchema = z.union([
  z.literal(0),
  z.literal(5),
  z.literal(15),
  z.literal(30),
  z.literal(60),
]);

export const PortableJournalEntrySchema = z.strictObject({
  sequence: z.int().check(z.positive(), z.maximum(Number.MAX_SAFE_INTEGER)),
  itemId: z.uuid(),
  kind: z.literal("otp"),
  // Accepts both the legacy OTP-only item schema version (1) and the current
  // multi-kind version (2, the value @shardpass/domain's OtpItemSchema now requires)
  // so portable snapshots of real vaults stay valid. The backup payload's own
  // top-level `schemaVersion` (below) is a separate, unrelated version number.
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  revision: z.int().check(z.positive(), z.maximum(Number.MAX_SAFE_INTEGER)),
  operation: z.enum(["create", "update", "delete"]),
  changedAt: ItemTimestampSchema,
  mutationId: z.optional(z.uuid()),
});

export const PortableTombstoneSchema = z.strictObject({
  itemId: z.uuid(),
  revision: z.int().check(z.positive(), z.maximum(Number.MAX_SAFE_INTEGER)),
  deletedAt: ItemTimestampSchema,
});

/**
 * True when the folders form one bounded forest: ids are unique, every parent is in the
 * list, and no chain is deeper than MAX_FOLDER_DEPTH (which also rules out cycles).
 */
export function isPortableFolderTree(folders: readonly Folder[]): boolean {
  const byId = new Map<string, Folder>();
  for (const folder of folders) {
    if (byId.has(folder.id)) return false;
    byId.set(folder.id, folder);
  }
  for (const folder of folders) {
    let depth = 0;
    let cursor: string | undefined = folder.id;
    while (cursor !== undefined) {
      const current = byId.get(cursor);
      if (current === undefined) return false;
      depth += 1;
      if (depth > MAX_FOLDER_DEPTH) return false;
      cursor = current.parentId;
    }
  }
  return true;
}

const PortableSettingsSchema = z.strictObject({
  autoLockMinutes: AutoLockMinutesSchema,
  lockOnScreenLock: z.boolean(),
  lockWhenClosed: z.optional(z.boolean()),
});
const PortableHistorySchema = z.strictObject({
  journal: z
    .array(PortableJournalEntrySchema)
    .check(z.maxLength(BACKUP_V2_LIMITS.maxJournalEntries)),
  tombstones: z.array(PortableTombstoneSchema).check(z.maxLength(BACKUP_V2_LIMITS.maxTombstones)),
});
const PortableFoldersSchema = z
  .array(FolderSchema)
  .check(
    z.maxLength(BACKUP_V2_LIMITS.maxFolders),
    z.refine(isPortableFolderTree, { error: "Folders must form a bounded tree" }),
  );

/** Payload version 1: one-time codes only. Still read; never written any more. */
export const PortableBackupPayloadV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  exportedAt: ItemTimestampSchema,
  items: z.array(OtpItemSchema).check(z.maxLength(BACKUP_V2_LIMITS.maxItems)),
  settings: PortableSettingsSchema,
  history: PortableHistorySchema,
});

/** Payload version 2: every item kind plus folders. The journal stays OTP-only. */
export const PortableBackupPayloadV2Schema = z.strictObject({
  schemaVersion: z.literal(PORTABLE_BACKUP_PAYLOAD_VERSION),
  exportedAt: ItemTimestampSchema,
  items: z.array(VaultItemSchema).check(z.maxLength(BACKUP_V2_LIMITS.maxItems)),
  folders: PortableFoldersSchema,
  settings: PortableSettingsSchema,
  history: PortableHistorySchema,
});

export const PortableBackupPayloadSchema = z.discriminatedUnion("schemaVersion", [
  PortableBackupPayloadV1Schema,
  PortableBackupPayloadV2Schema,
]);

export type PortableJournalEntry = z.infer<typeof PortableJournalEntrySchema>;
export type PortableTombstone = z.infer<typeof PortableTombstoneSchema>;
export type PortableBackupPayloadV1 = z.infer<typeof PortableBackupPayloadV1Schema>;
export type PortableBackupPayloadV2 = z.infer<typeof PortableBackupPayloadV2Schema>;
export type PortableBackupPayload = z.infer<typeof PortableBackupPayloadSchema>;
export type PortableBackupPayloadVersion = PortableBackupPayload["schemaVersion"];

export type ImportedPortableBackup = Readonly<{
  sourceFormat: "v2" | "legacy-v1";
  payload: PortableBackupPayload;
}>;
