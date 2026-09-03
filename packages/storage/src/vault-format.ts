import {
  ITEM_SCHEMA_VERSION,
  ItemIdSchema,
  ItemTimestampSchema,
  VAULT_ITEM_KINDS,
  VaultItemSchema,
  type VaultItem,
} from "@shardpass/domain";
import { z } from "zod/mini";

import { validateCanonicalBase64 } from "./canonical-base64";

export const LEGACY_VAULT_FORMAT_VERSION = 1 as const;
export const RECEIPT_VAULT_FORMAT_VERSION = 2 as const;
export const VAULT_FORMAT_VERSION = 3 as const;
export const RECORD_FORMAT_VERSION = 1 as const;
export const METADATA_FORMAT_VERSION = 3 as const;
export const MAX_GENERATION_ENTRIES = 10_000;
export const MAX_GENERATION_METADATA_PLAINTEXT_BYTES = 256 * 1024;
export const MAX_GENERATION_METADATA_ENVELOPE_BYTES = MAX_GENERATION_METADATA_PLAINTEXT_BYTES + 16;
export const GENERATION_METADATA_NAMES = Object.freeze([
  "migration-descriptor",
  "lock-settings",
  "ente-otp-state",
  "hotp-pending-state",
  "folders",
] as const);
export const MAX_ENCRYPTED_RECORD_BYTES = 256 * 1024;
export const MIN_ARGON2_MEMORY_KIB = 8_192;
export const MAX_ARGON2_MEMORY_KIB = 131_072;
export const MAX_ARGON2_PARALLELISM = 4;

const base64Bytes = (minimumBytes: number, maximumBytes: number) =>
  z.string().check(
    z.refine(
      (value) => {
        const validation = validateCanonicalBase64(value, maximumBytes);
        return validation.valid && validation.decodedLength >= minimumBytes;
      },
      {
        error: `Value must be canonical padded Base64 encoding ${minimumBytes}-${maximumBytes} bytes`,
      },
    ),
  );
const fixedBase64Bytes = (bytes: number) => base64Bytes(bytes, bytes);

/** All item kinds an encrypted record's plaintext-associated-data `kind` field may declare. */
const vaultItemKindSchema = z.enum(VAULT_ITEM_KINDS);
/**
 * The item schema version an encrypted record's plaintext-associated-data `schemaVersion`
 * field may declare. Accepts both the legacy OTP-only version (1) and the current
 * multi-kind version (2) so existing vault records remain decryptable; new records are
 * always written with the current version. See vault migration (upgrades records in place).
 */
const recordItemSchemaVersionSchema = z.union([z.literal(1), z.literal(2)]);

export const Argon2idParametersSchema = z
  .strictObject({
    algorithm: z.literal("argon2id"),
    salt: fixedBase64Bytes(16),
    memoryKiB: z.int().check(z.minimum(MIN_ARGON2_MEMORY_KIB), z.maximum(MAX_ARGON2_MEMORY_KIB)),
    iterations: z.int().check(z.minimum(1), z.maximum(10)),
    parallelism: z.int().check(z.minimum(1), z.maximum(MAX_ARGON2_PARALLELISM)),
  })
  .check(
    z.refine((parameters) => parameters.memoryKiB >= 8 * parameters.parallelism, {
      error: "Argon2 memoryKiB must be at least eight times parallelism",
    }),
  );

export const WrappedVaultKeySchema = z.strictObject({
  formatVersion: z.literal(LEGACY_VAULT_FORMAT_VERSION),
  kdf: Argon2idParametersSchema,
  wrapping: z.strictObject({
    algorithm: z.literal("xchacha20-poly1305"),
    nonce: fixedBase64Bytes(24),
    ciphertext: base64Bytes(16, 1024),
    encoding: z.literal("base64"),
  }),
});

