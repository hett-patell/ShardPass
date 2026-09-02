import {
  LEGACY_VAULT_FORMAT_VERSION,
  WrappedVaultKeySchema,
  type WrappedVaultKey,
} from "@shardpass/storage";

import { decryptEnvelope, encryptEnvelope } from "./aead";
import {
  ARGON2ID_SALT_BYTES,
  DEFAULT_ARGON2ID_PARAMETERS,
  deriveKeyEncryptionKey,
  type KdfExecutor,
} from "./kdf";
import { type RandomSource, webCryptoRandomSource } from "./random";

export const VAULT_DATA_KEY_BYTES = 32;
export const MIN_SETUP_PASSWORD_CODE_POINTS = 12;

const WRAPPED_KEY_ASSOCIATED_DATA = new TextEncoder().encode(
  "shardpass:wrapped-vault-key:v1:xchacha20-poly1305",
);

function base64Encode(value: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < value.length; offset += 0x8000) {
    binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64Decode(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export interface VaultKeyMaterial {
  readonly vaultDataKey: Uint8Array;
  readonly wrappedKey: WrappedVaultKey;
}

export async function wrapVaultDataKeyWithKeyEncryptionKey(
  keyEncryptionKey: Uint8Array,
  salt: Uint8Array,
  parameters: typeof DEFAULT_ARGON2ID_PARAMETERS,
  vaultDataKey: Uint8Array,
  random: RandomSource = webCryptoRandomSource,
): Promise<WrappedVaultKey> {
  if (
    keyEncryptionKey.byteLength !== 32 ||
    salt.byteLength !== ARGON2ID_SALT_BYTES ||
    vaultDataKey.byteLength !== VAULT_DATA_KEY_BYTES
  ) {
    throw new RangeError("Invalid vault key material input length.");
  }
  const envelope = await encryptEnvelope(
    keyEncryptionKey,
    vaultDataKey,
    WRAPPED_KEY_ASSOCIATED_DATA,
    random,
  );
  return WrappedVaultKeySchema.parse({
    formatVersion: LEGACY_VAULT_FORMAT_VERSION,
    kdf: { ...parameters, salt: base64Encode(salt) },
    wrapping: {
      algorithm: "xchacha20-poly1305",
      nonce: base64Encode(envelope.nonce),
      ciphertext: base64Encode(envelope.ciphertext),
      encoding: "base64",
    },
  });
}

export async function createVaultKeyMaterialFromKeyEncryptionKey(
  keyEncryptionKey: Uint8Array,
  salt: Uint8Array,
  parameters: typeof DEFAULT_ARGON2ID_PARAMETERS,
  random: RandomSource = webCryptoRandomSource,
): Promise<VaultKeyMaterial> {
  if (keyEncryptionKey.byteLength !== 32 || salt.byteLength !== ARGON2ID_SALT_BYTES) {
    throw new RangeError("Invalid vault key material input length.");
  }
  const vaultDataKey = random.randomBytes(VAULT_DATA_KEY_BYTES);
  const wrappedKey = await wrapVaultDataKeyWithKeyEncryptionKey(
    keyEncryptionKey,
    salt,
    parameters,
    vaultDataKey,
    random,
  );
  return { vaultDataKey, wrappedKey };
}

export async function createVaultKeyMaterial(
  executor: KdfExecutor,
  password: string,
  random: RandomSource = webCryptoRandomSource,
): Promise<VaultKeyMaterial> {
  if (Array.from(password).length < MIN_SETUP_PASSWORD_CODE_POINTS) {
    throw new RangeError(
      `Setup password must contain at least ${MIN_SETUP_PASSWORD_CODE_POINTS} characters.`,
    );
  }
  const salt = random.randomBytes(ARGON2ID_SALT_BYTES);
  const keyEncryptionKey = await deriveKeyEncryptionKey(
    executor,
    password,
    DEFAULT_ARGON2ID_PARAMETERS,
    salt,
  );
  return createVaultKeyMaterialFromKeyEncryptionKey(
    keyEncryptionKey,
    salt,
    DEFAULT_ARGON2ID_PARAMETERS,
    random,
  );
}

export async function unwrapVaultDataKeyWithKeyEncryptionKey(
  keyEncryptionKey: Uint8Array,
  candidate: WrappedVaultKey,
): Promise<Uint8Array> {
  if (keyEncryptionKey.byteLength !== 32) {
    throw new RangeError("Invalid key-encryption-key length.");
  }
  const wrapped = WrappedVaultKeySchema.parse(candidate);
  const vaultDataKey = await decryptEnvelope(
    keyEncryptionKey,
    {
      nonce: base64Decode(wrapped.wrapping.nonce),
      ciphertext: base64Decode(wrapped.wrapping.ciphertext),
    },
    WRAPPED_KEY_ASSOCIATED_DATA,
  );
  if (vaultDataKey.byteLength !== VAULT_DATA_KEY_BYTES) {
    throw new Error("Wrapped vault data key has an invalid length.");
  }
  return vaultDataKey;
}

export async function unwrapVaultDataKey(
  executor: KdfExecutor,
  password: string,
  candidate: WrappedVaultKey,
): Promise<Uint8Array> {
  const wrapped = WrappedVaultKeySchema.parse(candidate);
  const keyEncryptionKey = await deriveKeyEncryptionKey(
    executor,
    password,
    wrapped.kdf,
    base64Decode(wrapped.kdf.salt),
  );
  return unwrapVaultDataKeyWithKeyEncryptionKey(keyEncryptionKey, wrapped);
}
