import {
  MAX_ITEM_TAG_LENGTH,
  MAX_ITEM_TAGS,
  MAX_OTP_ISSUER_LENGTH,
  MAX_OTP_LABEL_LENGTH,
  MAX_OTP_NOTE_LENGTH,
  MAX_OTP_SECRET_LENGTH,
} from "@shardpass/domain";
import { isCanonicalBase64 } from "@shardpass/security";
import { z } from "zod/mini";

export const LEGACY_PBKDF2_ITERATIONS = 600_000;
export const MAX_LEGACY_ACCOUNTS = 10_000;
export const MAX_LEGACY_CIPHERTEXT_BYTES = 2 * 1024 * 1024;
export const MAX_LEGACY_PASSWORD_UTF8_BYTES = 1024;
export const MAX_LEGACY_EPOCH_MS = 253_402_300_799_999;

const scalarText = (maximum: number) =>
  z.string().check(
    z.maxLength(maximum),
    z.refine((value) => !/[\uD800-\uDFFF]/u.test(value), { error: "Invalid text" }),
  );
const positiveTimestamp = z
  .number()
  .check(z.int(), z.nonnegative(), z.maximum(MAX_LEGACY_EPOCH_MS));
const canonicalBase64 = (bytes: number) =>
  z.string().check(z.refine((value) => isCanonicalBase64(value, bytes, bytes)));
const boundedCiphertext = z
  .string()
  .check(z.refine((value) => isCanonicalBase64(value, 16, MAX_LEGACY_CIPHERTEXT_BYTES)));

export const LegacyEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  salt: canonicalBase64(16),
  iv: canonicalBase64(12),
  ciphertext: boundedCiphertext,
  iterations: z.literal(LEGACY_PBKDF2_ITERATIONS),
  createdAt: positiveTimestamp,
  updatedAt: positiveTimestamp,
});

export const LegacyAccountSchema = z.strictObject({
  id: scalarText(256).check(z.minLength(1)),
  createdAt: positiveTimestamp,
  issuer: scalarText(MAX_OTP_ISSUER_LENGTH),
  label: scalarText(MAX_OTP_LABEL_LENGTH).check(z.minLength(1)),
  secret: z.string().check(z.minLength(1), z.maxLength(MAX_OTP_SECRET_LENGTH)),
  algorithm: z.enum(["SHA1", "SHA256", "SHA512"]),
  digits: z.int().check(z.minimum(5), z.maximum(10)),
  period: z.int().check(z.nonnegative(), z.maximum(300)),
  type: z.optional(z.enum(["totp", "hotp", "steam"])),
  counter: z.optional(z.int().check(z.nonnegative(), z.maximum(Number.MAX_SAFE_INTEGER))),
  note: z.optional(scalarText(MAX_OTP_NOTE_LENGTH)),
  tags: z.optional(
    z
      .array(scalarText(MAX_ITEM_TAG_LENGTH).check(z.minLength(1)))
      .check(z.maxLength(MAX_ITEM_TAGS)),
  ),
});

const LegacyPendingOperationSchema = z.strictObject({
  op: z.enum(["create", "update", "delete"]),
  accountId: scalarText(256).check(z.minLength(1)),
  enteId: z.optional(scalarText(1024).check(z.minLength(1))),
  enqueuedAt: positiveTimestamp,
  attempts: z.int().check(z.nonnegative(), z.maximum(Number.MAX_SAFE_INTEGER)),
});
export const LegacyEnteStateSchema = z.strictObject({
  email: scalarText(1024).check(z.minLength(1)),
  serverUrl: scalarText(2048).check(z.minLength(1)),
  authToken: scalarText(16_384).check(z.minLength(1)),
  masterKey: scalarText(16_384).check(z.minLength(1)),
  authenticatorKey: z.optional(scalarText(16_384).check(z.minLength(1))),
  entityMap: z.record(
    scalarText(1024).check(z.minLength(1)),
    scalarText(256).check(z.minLength(1)),
  ),
  pending: z.optional(
    z.array(LegacyPendingOperationSchema).check(z.maxLength(MAX_LEGACY_ACCOUNTS)),
  ),
  lastSync: z.optional(positiveTimestamp),
  lastError: z.optional(scalarText(4096)),
  needsReauth: z.optional(z.boolean()),
});
export const LegacyPlaintextVaultSchema = z.strictObject({
  version: z.literal(1),
  accounts: z.array(z.unknown()).check(z.maxLength(MAX_LEGACY_ACCOUNTS)),
  integrations: z.optional(z.strictObject({ ente: LegacyEnteStateSchema })),
});

export type LegacyEnvelope = z.infer<typeof LegacyEnvelopeSchema>;
export type LegacyAccount = z.infer<typeof LegacyAccountSchema>;
export type LegacyEnteState = z.infer<typeof LegacyEnteStateSchema>;
export type LegacyPlaintextVault = z.infer<typeof LegacyPlaintextVaultSchema>;
