import { ByteReader, KdbxFormatError, formatUuid } from "./kdbx-binary";

const SIGNATURE_1 = 0x9aa2d903;
const SIGNATURE_2 = 0xb54bfb67;

export const CIPHER_AES256_CBC = "31c1f2e6-bf71-4350-be58-05216afc5aff";
export const CIPHER_CHACHA20 = "d6038a2b-8b6f-4cb5-a524-339a31dbb59a";
const CIPHER_TWOFISH = "ad68f29f-576f-4bb9-a36a-d47af965346c";

export const KDF_ARGON2D = "ef636ddf-8c29-444b-91f7-a9a403e30a0c";
export const KDF_ARGON2ID = "9e298b19-56db-4773-b23d-fc3ec6f0a1e6";
export const KDF_AES = "c9d9f39a-628a-4460-bf74-0d08c18a4fea";

/** Outer header field ids (KDBX 3 and 4 share this numbering). */
const FIELD_END = 0;
const FIELD_CIPHER_ID = 2;
const FIELD_COMPRESSION = 3;
const FIELD_MASTER_SEED = 4;
const FIELD_ENCRYPTION_IV = 7;
const FIELD_KDF_PARAMETERS = 11;

export type VariantValue = number | bigint | boolean | string | Uint8Array;

export type KdbxHeader = Readonly<{
  majorVersion: number;
  minorVersion: number;
  cipherId: string;
  compressed: boolean;
  masterSeed: Uint8Array;
  encryptionIv: Uint8Array;
  kdf: ReadonlyMap<string, VariantValue>;
  /** Every byte the header occupies, which the stored hash and HMAC cover. */
  raw: Uint8Array;
}>;

/**
 * Reads the unencrypted outer header. KDBX 4 only: KDBX 3 derives its keys differently and
 * authenticates with a start-byte comparison rather than an HMAC, so admitting it here would
 * silently skip integrity checking.
 */
export function parseKdbxHeader(bytes: Uint8Array): KdbxHeader {
  const reader = new ByteReader(bytes);
  if (reader.u32() !== SIGNATURE_1 || reader.u32() !== SIGNATURE_2)
    throw new KdbxFormatError("Not a KeePass database (bad file signature).");

  const minorVersion = reader.u16();
  const majorVersion = reader.u16();
  if (majorVersion !== 4)
    throw new KdbxFormatError(
      `Unsupported KeePass format version ${majorVersion}.${minorVersion}. ` +
        "Open the database in KeePass and save it as KDBX 4.",
    );

  let cipherId: string | undefined;
  let compressed: boolean | undefined;
  let masterSeed: Uint8Array | undefined;
  let encryptionIv: Uint8Array | undefined;
  let kdf: ReadonlyMap<string, VariantValue> | undefined;

  for (;;) {
    const id = reader.u8();
    const length = reader.u32();
    const data = reader.take(length);
    if (id === FIELD_END) break;
    switch (id) {
      case FIELD_CIPHER_ID:
        if (data.length !== 16) throw new KdbxFormatError("Malformed cipher identifier.");
        cipherId = formatUuid(data);
        break;
      case FIELD_COMPRESSION:
        compressed = new ByteReader(data).u32() === 1;
        break;
      case FIELD_MASTER_SEED:
        masterSeed = data;
        break;
      case FIELD_ENCRYPTION_IV:
        encryptionIv = data;
        break;
      case FIELD_KDF_PARAMETERS:
        kdf = parseVariantDictionary(data);
        break;
      default:
        break; // Unknown fields are still covered by the header hash, so ignoring is safe.
    }
  }

  if (
    cipherId === undefined ||
    masterSeed === undefined ||
    encryptionIv === undefined ||
    kdf === undefined
  )
    throw new KdbxFormatError("KeePass header is missing required fields.");
  if (cipherId === CIPHER_TWOFISH)
    throw new KdbxFormatError("Twofish-encrypted databases are not supported.");
  if (cipherId !== CIPHER_AES256_CBC && cipherId !== CIPHER_CHACHA20)
    throw new KdbxFormatError(`Unsupported KeePass cipher ${cipherId}.`);
  if (masterSeed.length !== 32) throw new KdbxFormatError("Malformed master seed.");

  const expectedIv = cipherId === CIPHER_CHACHA20 ? 12 : 16;
  if (encryptionIv.length !== expectedIv)
    throw new KdbxFormatError("Encryption nonce has the wrong length for the cipher.");

  return {
    majorVersion,
    minorVersion,
    cipherId,
    compressed: compressed ?? false,
    masterSeed,
    encryptionIv,
    kdf,
    raw: reader.consumed(),
  };
}

const TYPE_END = 0x00;
const TYPE_UINT32 = 0x04;
const TYPE_UINT64 = 0x05;
const TYPE_BOOL = 0x08;
const TYPE_INT32 = 0x0c;
const TYPE_INT64 = 0x0d;
const TYPE_STRING = 0x18;
const TYPE_BYTES = 0x42;

/** KeePass "VariantDictionary": the typed key/value map that carries KDF parameters. */
export function parseVariantDictionary(bytes: Uint8Array): ReadonlyMap<string, VariantValue> {
  const reader = new ByteReader(bytes);
  const version = reader.u16();
  if (version >> 8 !== 1)
    throw new KdbxFormatError(`Unsupported KDF parameter format version ${version >> 8}.`);

  const entries = new Map<string, VariantValue>();
  for (;;) {
    const type = reader.u8();
    if (type === TYPE_END) break;
    const key = new TextDecoder().decode(reader.take(reader.u32()));
    const value = reader.take(reader.u32());
    entries.set(key, decodeVariant(type, value, key));
  }
  return entries;
}

function decodeVariant(type: number, value: Uint8Array, key: string): VariantValue {
  const reader = new ByteReader(value);
  switch (type) {
    case TYPE_UINT32:
    case TYPE_INT32:
      return reader.u32();
    case TYPE_UINT64:
    case TYPE_INT64:
      return reader.u64();
    case TYPE_BOOL:
      return value[0] === 1;
    case TYPE_STRING:
      return new TextDecoder().decode(value);
    case TYPE_BYTES:
      return value;
    default:
      throw new KdbxFormatError(`Unsupported KDF parameter type for "${key}".`);
  }
}
