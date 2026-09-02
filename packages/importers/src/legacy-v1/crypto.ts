import {
  LEGACY_PBKDF2_ITERATIONS,
  LegacyEnvelopeSchema,
  LegacyPlaintextVaultSchema,
  MAX_LEGACY_PASSWORD_UTF8_BYTES,
  type LegacyEnvelope,
  type LegacyPlaintextVault,
} from "./schema";

export type LegacyMigrationErrorCode =
  | "AUTHENTICATION_FAILED"
  | "MALFORMED_LEGACY_DATA"
  | "UNSUPPORTED_LEGACY_RECORD"
  | "UNSUPPORTED_LEGACY_SETTINGS";

export class LegacyMigrationError extends Error {
  constructor(readonly code: LegacyMigrationErrorCode) {
    super(code);
    this.name = "LegacyMigrationError";
  }
}

export function inspectLegacyVault(candidate: unknown) {
  const envelope = parseEnvelope(candidate);
  return {
    format: "shardpass-legacy-vault" as const,
    version: envelope.version,
    createdAt: envelope.createdAt,
    updatedAt: envelope.updatedAt,
  };
}

export async function deriveLegacyVaultKey(
  candidate: unknown,
  password: string,
): Promise<Uint8Array> {
  const envelope = parseEnvelope(candidate);
  const passwordBytes = boundedUtf8(password);
  try {
    const material = await crypto.subtle.importKey(
      "raw",
      toArrayBuffer(passwordBytes),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: toArrayBuffer(decodeBase64(envelope.salt)),
        iterations: LEGACY_PBKDF2_ITERATIONS,
      },
      material,
      256,
    );
    return new Uint8Array(bits);
  } catch (error) {
    if (error instanceof LegacyMigrationError) throw error;
    throw new LegacyMigrationError("AUTHENTICATION_FAILED");
  } finally {
    passwordBytes.fill(0);
  }
}

export async function decryptLegacyVault(
  candidate: unknown,
  password: string,
): Promise<LegacyPlaintextVault> {
  const key = await deriveLegacyVaultKey(candidate, password);
  try {
    return await decryptLegacyVaultWithDerivedKey(candidate, key);
  } finally {
    key.fill(0);
  }
}

export async function decryptLegacyVaultWithDerivedKey(
  candidate: unknown,
  derivedKey: Uint8Array,
): Promise<LegacyPlaintextVault> {
  const envelope = parseEnvelope(candidate);
  if (!(derivedKey instanceof Uint8Array) || derivedKey.byteLength !== 32)
    throw new LegacyMigrationError("AUTHENTICATION_FAILED");
  let plaintext: ArrayBuffer;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      toArrayBuffer(derivedKey),
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(decodeBase64(envelope.iv)), tagLength: 128 },
      key,
      toArrayBuffer(decodeBase64(envelope.ciphertext)),
    );
  } catch {
    throw new LegacyMigrationError("AUTHENTICATION_FAILED");
  }
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    return LegacyPlaintextVaultSchema.parse(JSON.parse(decoded));
  } catch {
    throw new LegacyMigrationError("MALFORMED_LEGACY_DATA");
  } finally {
    new Uint8Array(plaintext).fill(0);
  }
}

function parseEnvelope(candidate: unknown): LegacyEnvelope {
  const parsed = LegacyEnvelopeSchema.safeParse(candidate);
  if (!parsed.success) throw new LegacyMigrationError("MALFORMED_LEGACY_DATA");
  return parsed.data;
}
function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
function boundedUtf8(value: string): Uint8Array {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (bytes > MAX_LEGACY_PASSWORD_UTF8_BYTES)
      throw new LegacyMigrationError("MALFORMED_LEGACY_DATA");
  }
  return new TextEncoder().encode(value);
}
function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const output = new ArrayBuffer(value.byteLength);
  new Uint8Array(output).set(value);
  return output;
}