const rootFields = {
  format: z.literal("shardpass-vault"),
  activeGenerationId: ItemIdSchema,
  previousGenerationId: z.optional(ItemIdSchema),
  wrappedKey: WrappedVaultKeySchema,
};
const rootCheck = (root: {
  activeGenerationId: string;
  previousGenerationId?: string | undefined;
}) =>
  root.previousGenerationId === undefined || root.previousGenerationId !== root.activeGenerationId;
export const LegacyVaultRootSchema = z
  .strictObject({ ...rootFields, formatVersion: z.literal(LEGACY_VAULT_FORMAT_VERSION) })
  .check(z.refine(rootCheck, { error: "Previous generation must differ from active generation" }));
export const ReceiptVaultRootSchema = z
  .strictObject({ ...rootFields, formatVersion: z.literal(RECEIPT_VAULT_FORMAT_VERSION) })
  .check(z.refine(rootCheck, { error: "Previous generation must differ from active generation" }));
export const CurrentVaultRootSchema = z
  .strictObject({ ...rootFields, formatVersion: z.literal(VAULT_FORMAT_VERSION) })
  .check(z.refine(rootCheck, { error: "Previous generation must differ from active generation" }));
export const VaultRootSchema = z.discriminatedUnion("formatVersion", [
  LegacyVaultRootSchema,
  ReceiptVaultRootSchema,
  CurrentVaultRootSchema,
]);

const legacyGenerationFields = {
  format: z.literal("shardpass-vault-generation"),
  formatVersion: z.literal(LEGACY_VAULT_FORMAT_VERSION),
  id: ItemIdSchema,
  createdAt: ItemTimestampSchema,
  recordCount: z.int().check(z.nonnegative(), z.maximum(MAX_GENERATION_ENTRIES)),
  journalCount: z.int().check(z.nonnegative(), z.maximum(MAX_GENERATION_ENTRIES)),
  entryCount: z.int().check(z.nonnegative(), z.maximum(MAX_GENERATION_ENTRIES)),
  manifestHashAlgorithm: z.literal("SHA256"),
};
export const LegacyVaultGenerationSchema = z.strictObject(legacyGenerationFields);
const receiptGenerationFields = {
  ...legacyGenerationFields,
  receiptCount: z.int().check(z.nonnegative(), z.maximum(MAX_GENERATION_ENTRIES)),
  receiptStartSequence: z.int().check(z.positive(), z.maximum(Number.MAX_SAFE_INTEGER)),
  nextReceiptSequence: z.int().check(z.positive(), z.maximum(Number.MAX_SAFE_INTEGER)),
  journalStartSequence: z.int().check(z.positive(), z.maximum(Number.MAX_SAFE_INTEGER)),
  nextJournalSequence: z.int().check(z.positive(), z.maximum(Number.MAX_SAFE_INTEGER)),
};
export const ReceiptVaultGenerationSchema = z.strictObject({
  ...receiptGenerationFields,
  formatVersion: z.literal(RECEIPT_VAULT_FORMAT_VERSION),
});
export const VaultGenerationSchema = z.strictObject({
  ...receiptGenerationFields,
  formatVersion: z.literal(VAULT_FORMAT_VERSION),
  metadataCount: z.int().check(z.nonnegative(), z.maximum(GENERATION_METADATA_NAMES.length)),
});

