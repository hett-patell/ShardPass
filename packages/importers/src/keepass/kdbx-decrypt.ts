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
import { base64ToBytes, childNamed, childText, parseXml } from "./kdbx-xml";

const HEADER_HMAC_INDEX = 0xffffffffffffffffn;
/** KeePass checks a key file's data against the first four bytes of its SHA-256. */
const KEY_FILE_HASH_BYTES = 4;

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

function isHex(text: string): boolean {
  return text.length % 2 === 0 && /^[0-9a-fA-F]*$/u.test(text);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1)
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

type XmlKeyFile = Readonly<{ version: string; data: string; hash: string | undefined }>;

/** Reads KeePass's own XML key file layout, or nothing when the file is not one. */
function readXmlKeyFile(file: Uint8Array): XmlKeyFile | undefined {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(file);
  } catch {
    return undefined;
  }
  if (!text.includes("<KeyFile")) return undefined;
  try {
    const root = parseXml(text);
    if (root.name !== "KeyFile") return undefined;
    const meta = childNamed(root, "Meta");
    const key = childNamed(root, "Key");
    const data = key === undefined ? undefined : childNamed(key, "Data");
    if (meta === undefined || data === undefined) return undefined;
    return {
      version: childText(meta, "Version").trim(),
      data: data.text,
      hash: data.attributes.get("Hash"),
    };
  } catch {
    return undefined;
  }
}

/**
 * Turns a key file into the 32 bytes KeePass mixes into the composite key. KeePass's own XML
 * formats carry the key verbatim (1.0 as base64, 2.0 as hex with a checksum); a 32-byte file
 * is the key itself; a 64-character hex file decodes to it; any other file is hashed, which is
 * how a photo or a document can serve as a key.
 */
export async function keyFileKey(file: Uint8Array): Promise<Uint8Array> {
  const xml = readXmlKeyFile(file);
  if (xml !== undefined) {
    if (xml.version.startsWith("2.")) {
      const data = xml.data.replace(/\s+/gu, "");
      if (!isHex(data) || data.length === 0)
        throw new KdbxFormatError("The key file's data is not hexadecimal.");
      const key = hexToBytes(data);
      if (xml.hash !== undefined) {
        const digest = await sha256(key);
        const expected = xml.hash.replace(/\s+/gu, "").toLowerCase();
        if (expected !== bytesToHex(digest.slice(0, KEY_FILE_HASH_BYTES)))
          throw new KdbxFormatError(
            "The key file's checksum does not match its contents; the file may be damaged.",
          );
      }
      return key;
    }
    if (xml.version.startsWith("1.")) {
      let key: Uint8Array;
      try {
        key = base64ToBytes(xml.data.replace(/\s+/gu, ""));
      } catch {
        throw new KdbxFormatError("The key file's data is not base64.");
      }
      if (key.length !== 32) throw new KdbxFormatError("The key file's data is not a 32-byte key.");
      return key;
    }
    throw new KdbxFormatError(`Unsupported key file version ${xml.version || "(missing)"}.`);
  }
  if (file.length === 32) return file.slice();
  if (file.length === 64) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(file);
    if (isHex(text)) return hexToBytes(text);
  }
  return sha256(file);
}

export type KdbxCredentials = Readonly<{
  password: string;
  keyFile?: Uint8Array;
  /**
   * KeePass lets a database be locked with a key file and an empty master password that
   * still counts as one; that composite differs from key-file-only, so it is a second try.
   */
  hashEmptyPassword?: boolean;
}>;

/**
 * KeePass composite key: SHA-256 over the concatenated credential hashes, the password's
 * first and the key file's after it. A credential that is not in use contributes nothing.
 */
async function compositeKey(credentials: KdbxCredentials): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const usesPassword =
    credentials.password !== "" ||
    credentials.keyFile === undefined ||
    credentials.hashEmptyPassword === true;
  if (usesPassword) parts.push(await sha256(new TextEncoder().encode(credentials.password)));
  if (credentials.keyFile !== undefined) parts.push(await keyFileKey(credentials.keyFile));
  return sha256(concatBytes(...parts));
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

export async function deriveKeys(header: KdbxHeader, credentials: KdbxCredentials): Promise<KdbxKeys> {
  const transformed = transformKey(header.kdf, await compositeKey(credentials));
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
 * Verifies the header HMAC. This is the authoritative "are the credentials right" check: it
 * runs before any ciphertext is touched, so a wrong password or key file fails here rather
 * than surfacing as unintelligible plaintext later.
 */
export async function verifyHeader(
  header: KdbxHeader,
  keys: KdbxKeys,
  stored: Uint8Array,
  usedKeyFile = false,
): Promise<void> {
  const key = await blockHmacKey(keys.hmacBase, HEADER_HMAC_INDEX);
  if (!bytesEqual(await hmacSha256(key, header.raw), stored)) throw new KdbxPasswordError(usedKeyFile);
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
