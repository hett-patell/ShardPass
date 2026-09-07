import {
  isCanonicalUnpaddedBase32,
  isUnicodeScalarText,
  MAX_ITEM_TAG_LENGTH,
  MAX_ITEM_TAGS,
  MAX_OTP_ISSUER_LENGTH,
  MAX_OTP_LABEL_LENGTH,
  MAX_OTP_NOTE_LENGTH,
  MAX_OTP_PERIOD_SECONDS,
  MAX_OTP_SECRET_LENGTH,
} from "@shardpass/domain";
import { z } from "zod/mini";

export const IMPORT_LIMITS = Object.freeze({
  maxInputBytes: 1_048_576,
  maxTextScalars: 262_144,
  maxEntries: 1_000,
  /** Password-manager exports run far past the OTP ceiling; the dialog batches them in hundreds. */
  maxThirdPartyEntries: 5_000,
  maxMigrationBatches: 16,
  maxImageBytes: 8_388_608,
  maxImageDimension: 4_096,
  maxImagePixels: 16_777_216,
  maxQrPayloadBytes: 1_048_576,
  previewTtlMs: 300_000,
  maxPreviewsPerDocument: 4,
  maxLivePreviews: 32,
} as const);

export type ImportSourceFormat = "otpauth" | "google-migration" | "aegis" | "ente" | "qr";
export type ImportRowStatus = "accepted" | "duplicate" | "rejected";
export type ImportReasonCode =
  | "IMPORT_ACCEPTED"
  | "IMPORT_DUPLICATE_VAULT"
  | "IMPORT_DUPLICATE_BATCH"
  | "IMPORT_MALFORMED"
  | "IMPORT_UNSUPPORTED"
  | "IMPORT_LIMIT_EXCEEDED";

export type OtpImportCandidate = Readonly<{
  sourceOrdinal?: number;
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

export type SafeImportMetadata = Readonly<{
  issuer: string;
  label: string;
  otpType: "totp" | "hotp" | "steam";
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: number;
  period: number;
  counter?: number;
}>;

export type ImportPreviewRow = Readonly<{
  rowId: string;
  ordinal: number;
  status: ImportRowStatus;
  reason: ImportReasonCode;
  metadata: SafeImportMetadata | null;
}>;

export type ParsedOtpImport = Readonly<{
  format: ImportSourceFormat;
  candidates: readonly OtpImportCandidate[];
  rejected: readonly Readonly<{ ordinal: number; reason: ImportReasonCode }>[];
}>;

const unicodeString = (maximum: number) =>
  z.string().check(z.maxLength(maximum), z.refine(isUnicodeScalarText));
const trimmedUnicodeString = (minimum: number, maximum: number) =>
  unicodeString(maximum).check(
    z.minLength(minimum),
    z.refine((value) => value === value.trim()),
  );
const nonnegativeSafeInteger = z.int().check(z.nonnegative(), z.maximum(Number.MAX_SAFE_INTEGER));
const tagSchema = trimmedUnicodeString(1, MAX_ITEM_TAG_LENGTH);
const tagsSchema = z.array(tagSchema).check(
  z.maxLength(MAX_ITEM_TAGS),
  z.refine(
    (tags) =>
      new Set(tags.map((tag) => tag.normalize("NFKC").toLocaleLowerCase("en-US"))).size ===
      tags.length,
  ),
);

const OtpImportCandidateSchema = z
  .strictObject({
    sourceOrdinal: z.optional(z.int().check(z.positive(), z.maximum(IMPORT_LIMITS.maxEntries))),
    issuer: trimmedUnicodeString(0, MAX_OTP_ISSUER_LENGTH),
    label: trimmedUnicodeString(1, MAX_OTP_LABEL_LENGTH),
    secret: z
      .string()
      .check(
        z.minLength(1),
        z.maxLength(MAX_OTP_SECRET_LENGTH),
        z.refine(isCanonicalUnpaddedBase32),
      ),
    otpType: z.enum(["totp", "hotp", "steam"]),
    algorithm: z.enum(["SHA1", "SHA256", "SHA512"]),
    digits: z.int().check(z.minimum(5), z.maximum(10)),
    period: z.int().check(z.nonnegative(), z.maximum(MAX_OTP_PERIOD_SECONDS)),
    counter: z.optional(nonnegativeSafeInteger),
    favorite: z.boolean(),
    tags: tagsSchema,
    note: unicodeString(MAX_OTP_NOTE_LENGTH),
  })
  .check(
    z.refine((candidate) =>
      candidate.otpType === "hotp"
        ? candidate.counter !== undefined && candidate.period === 0
        : candidate.counter === undefined && candidate.period > 0,
    ),
    z.refine((candidate) =>
      candidate.otpType === "steam"
        ? candidate.algorithm === "SHA1" && candidate.digits === 5 && candidate.period === 30
        : candidate.digits >= 6,
    ),
  );

const ROW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,255}$/u;
const INVALID_CANDIDATE_MESSAGE = "Invalid OTP import candidate.";
const INVALID_ROW_ID_MESSAGE = "Invalid OTP import row ID.";
const LIMIT_EXCEEDED_MESSAGE = "OTP import limit exceeded.";