export const EncryptedRecordSchema = z.strictObject({
  format: z.literal("shardpass-encrypted-record"),
  formatVersion: z.literal(RECORD_FORMAT_VERSION),
  itemId: ItemIdSchema,
  kind: vaultItemKindSchema,
  schemaVersion: recordItemSchemaVersionSchema,
  revision: z.int().check(z.positive()),
  nonce: fixedBase64Bytes(24),
  ciphertext: base64Bytes(16, MAX_ENCRYPTED_RECORD_BYTES),
  encoding: z.literal("base64"),
});
export const EncryptedJournalRecordSchema = z.strictObject({
  format: z.literal("shardpass-encrypted-journal"),
  formatVersion: z.literal(RECORD_FORMAT_VERSION),
  itemId: ItemIdSchema,
  kind: vaultItemKindSchema,
  schemaVersion: recordItemSchemaVersionSchema,
  revision: z.int().check(z.positive()),
  sequence: z.int().check(z.positive(), z.maximum(Number.MAX_SAFE_INTEGER)),
  nonce: fixedBase64Bytes(24),
  ciphertext: base64Bytes(16, MAX_ENCRYPTED_RECORD_BYTES),
  encoding: z.literal("base64"),
});
/**
 * Parses a decrypted vault-item plaintext payload, transparently upgrading a legacy
 * (pre-multi-kind) OTP item — `kind: "otp"` at the old item schema version (1) — to
 * the current item schema version in memory. Pre-widening vaults only ever held OTP
 * items at schema version 1 (every other kind, and schema version 2, postdate this
 * widening), so that is the only legacy shape that can exist on disk. The vault
 * migration is responsible for rewriting the persisted ciphertext at schema version 2;
 * this only makes existing records readable in the meantime. Returns the parsed item
 * plus whether the legacy-upgrade path was used, so callers can relax their
 * record/item schema-version consistency check for exactly that case.
 */
export function parseVaultItemPlaintext(raw: unknown): {
  item: VaultItem;
  upgradedFromLegacySchemaVersion: boolean;
} {
  const isLegacyOtpPayload =
    typeof raw === "object" &&
    raw !== null &&
    !Array.isArray(raw) &&
    (raw as Record<string, unknown>).kind === "otp" &&
    (raw as Record<string, unknown>).schemaVersion === 1;
  const item = VaultItemSchema.parse(
    isLegacyOtpPayload
      ? { ...(raw as Record<string, unknown>), schemaVersion: ITEM_SCHEMA_VERSION }
      : raw,
  );
  return { item, upgradedFromLegacySchemaVersion: isLegacyOtpPayload };
}

/**
 * Whether a parsed item is consistent with the encrypted record's own plaintext-
 * associated-data fields: either they agree exactly (the common case), or the record
 * declares the legacy item schema version (1) and the item was upgraded from it by
 * {@link parseVaultItemPlaintext}.
 */
export function vaultItemMatchesRecord(
  item: VaultItem,
  record: { itemId: string; kind: string; schemaVersion: number; revision: number },
  upgradedFromLegacySchemaVersion: boolean,
): boolean {
  return (
    item.id === record.itemId &&
    item.revision === record.revision &&
    item.kind === record.kind &&
    (item.schemaVersion === record.schemaVersion ||
      (upgradedFromLegacySchemaVersion && record.schemaVersion === 1))
  );
}

export const EncryptedHotpReceiptSchema = z.strictObject({
  format: z.literal("shardpass-encrypted-hotp-receipt"),
  formatVersion: z.literal(VAULT_FORMAT_VERSION),
  receiptHash: z.string().check(z.regex(/^[0-9a-f]{64}$/u)),
  nonce: fixedBase64Bytes(24),
  ciphertext: base64Bytes(16, 4096),
  encoding: z.literal("base64"),
});
export const EncryptedGenerationMetadataSchema = z.strictObject({
  format: z.literal("shardpass-encrypted-generation-metadata"),
  formatVersion: z.literal(METADATA_FORMAT_VERSION),
  generationId: ItemIdSchema,
  name: z.enum(GENERATION_METADATA_NAMES),
  schemaVersion: z.literal(1),
  nonce: fixedBase64Bytes(24),
  ciphertext: base64Bytes(16, MAX_GENERATION_METADATA_ENVELOPE_BYTES),
  encoding: z.literal("base64"),
});
export const ManifestEntrySchema = z.strictObject({
  key: z.string().check(z.minLength(1), z.maxLength(512)),
  hash: fixedBase64Bytes(32),
});

