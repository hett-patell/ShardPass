import { argon2d, argon2id } from "@noble/hashes/argon2.js";
import { chacha20 } from "@noble/ciphers/chacha.js";

import {
  ByteReader,
  KdbxFormatError,
  KdbxPasswordError,
  bytesEqual,
  concatBytes,
  formatUuid,
  toArrayBuffer,
  u32le,
  u64le,
} from "./kdbx-binary";
import {
  CIPHER_CHACHA20,
  KDF_AES,
  KDF_ARGON2D,
  KDF_ARGON2ID,
  type KdbxHeader,
  type VariantValue,
} from "./kdbx-header";

const HEADER_HMAC_INDEX = 0xffffffffffffffffn;

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(data)));
}

async function sha512(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-512", toArrayBuffer(data)));
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, toArrayBuffer(data)));
}

/**
 * KeePass composite key: SHA-256 over the concatenated credential hashes. Only a password is
 * supported; a key file would append its own 32-byte hash before the outer digest.
 */
async function compositeKey(password: string): Promise<Uint8Array> {
  const passwordHash = await sha256(new TextEncoder().encode(password));
  return sha256(passwordHash);
}

function requireBytes(kdf: ReadonlyMap<string, VariantValue>, key: string): Uint8Array {
  const value = kdf.get(key);
  if (!(value instanceof Uint8Array)) throw new KdbxFormatError(`KDF parameter "${key}" is missing.`);
  return value;
}

function requireNumber(kdf: ReadonlyMap<string, VariantValue>, key: string): number {
  const value = kdf.get(key);
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new KdbxFormatError(`KDF parameter "${key}" is missing.`);
}

/** Stretches the composite key with the database's own KDF settings. */
function transformKey(kdf: ReadonlyMap<string, VariantValue>, key: Uint8Array): Uint8Array {
  const uuid = kdf.get("$UUID");
  const kdfId = uuid instanceof Uint8Array ? formatUuid(uuid) : "";

  if (kdfId === KDF_ARGON2D || kdfId === KDF_ARGON2ID) {
    const salt = requireBytes(kdf, "S");
    const iterations = requireNumber(kdf, "I");
    const memoryBytes = requireNumber(kdf, "M");
    const parallelism = requireNumber(kdf, "P");
    const version = kdf.has("V") ? requireNumber(kdf, "V") : 0x13;
    // KeePass records memory in bytes; Argon2 itself is parameterised in KiB.
    const memoryKiB = Math.floor(memoryBytes / 1024);
    if (memoryKiB < 8) throw new KdbxFormatError("KDF memory parameter is implausibly small.");
    const argon = kdfId === KDF_ARGON2D ? argon2d : argon2id;
    return argon(key, salt, {
      t: iterations,
      m: memoryKiB,
      p: parallelism,
      version,
      dkLen: 32,
    });
  }

  if (kdfId === KDF_AES) {
    throw new KdbxFormatError(
      "This database uses the legacy AES-KDF. Re-save it in KeePass with Argon2 to import it.",
    );
  }

  throw new KdbxFormatError("Unsupported KeePass key derivation function.");
}

export type KdbxKeys = Readonly<{ cipherKey: Uint8Array; hmacBase: Uint8Array }>;

export async function deriveKeys(header: KdbxHeader, password: string): Promise<KdbxKeys> {
  const transformed = transformKey(header.kdf, await compositeKey(password));
  return {
    cipherKey: await sha256(concatBytes(header.masterSeed, transformed)),
    hmacBase: await sha512(concatBytes(header.masterSeed, transformed, Uint8Array.of(0x01))),
  };
}

/** Per-block HMAC key: SHA-512 over the block index followed by the base key. */
async function blockHmacKey(hmacBase: Uint8Array, index: bigint): Promise<Uint8Array> {
  return sha512(concatBytes(u64le(index), hmacBase));
}

/**
 * Verifies the header HMAC. This is the authoritative "is the password right" check: it runs
 * before any ciphertext is touched, so a wrong password fails here rather than surfacing as
 * unintelligible plaintext later.
 */
export async function verifyHeader(header: KdbxHeader, keys: KdbxKeys, stored: Uint8Array): Promise<void> {
  const key = await blockHmacKey(keys.hmacBase, HEADER_HMAC_INDEX);
  if (!bytesEqual(await hmacSha256(key, header.raw), stored)) throw new KdbxPasswordError();
}

/** Reassembles the HMAC-protected block stream that follows the header. */
export async function readHmacBlocks(body: Uint8Array, keys: KdbxKeys): Promise<Uint8Array> {
  const reader = new ByteReader(body);
  const blocks: Uint8Array[] = [];
  for (let index = 0n; ; index += 1n) {
    const tag = reader.take(32);
    const length = reader.u32();
    const data = reader.take(length);
    const key = await blockHmacKey(keys.hmacBase, index);
    const expected = await hmacSha256(key, concatBytes(u64le(index), u32le(length), data));
    // Every block is authenticated, so truncation or splicing is rejected rather than
    // silently yielding a short vault.
    if (!bytesEqual(expected, tag)) throw new KdbxFormatError("Database block failed its integrity check.");
    if (length === 0) break;
    blocks.push(data);
  }
  return concatBytes(...blocks);
}

export async function decryptPayload(
  header: KdbxHeader,
  keys: KdbxKeys,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  if (header.cipherId === CIPHER_CHACHA20)
    return chacha20(keys.cipherKey, header.encryptionIv, ciphertext);

  const key = await crypto.subtle.importKey("raw", toArrayBuffer(keys.cipherKey), { name: "AES-CBC" }, false, [
    "decrypt",
  ]);
  try {
    // WebCrypto strips the PKCS#7 padding KeePass applies.
    const plain = await crypto.subtle.decrypt(
      { name: "AES-CBC", iv: toArrayBuffer(header.encryptionIv) },
      key,
      toArrayBuffer(ciphertext),
    );
    return new Uint8Array(plain);
  } catch {
    throw new KdbxFormatError("Database payload could not be decrypted.");
  }
}

export async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
