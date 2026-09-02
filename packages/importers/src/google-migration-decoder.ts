import { clone, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  isCanonicalUnpaddedBase32,
  isUnicodeScalarText,
  MAX_OTP_ISSUER_LENGTH,
  MAX_OTP_LABEL_LENGTH,
  MAX_OTP_SECRET_LENGTH,
} from "@shardpass/domain";

import {
  Algorithm,
  DigitCount,
  MigrationPayloadSchema,
  OtpType,
  type MigrationPayload,
  type OtpParameters,
} from "./generated/google-authenticator-migration_pb";
import {
  IMPORT_LIMITS,
  type ImportReasonCode,
  type OtpImportCandidate,
  type ParsedOtpImport,
} from "./import-model";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

type ParserFailureCode = Extract<
  ImportReasonCode,
  "IMPORT_MALFORMED" | "IMPORT_UNSUPPORTED" | "IMPORT_LIMIT_EXCEEDED"
>;

type DecodedBatch = Readonly<{
  batchId: number;
  batchIndex: number;
  batchSize: number;
  payload: MigrationPayload;
}>;

class GoogleMigrationParseError extends Error {
  readonly code: ParserFailureCode;

  constructor(code: ParserFailureCode) {
    super(code);
    this.name = "GoogleMigrationParseError";
    this.code = code;
  }
}

const fail = (code: ParserFailureCode): never => {
  throw new GoogleMigrationParseError(code);
};

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function hasUnknownFields(message: {
  readonly $unknown?: readonly unknown[] | undefined;
}): boolean {
  return (message.$unknown?.length ?? 0) !== 0;
}

type ClearOwnedBytes = (bytes: Uint8Array) => void;

export type GoogleMigrationCanonicalSerializer = (decoded: MigrationPayload) => Uint8Array;

type CanonicalClearObserver = (bytes: Uint8Array) => void;

const clearOwnedBytes: ClearOwnedBytes = (bytes) => bytes.fill(0);

const serializeCanonical: GoogleMigrationCanonicalSerializer = (decoded) =>
  toBinary(MigrationPayloadSchema, decoded, { writeUnknownFields: true });

function clearCanonicalBestEffort(canonical: Uint8Array, observer?: CanonicalClearObserver): void {
  try {
    canonical.fill(0);
  } catch {
    // Best-effort cleanup must not replace parser behavior.
  }
  try {
    observer?.(canonical);
  } catch {
    // Test observation must not replace parser behavior or block other cleanup.
  }
}

function decodeBatch(
  bytes: Uint8Array,
  clear: ClearOwnedBytes,
  canonicalSerializer: GoogleMigrationCanonicalSerializer,
  canonicalClearObserver?: CanonicalClearObserver,
): DecodedBatch {
  let decoded: MigrationPayload | null = null;
  try {
    try {
      decoded = fromBinary(MigrationPayloadSchema, bytes, {
        readUnknownFields: true,
      });
    } catch {
      return fail("IMPORT_MALFORMED");
    }
    if (hasUnknownFields(decoded) || decoded.otpParameters.some(hasUnknownFields))
      fail("IMPORT_MALFORMED");
    if (decoded.version !== 1) fail("IMPORT_UNSUPPORTED");
    if (
      !Number.isInteger(decoded.batchSize) ||
      !Number.isInteger(decoded.batchIndex) ||
      !Number.isInteger(decoded.batchId) ||
      decoded.batchSize < 1 ||
      decoded.batchIndex < 0 ||
      decoded.batchIndex >= decoded.batchSize ||
      decoded.batchId === 0
    )
      fail("IMPORT_MALFORMED");
    if (decoded.batchSize > IMPORT_LIMITS.maxMigrationBatches) fail("IMPORT_LIMIT_EXCEEDED");
    const canonical = canonicalSerializer(decoded);
    try {
      if (!equalBytes(bytes, canonical)) fail("IMPORT_MALFORMED");
    } finally {
      clearCanonicalBestEffort(canonical, canonicalClearObserver);
    }
    if (decoded.otpParameters.length > IMPORT_LIMITS.maxEntries) fail("IMPORT_LIMIT_EXCEEDED");
    const payload = clone(MigrationPayloadSchema, decoded);
    return Object.freeze({
      batchId: payload.batchId,
      batchIndex: payload.batchIndex,
      batchSize: payload.batchSize,
      payload,
    });
  } finally {
    if (decoded !== null) {
      for (const parameter of decoded.otpParameters) clear(parameter.secret);
    }
    clear(bytes);
  }
}

function encodeCanonicalBase32(bytes: Uint8Array): string {
  let output = "";
  let accumulator = 0;
  let bits = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(accumulator >>> bits) & 31];
      accumulator &= (1 << bits) - 1;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(accumulator << (5 - bits)) & 31];
  return output;
}