export const LegacyUnsignedGenerationManifestSchema = z
  .strictObject({
    format: z.literal("shardpass-generation-manifest"),
    formatVersion: z.literal(LEGACY_VAULT_FORMAT_VERSION),
    root: LegacyVaultRootSchema,
    generation: LegacyVaultGenerationSchema,
    recordEntries: z.array(ManifestEntrySchema).check(z.maxLength(MAX_GENERATION_ENTRIES)),
    journalEntries: z.array(ManifestEntrySchema).check(z.maxLength(MAX_GENERATION_ENTRIES)),
  })
  .check(
    z.refine(
      (manifest) =>
        manifest.generation.recordCount === manifest.recordEntries.length &&
        manifest.generation.journalCount === manifest.journalEntries.length &&
        manifest.generation.entryCount ===
          manifest.recordEntries.length + manifest.journalEntries.length &&
        manifest.generation.entryCount <= MAX_GENERATION_ENTRIES,
      { error: "Legacy generation manifest counts must exactly match entries" },
    ),
  );
const currentManifestCheck = (manifest: {
  generation: {
    recordCount: number;
    journalCount: number;
    receiptCount: number;
    receiptStartSequence: number;
    nextReceiptSequence: number;
    journalStartSequence: number;
    nextJournalSequence: number;
    entryCount: number;
    metadataCount?: number;
  };
  recordEntries: readonly unknown[];
  journalEntries: readonly unknown[];
  receiptEntries: readonly unknown[];
  metadataEntries?: readonly unknown[];
}) =>
  manifest.generation.recordCount === manifest.recordEntries.length &&
  manifest.generation.journalCount === manifest.journalEntries.length &&
  manifest.generation.receiptCount === manifest.receiptEntries.length &&
  (manifest.generation.metadataCount ?? 0) === (manifest.metadataEntries?.length ?? 0) &&
  manifest.generation.nextJournalSequence ===
    manifest.generation.journalStartSequence + manifest.generation.journalCount &&
  manifest.generation.nextReceiptSequence ===
    manifest.generation.receiptStartSequence + manifest.generation.receiptCount &&
  manifest.generation.entryCount ===
    manifest.recordEntries.length +
      manifest.journalEntries.length +
      manifest.receiptEntries.length +
      (manifest.metadataEntries?.length ?? 0) &&
  manifest.generation.entryCount <= MAX_GENERATION_ENTRIES;
const receiptUnsignedFields = {
  format: z.literal("shardpass-generation-manifest"),
  root: ReceiptVaultRootSchema,
  generation: ReceiptVaultGenerationSchema,
  recordEntries: z.array(ManifestEntrySchema).check(z.maxLength(MAX_GENERATION_ENTRIES)),
  journalEntries: z.array(ManifestEntrySchema).check(z.maxLength(MAX_GENERATION_ENTRIES)),
  receiptEntries: z.array(ManifestEntrySchema).check(z.maxLength(MAX_GENERATION_ENTRIES)),
};
export const ReceiptUnsignedGenerationManifestSchema = z
  .strictObject({
    ...receiptUnsignedFields,
    formatVersion: z.literal(RECEIPT_VAULT_FORMAT_VERSION),
  })
  .check(
    z.refine(currentManifestCheck, {
      error: "Generation manifest counts must exactly match bounded entries",
    }),
  );
export const UnsignedGenerationManifestSchema = z
  .strictObject({
    ...receiptUnsignedFields,
    formatVersion: z.literal(VAULT_FORMAT_VERSION),
    root: CurrentVaultRootSchema,
    generation: VaultGenerationSchema,
    metadataEntries: z
      .array(ManifestEntrySchema)
      .check(z.maxLength(GENERATION_METADATA_NAMES.length)),
  })
  .check(
    z.refine(currentManifestCheck, {
      error: "Generation manifest counts must exactly match bounded entries",
    }),
  );

