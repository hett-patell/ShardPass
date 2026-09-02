import { ItemTimestampSchema, OtpItemSchema } from "@shardpass/domain";
import { z } from "zod/mini";

export const BACKUP_V2_LIMITS = Object.freeze({
  maxEnvelopeBytes: 8_388_608,
  maxCiphertextBytes: 8_000_000,
  maxItems: 10_000,
  maxJournalEntries: 10_000,
  maxTombstones: 10_000,
});

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
  schemaVersion: z.literal(1),
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

export const PortableBackupPayloadSchema = z.strictObject({
  schemaVersion: z.literal(1),
  exportedAt: ItemTimestampSchema,
  items: z.array(OtpItemSchema).check(z.maxLength(BACKUP_V2_LIMITS.maxItems)),
  settings: z.strictObject({
    autoLockMinutes: AutoLockMinutesSchema,
    lockOnScreenLock: z.boolean(),
  }),
  history: z.strictObject({
    journal: z
      .array(PortableJournalEntrySchema)
      .check(z.maxLength(BACKUP_V2_LIMITS.maxJournalEntries)),
    tombstones: z.array(PortableTombstoneSchema).check(z.maxLength(BACKUP_V2_LIMITS.maxTombstones)),
  }),
});

export type PortableJournalEntry = z.infer<typeof PortableJournalEntrySchema>;
export type PortableTombstone = z.infer<typeof PortableTombstoneSchema>;
export type PortableBackupPayload = z.infer<typeof PortableBackupPayloadSchema>;

export type ImportedPortableBackup = Readonly<{
  sourceFormat: "v2" | "legacy-v1";
  payload: PortableBackupPayload;
}>;