function validText(value: string, minimum: number, maximum: number): boolean {
  return (
    value.length >= minimum &&
    value.length <= maximum &&
    value === value.trim() &&
    !value.includes("\uFFFD") &&
    isUnicodeScalarText(value)
  );
}

function mapAlgorithm(value: Algorithm): "SHA1" | "SHA256" | "SHA512" {
  if (value === Algorithm.SHA1) return "SHA1";
  if (value === Algorithm.SHA256) return "SHA256";
  if (value === Algorithm.SHA512) return "SHA512";
  return fail("IMPORT_UNSUPPORTED");
}

function mapDigits(value: DigitCount): 6 | 8 {
  if (value === DigitCount.SIX) return 6;
  if (value === DigitCount.EIGHT) return 8;
  return fail("IMPORT_UNSUPPORTED");
}

function convertParameter(parameter: OtpParameters): OtpImportCandidate {
  if (
    parameter.secret.length === 0 ||
    !validText(parameter.name, 1, MAX_OTP_LABEL_LENGTH) ||
    !validText(parameter.issuer, 0, MAX_OTP_ISSUER_LENGTH)
  )
    fail("IMPORT_MALFORMED");
  const secret = encodeCanonicalBase32(parameter.secret);
  if (
    secret.length === 0 ||
    secret.length > MAX_OTP_SECRET_LENGTH ||
    !isCanonicalUnpaddedBase32(secret)
  )
    fail("IMPORT_MALFORMED");
  const algorithm = mapAlgorithm(parameter.algorithm);
  const digits = mapDigits(parameter.digits);
  if (parameter.type !== OtpType.HOTP && parameter.type !== OtpType.TOTP)
    fail("IMPORT_UNSUPPORTED");
  if (parameter.counter < 0n || parameter.counter > BigInt(Number.MAX_SAFE_INTEGER))
    fail("IMPORT_UNSUPPORTED");

  const candidate: OtpImportCandidate = {
    issuer: parameter.issuer,
    label: parameter.name,
    secret,
    otpType: parameter.type === OtpType.HOTP ? "hotp" : "totp",
    algorithm,
    digits,
    period: parameter.type === OtpType.HOTP ? 0 : 30,
    ...(parameter.type === OtpType.HOTP ? { counter: Number(parameter.counter) } : {}),
    favorite: false,
    tags: Object.freeze([]),
    note: "",
  };
  return Object.freeze(candidate);
}

export function decodeGoogleMigrationPayloads(
  payloads: readonly Uint8Array[],
  clear: ClearOwnedBytes = clearOwnedBytes,
  canonicalSerializer: GoogleMigrationCanonicalSerializer = serializeCanonical,
  canonicalClearObserver?: CanonicalClearObserver,
): ParsedOtpImport {
  if (payloads.length === 0) fail("IMPORT_MALFORMED");
  if (payloads.length > IMPORT_LIMITS.maxMigrationBatches) fail("IMPORT_LIMIT_EXCEEDED");
  const batches: DecodedBatch[] = [];
  try {
    for (const payload of payloads)
      batches.push(decodeBatch(payload, clear, canonicalSerializer, canonicalClearObserver));
    const first = batches[0]!;
    if (first.batchSize !== batches.length) fail("IMPORT_MALFORMED");
    const indexes = new Set<number>();
    for (const [position, batch] of batches.entries()) {
      if (
        batch.batchSize !== first.batchSize ||
        batch.batchId !== first.batchId ||
        batch.batchIndex !== position ||
        indexes.has(batch.batchIndex)
      )
        fail("IMPORT_MALFORMED");
      indexes.add(batch.batchIndex);
    }

    let total = 0;
    for (const batch of batches) {
      total += batch.payload.otpParameters.length;
      if (total > IMPORT_LIMITS.maxEntries) fail("IMPORT_LIMIT_EXCEEDED");
    }

    const candidates: OtpImportCandidate[] = [];
    const rejected: { ordinal: number; reason: ImportReasonCode }[] = [];
    let ordinal = 0;
    for (const batch of batches) {
      for (const parameter of batch.payload.otpParameters) {
        ordinal += 1;
        try {
          candidates.push(
            Object.freeze({ ...convertParameter(parameter), sourceOrdinal: ordinal }),
          );
        } catch (error) {
          const reason =
            error instanceof GoogleMigrationParseError ? error.code : "IMPORT_MALFORMED";
          rejected.push(
            Object.freeze({
              ordinal,
              reason:
                reason === "IMPORT_LIMIT_EXCEEDED"
                  ? reason
                  : reason === "IMPORT_UNSUPPORTED"
                    ? reason
                    : "IMPORT_MALFORMED",
            }),
          );
        }
      }
    }
    return Object.freeze({
      format: "google-migration",
      candidates: Object.freeze(candidates),
      rejected: Object.freeze(rejected),
    });
  } finally {
    for (const batch of batches) {
      for (const parameter of batch.payload.otpParameters) clear(parameter.secret);
    }
    for (const payload of payloads) clear(payload);
  }
}