function parseCandidate(candidate: OtpImportCandidate): OtpImportCandidate {
  const parsed = OtpImportCandidateSchema.safeParse(candidate);
  if (!parsed.success) throw new TypeError(INVALID_CANDIDATE_MESSAGE);
  const result: OtpImportCandidate = {
    ...(parsed.data.sourceOrdinal === undefined
      ? {}
      : { sourceOrdinal: parsed.data.sourceOrdinal }),
    issuer: parsed.data.issuer,
    label: parsed.data.label,
    secret: parsed.data.secret,
    otpType: parsed.data.otpType,
    algorithm: parsed.data.algorithm,
    digits: parsed.data.digits,
    period: parsed.data.period,
    ...(parsed.data.counter === undefined ? {} : { counter: parsed.data.counter }),
    favorite: parsed.data.favorite,
    tags: Object.freeze([...parsed.data.tags]),
    note: parsed.data.note,
  };
  return Object.freeze(result);
}

function haveEqualSemanticFields(left: OtpImportCandidate, right: OtpImportCandidate): boolean {
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

export function hasSameOtpSemanticKey(
  left: OtpImportCandidate,
  right: OtpImportCandidate,
): boolean {
  return haveEqualSemanticFields(parseCandidate(left), parseCandidate(right));
}

export function safeImportMetadata(candidate: OtpImportCandidate): SafeImportMetadata {
  const parsed = parseCandidate(candidate);
  const metadata: SafeImportMetadata = {
    issuer: parsed.issuer,
    label: parsed.label,
    otpType: parsed.otpType,
    algorithm: parsed.algorithm,
    digits: parsed.digits,
    period: parsed.period,
    ...(parsed.counter === undefined ? {} : { counter: parsed.counter }),
  };
  return Object.freeze(metadata);
}

export function classifyImportCandidates(
  candidates: readonly OtpImportCandidate[],
  existing: readonly OtpImportCandidate[],
  ids: readonly string[],
): readonly ImportPreviewRow[] {
  if (candidates.length > IMPORT_LIMITS.maxEntries) throw new RangeError(LIMIT_EXCEEDED_MESSAGE);
  if (ids.length !== candidates.length) throw new TypeError(INVALID_ROW_ID_MESSAGE);

  const uniqueIds = new Set<string>();
  for (const id of ids) {
    if (!ROW_ID_PATTERN.test(id) || uniqueIds.has(id)) throw new TypeError(INVALID_ROW_ID_MESSAGE);
    uniqueIds.add(id);
  }

  const parsedCandidates = candidates.map(parseCandidate);
  const parsedExisting = existing.map(parseCandidate);
  const accepted: OtpImportCandidate[] = [];
  const rows = parsedCandidates.map((entry, index): ImportPreviewRow => {
    const inVault = parsedExisting.some((stored) => haveEqualSemanticFields(entry, stored));
    const inBatch = accepted.some((prior) => haveEqualSemanticFields(entry, prior));
    const status: ImportRowStatus = inVault || inBatch ? "duplicate" : "accepted";
    const reason: ImportReasonCode = inVault
      ? "IMPORT_DUPLICATE_VAULT"
      : inBatch
        ? "IMPORT_DUPLICATE_BATCH"
        : "IMPORT_ACCEPTED";
    if (status === "accepted") accepted.push(entry);

    return Object.freeze({
      rowId: ids[index]!,
      ordinal: entry.sourceOrdinal ?? index + 1,
      status,
      reason,
      metadata: safeImportMetadata(entry),
    });
  });

  return Object.freeze(rows);
}

export function redactImportBuffer(buffer: Uint8Array): void {
  buffer.fill(0);
}
