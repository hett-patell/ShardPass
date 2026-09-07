import { validateArgon2idWorkParameters } from "@shardpass/crypto";
import { decodeCanonicalBase64 } from "@shardpass/security";
import { z } from "zod/mini";

import { BACKUP_V2_LIMITS, type PortableBackupPayloadVersion } from "./model";

const encoder = new TextEncoder();
const fatalDecoder = new TextDecoder("utf-8", { fatal: true });

const canonicalBase64 = (minimumBytes: number, maximumBytes: number) =>
  z.string().check(
    z.refine((value) => decodeCanonicalBase64(value, minimumBytes, maximumBytes) !== null, {
      error: "Invalid backup encoding",
    }),
  );

const BackupV2HeaderSchema = z.strictObject({
  type: z.literal("shardpass-backup"),
  formatVersion: z.literal(2),
  payloadSchemaVersion: z.union([z.literal(1), z.literal(2)]),
  kdf: z.strictObject({
    algorithm: z.literal("argon2id"),
    version: z.literal(19),
    memoryKiB: z.int(),
    iterations: z.int(),
    parallelism: z.int(),
    salt: canonicalBase64(16, 16),
  }),
  cipher: z.strictObject({
    algorithm: z.literal("xchacha20-poly1305"),
    nonce: canonicalBase64(24, 24),
  }),
});

const BackupV2EnvelopeSchema = z.extend(BackupV2HeaderSchema, {
  ciphertext: canonicalBase64(16, BACKUP_V2_LIMITS.maxCiphertextBytes),
});

export type BackupV2Header = Readonly<{
  type: "shardpass-backup";
  formatVersion: 2;
  payloadSchemaVersion: PortableBackupPayloadVersion;
  kdf: Readonly<{
    algorithm: "argon2id";
    version: 19;
    memoryKiB: number;
    iterations: number;
    parallelism: number;
    salt: string;
  }>;
  cipher: Readonly<{
    algorithm: "xchacha20-poly1305";
    nonce: string;
  }>;
}>;
export type BackupV2Envelope = Readonly<BackupV2Header & { ciphertext: string }>;

export function encodeBackupV2Header(candidate: BackupV2Header): Uint8Array {
  const header = parseHeader(candidate);
  return encoder.encode(
    JSON.stringify({
      type: header.type,
      formatVersion: header.formatVersion,
      payloadSchemaVersion: header.payloadSchemaVersion,
      kdf: {
        algorithm: header.kdf.algorithm,
        version: header.kdf.version,
        memoryKiB: header.kdf.memoryKiB,
        iterations: header.kdf.iterations,
        parallelism: header.kdf.parallelism,
        salt: header.kdf.salt,
      },
      cipher: {
        algorithm: header.cipher.algorithm,
        nonce: header.cipher.nonce,
      },
    }),
  );
}

export function encodeBackupV2Envelope(candidate: BackupV2Envelope): Uint8Array {
  const envelope = parseEnvelopeObject(candidate);
  return encoder.encode(
    JSON.stringify({
      type: envelope.type,
      formatVersion: envelope.formatVersion,
      payloadSchemaVersion: envelope.payloadSchemaVersion,
      kdf: {
        algorithm: envelope.kdf.algorithm,
        version: envelope.kdf.version,
        memoryKiB: envelope.kdf.memoryKiB,
        iterations: envelope.kdf.iterations,
        parallelism: envelope.kdf.parallelism,
        salt: envelope.kdf.salt,
      },
      cipher: {
        algorithm: envelope.cipher.algorithm,
        nonce: envelope.cipher.nonce,
      },
      ciphertext: envelope.ciphertext,
    }),
  );
}

export function parseBackupV2Envelope(input: string | Uint8Array): BackupV2Envelope {
  const encoded = typeof input === "string" ? encoder.encode(input) : input;
  if (encoded.byteLength === 0 || encoded.byteLength > BACKUP_V2_LIMITS.maxEnvelopeBytes) {
    throw new Error("Invalid backup format.");
  }
  let decoded: string;
  let candidate: unknown;
  try {
    decoded = fatalDecoder.decode(encoded);
    candidate = JSON.parse(decoded);
  } catch {
    throw new Error("Invalid backup format.");
  }
  const envelope = parseEnvelopeObject(candidate);
  const canonical = encodeBackupV2Envelope(envelope);
  if (!equalBytes(encoded, canonical)) throw new Error("Invalid backup format.");
  return envelope;
}

function parseHeader(candidate: unknown): BackupV2Header {
  const parsed = BackupV2HeaderSchema.safeParse(candidate);
  if (!parsed.success) throw new Error("Invalid backup format.");
  try {
    validateArgon2idWorkParameters(parsed.data.kdf);
  } catch {
    throw new Error("Invalid backup format.");
  }
  return parsed.data;
}

function parseEnvelopeObject(candidate: unknown): BackupV2Envelope {
  const parsed = BackupV2EnvelopeSchema.safeParse(candidate);
  if (!parsed.success) throw new Error("Invalid backup format.");
  parseHeader({
    type: parsed.data.type,
    formatVersion: parsed.data.formatVersion,
    payloadSchemaVersion: parsed.data.payloadSchemaVersion,
    kdf: parsed.data.kdf,
    cipher: parsed.data.cipher,
  });
  return parsed.data;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}