export const ManifestAuthenticationSchema = z.strictObject({
  algorithm: z.literal("xchacha20-poly1305"),
  nonce: fixedBase64Bytes(24),
  ciphertext: fixedBase64Bytes(48),
  encoding: z.literal("base64"),
});
export const LegacyGenerationManifestSchema = z.extend(LegacyUnsignedGenerationManifestSchema, {
  manifestHash: fixedBase64Bytes(32),
  authentication: ManifestAuthenticationSchema,
});
export const ReceiptGenerationManifestSchema = z.extend(ReceiptUnsignedGenerationManifestSchema, {
  manifestHash: fixedBase64Bytes(32),
  authentication: ManifestAuthenticationSchema,
});
export const CurrentGenerationManifestSchema = z.extend(UnsignedGenerationManifestSchema, {
  manifestHash: fixedBase64Bytes(32),
  authentication: ManifestAuthenticationSchema,
});
export const GenerationManifestSchema = z.discriminatedUnion("formatVersion", [
  LegacyGenerationManifestSchema,
  ReceiptGenerationManifestSchema,
  CurrentGenerationManifestSchema,
]);

const markerFields = {
  format: z.literal("shardpass-verified-generation"),
  generationId: ItemIdSchema,
  manifestHash: fixedBase64Bytes(32),
  manifestAuthenticationHash: fixedBase64Bytes(32),
  verifiedAt: ItemTimestampSchema,
  nonce: fixedBase64Bytes(24),
  ciphertext: base64Bytes(16, 1024),
  encoding: z.literal("base64"),
};
export const LegacyVerifiedGenerationSchema = z.strictObject({
  ...markerFields,
  formatVersion: z.literal(LEGACY_VAULT_FORMAT_VERSION),
});
export const ReceiptVerifiedGenerationSchema = z.strictObject({
  ...markerFields,
  formatVersion: z.literal(RECEIPT_VAULT_FORMAT_VERSION),
});
export const CurrentVerifiedGenerationSchema = z.strictObject({
  ...markerFields,
  formatVersion: z.literal(VAULT_FORMAT_VERSION),
});
export const VerifiedGenerationSchema = z.discriminatedUnion("formatVersion", [
  LegacyVerifiedGenerationSchema,
  ReceiptVerifiedGenerationSchema,
  CurrentVerifiedGenerationSchema,
]);

export const ENCRYPTED_RECORD_ASSOCIATED_DATA_FIELDS = Object.freeze([
  "format",
  "formatVersion",
  "itemId",
  "kind",
  "schemaVersion",
  "revision",
] as const);

export type Argon2idParameters = z.infer<typeof Argon2idParametersSchema>;
export type WrappedVaultKey = z.infer<typeof WrappedVaultKeySchema>;
export type LegacyVaultRoot = z.infer<typeof LegacyVaultRootSchema>;
export type CurrentVaultRoot = z.infer<typeof CurrentVaultRootSchema>;
export type VaultRoot = z.infer<typeof VaultRootSchema>;
export type LegacyVaultGeneration = z.infer<typeof LegacyVaultGenerationSchema>;
export type VaultGeneration = z.infer<typeof VaultGenerationSchema>;
export type EncryptedRecord = z.infer<typeof EncryptedRecordSchema>;
export type EncryptedJournalRecord = z.infer<typeof EncryptedJournalRecordSchema>;
export type EncryptedHotpReceipt = z.infer<typeof EncryptedHotpReceiptSchema>;
export type EncryptedGenerationMetadata = z.infer<typeof EncryptedGenerationMetadataSchema>;
export type GenerationMetadataName = (typeof GENERATION_METADATA_NAMES)[number];
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;
export type LegacyUnsignedGenerationManifest = z.infer<
  typeof LegacyUnsignedGenerationManifestSchema
>;
export type ReceiptUnsignedGenerationManifest = z.infer<
  typeof ReceiptUnsignedGenerationManifestSchema
>;
export type UnsignedGenerationManifest = z.infer<typeof UnsignedGenerationManifestSchema>;
export type LegacyGenerationManifest = z.infer<typeof LegacyGenerationManifestSchema>;
export type CurrentGenerationManifest = z.infer<typeof CurrentGenerationManifestSchema>;
export type GenerationManifest = z.infer<typeof GenerationManifestSchema>;
export type VerifiedGeneration = z.infer<typeof VerifiedGenerationSchema>;
