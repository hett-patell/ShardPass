import {
  AEAD_TAG_BYTES,
  ARGON2ID_SALT_BYTES,
  DEFAULT_ARGON2ID_PARAMETERS,
  deriveKeyEncryptionKey,
  encryptEnvelope,
  type Argon2idWorkParameters,
  type KdfExecutor,
  type RandomSource,
  webCryptoRandomSource,
} from "@shardpass/crypto";

import {
  BACKUP_V2_LIMITS,
  PortableBackupPayloadSchema,
  type PortableBackupPayload,
  type PortableBackupPayloadVersion,
} from "./model";
import {
  encodeBackupV2Envelope,
  encodeBackupV2Header,
  type BackupV2Envelope,
  type BackupV2Header,
} from "./v2-format";

const encoder = new TextEncoder();

export type BackupCryptoOptions = Readonly<{
  random?: RandomSource;
  kdfParameters?: Argon2idWorkParameters;
}>;

export async function exportPortableBackup(
  input: PortableBackupPayload,
  password: Uint8Array,
  executor: KdfExecutor,
  options: BackupCryptoOptions = {},
): Promise<Uint8Array> {
  if (!(password instanceof Uint8Array)) throw new Error("Invalid backup input.");
  const payload = parsePayload(input);
  const parameters = options.kdfParameters ?? DEFAULT_ARGON2ID_PARAMETERS;
  const random = options.random ?? webCryptoRandomSource;
  const privatePassword = password.slice();
  let salt: Uint8Array | undefined;
  let key: Uint8Array | undefined;
  let plaintext: Uint8Array | undefined;
  try {
    plaintext = encodeCanonicalPayload(payload);
    if (plaintext.byteLength > BACKUP_V2_LIMITS.maxCiphertextBytes - AEAD_TAG_BYTES) {
      throw new Error("Backup creation failed.");
    }
    assertEnvelopeSizeFeasible(
      parameters,
      plaintext.byteLength + AEAD_TAG_BYTES,
      payload.schemaVersion,
    );
    salt = random.randomBytes(ARGON2ID_SALT_BYTES);
    if (salt.byteLength !== ARGON2ID_SALT_BYTES) throw new Error("Backup creation failed.");
    const kdfSalt = salt.slice();
    try {
      key = await deriveKeyEncryptionKey(executor, privatePassword, parameters, kdfSalt);
    } finally {
      kdfSalt.fill(0);
    }
    const nonceSource = captureNonce(random);
    const header: BackupV2Header = {
      type: "shardpass-backup",
      formatVersion: 2,
      payloadSchemaVersion: payload.schemaVersion,
      kdf: {
        algorithm: "argon2id",
        version: 19,
        memoryKiB: parameters.memoryKiB,
        iterations: parameters.iterations,
        parallelism: parameters.parallelism,
        salt: encodeBase64(salt),
      },
      cipher: {
        algorithm: "xchacha20-poly1305",
        nonce: encodeBase64(nonceSource.nonce),
      },
    };
    const aad = encodeBackupV2Header(header);
    try {
      const encrypted = await encryptEnvelope(key, plaintext, aad, nonceSource.random);
      return encodeBackupV2Envelope({ ...header, ciphertext: encodeBase64(encrypted.ciphertext) });
    } finally {
      aad.fill(0);
      nonceSource.nonce.fill(0);
    }
  } catch {
    throw new Error("Backup creation failed.");
  } finally {
    privatePassword.fill(0);
    salt?.fill(0);
    key?.fill(0);
    plaintext?.fill(0);
  }
}

/**
 * One fixed field order per payload version, so the decrypted bytes can be compared
 * against a re-encoding of what they parsed to. Inside the payload every object's keys
 * are sorted: the schema's own key order changes whenever a field is added, and a file
 * written before such a change must still compare equal.
 */
export function encodeCanonicalPayload(input: PortableBackupPayload): Uint8Array {
  return encoder.encode(JSON.stringify(sortKeysDeep(orderedPayload(parsePayload(input)))));
}

/**
 * The encoding used by builds before keys were sorted (schema key order); a file written
 * by one of them is still accepted by comparing against this form as well.
 */
export function encodeLegacyCanonicalPayload(input: PortableBackupPayload): Uint8Array {
  return encoder.encode(JSON.stringify(orderedPayload(parsePayload(input))));
}

function orderedPayload(payload: PortableBackupPayload): Record<string, unknown> {
  return payload.schemaVersion === 1
    ? {
        schemaVersion: payload.schemaVersion,
        exportedAt: payload.exportedAt,
        items: payload.items,
        settings: payload.settings,
        history: payload.history,
      }
    : {
        schemaVersion: payload.schemaVersion,
        exportedAt: payload.exportedAt,
        items: payload.items,
        folders: payload.folders,
        settings: payload.settings,
        history: payload.history,
      };
}

/** Objects get their keys in code-unit order, at every depth; arrays keep their order. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) sorted[key] = sortKeysDeep(record[key]);
  return sorted;
}

function parsePayload(input: unknown): PortableBackupPayload {
  const parsed = PortableBackupPayloadSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid backup payload.");
  return parsed.data;
}

function assertEnvelopeSizeFeasible(
  parameters: Argon2idWorkParameters,
  ciphertextBytes: number,
  payloadSchemaVersion: PortableBackupPayloadVersion,
): void {
  const placeholder = "A".repeat(Math.ceil(ciphertextBytes / 3) * 4);
  const envelope: BackupV2Envelope = {
    type: "shardpass-backup",
    formatVersion: 2,
    payloadSchemaVersion,
    kdf: {
      algorithm: "argon2id",
      version: 19,
      memoryKiB: parameters.memoryKiB,
      iterations: parameters.iterations,
      parallelism: parameters.parallelism,
      salt: "A".repeat(24),
    },
    cipher: {
      algorithm: "xchacha20-poly1305",
      nonce: "A".repeat(32),
    },
    ciphertext: placeholder,
  };
  if (encoder.encode(JSON.stringify(envelope)).byteLength > BACKUP_V2_LIMITS.maxEnvelopeBytes) {
    throw new Error("Backup creation failed.");
  }
}

function captureNonce(random: RandomSource): { nonce: Uint8Array; random: RandomSource } {
  const nonce = random.randomBytes(24);
  if (nonce.byteLength !== 24) throw new Error("Backup creation failed.");
  return {
    nonce,
    random: {
      randomBytes(length) {
        if (length !== 24) throw new Error("Backup creation failed.");
        return nonce.slice();
      },
    },
  };
}

export function encodeBase64(value: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < value.byteLength; offset += 32_768) {
    chunks.push(String.fromCharCode(...value.subarray(offset, offset + 32_768)));
  }
  return btoa(chunks.join(""));
}
