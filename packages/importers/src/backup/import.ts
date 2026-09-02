import { decryptEnvelope, deriveKeyEncryptionKey, type KdfExecutor } from "@shardpass/crypto";
import { decodeCanonicalBase64 } from "@shardpass/security";
import { z } from "zod/mini";

import { decryptLegacyVault, mapLegacyAccount, MAX_LEGACY_CIPHERTEXT_BYTES } from "../legacy-v1";
import { encodeCanonicalPayload } from "./export";
import {
  PortableBackupPayloadSchema,
  type ImportedPortableBackup,
  type PortableBackupPayload,
} from "./model";
import { encodeBackupV2Header, parseBackupV2Envelope, type BackupV2Header } from "./v2-format";

const fatalDecoder = new TextDecoder("utf-8", { fatal: true });
const MAX_LEGACY_BASE64_CIPHERTEXT_LENGTH = Math.ceil(MAX_LEGACY_CIPHERTEXT_BYTES / 3) * 4;
export const MAX_LEGACY_BACKUP_ENVELOPE_BYTES = MAX_LEGACY_BASE64_CIPHERTEXT_LENGTH + 4_096;

export type BackupImportOptions = Readonly<{
  signal?: AbortSignal;
}>;

export async function importPortableBackup(
  input: Uint8Array,
  password: Uint8Array,
  executor: KdfExecutor,
  options: BackupImportOptions = {},
): Promise<ImportedPortableBackup> {
  if (!(input instanceof Uint8Array) || !(password instanceof Uint8Array)) {
    throw new Error("Invalid backup format.");
  }
  const envelope = parseBackupV2Envelope(input);
  const salt = decodeCanonicalBase64(envelope.kdf.salt, 16, 16);
  const nonce = decodeCanonicalBase64(envelope.cipher.nonce, 24, 24);
  const ciphertext = decodeCanonicalBase64(envelope.ciphertext, 16, 8_000_000);
  if (salt === null || nonce === null || ciphertext === null) {
    throw new Error("Invalid backup format.");
  }
  const privatePassword = password.slice();
  const kdfSalt = salt.slice();
  let key: Uint8Array | undefined;
  let plaintext: Uint8Array | undefined;
  let canonical: Uint8Array | undefined;
  let aad: Uint8Array | undefined;
  try {
    key = await deriveKeyEncryptionKey(
      executor,
      privatePassword,
      {
        algorithm: "argon2id",
        memoryKiB: envelope.kdf.memoryKiB,
        iterations: envelope.kdf.iterations,
        parallelism: envelope.kdf.parallelism,
      },
      kdfSalt,
      options.signal === undefined ? {} : { signal: options.signal },
    );
    const header: BackupV2Header = {
      type: envelope.type,
      formatVersion: envelope.formatVersion,
      payloadSchemaVersion: envelope.payloadSchemaVersion,
      kdf: envelope.kdf,
      cipher: envelope.cipher,
    };
    aad = encodeBackupV2Header(header);
    plaintext = await decryptEnvelope(key, { nonce, ciphertext }, aad);
    const payload = parseCanonicalPayload(plaintext);
    canonical = encodeCanonicalPayload(payload);
    if (!equalBytes(plaintext, canonical)) throw new Error("Invalid backup payload.");
    return { sourceFormat: "v2", payload };
  } catch {
    throw new Error("Backup authentication or parsing failed.");
  } finally {
    privatePassword.fill(0);
    salt.fill(0);
    kdfSalt.fill(0);
    nonce.fill(0);
    ciphertext.fill(0);
    key?.fill(0);
    plaintext?.fill(0);
    canonical?.fill(0);
    aad?.fill(0);
  }
}

const LegacyBackupEnvelopeSchema = z.strictObject({
  type: z.literal("shardpass-export"),
  version: z.literal(1),
  salt: z.string(),
  iv: z.string(),
  ciphertext: z.string(),
  iterations: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export async function importLegacyBackup(
  input: Uint8Array,
  password: Uint8Array,
): Promise<ImportedPortableBackup> {
  if (
    !(input instanceof Uint8Array) ||
    input.byteLength === 0 ||
    input.byteLength > MAX_LEGACY_BACKUP_ENVELOPE_BYTES ||
    !(password instanceof Uint8Array)
  ) {
    throw new Error("Invalid legacy backup.");
  }
  let decoded: string;
  let passwordText: string;
  try {
    decoded = fatalDecoder.decode(input);
    passwordText = fatalDecoder.decode(password);
  } catch {
    throw new Error("Invalid legacy backup.");
  }
  try {
    const raw = JSON.parse(decoded) as unknown;
    const parsed = LegacyBackupEnvelopeSchema.safeParse(raw);
    if (!parsed.success) throw new Error("Invalid legacy backup.");
    const wrapper = parsed.data;
    const legacy = await decryptLegacyVault(
      {
        version: wrapper.version,
        salt: wrapper.salt,
        iv: wrapper.iv,
        ciphertext: wrapper.ciphertext,
        iterations: wrapper.iterations,
        createdAt: wrapper.createdAt,
        updatedAt: wrapper.updatedAt,
      },
      passwordText,
    );
    const payload = PortableBackupPayloadSchema.parse({
      schemaVersion: 1,
      exportedAt: new Date(wrapper.updatedAt).toISOString(),
      items: legacy.accounts.map(mapLegacyAccount),
      settings: { autoLockMinutes: 15, lockOnScreenLock: true },
      history: { journal: [], tombstones: [] },
    });
    return { sourceFormat: "legacy-v1", payload };
  } catch {
    throw new Error("Legacy backup authentication or parsing failed.");
  }
}

function parseCanonicalPayload(input: Uint8Array): PortableBackupPayload {
  let decoded: string;
  let candidate: unknown;
  try {
    decoded = fatalDecoder.decode(input);
    candidate = JSON.parse(decoded);
  } catch {
    throw new Error("Invalid backup payload.");
  }
  const parsed = PortableBackupPayloadSchema.safeParse(candidate);
  if (!parsed.success) throw new Error("Invalid backup payload.");
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
