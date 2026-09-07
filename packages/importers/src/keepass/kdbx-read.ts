import { ByteReader, KdbxFormatError, KdbxPasswordError, toArrayBuffer } from "./kdbx-binary";
import { decryptPayload, deriveKeys, gunzip, readHmacBlocks, verifyHeader } from "./kdbx-decrypt";
import { parseKdbxHeader } from "./kdbx-header";
import {
  InnerStreamCipher,
  base64ToBytes,
  childNamed,
  childText,
  parseXml,
  type XmlNode,
} from "./kdbx-xml";

/** An older version of an entry, as KeePass keeps it under History. */
export type KeePassHistoryEntry = Readonly<{
  password: string;
  /** When that version was last changed, i.e. roughly when it stopped being current. */
  modifiedAt?: string;
}>;

/** One KeePass entry, flattened out of the group tree. */
export type KeePassEntry = Readonly<{
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  /** Reserved KeePass TOTP field, when present. */
  otp: string;
  /** Non-reserved string fields, protected ones already unmasked. */
  custom: ReadonlyMap<string, string>;
  /** Keys of `custom` that KeePass stored as protected (masked) values. */
  protectedKeys: ReadonlySet<string>;
  /** Group path from the root, e.g. ["Web", "Banking"]. */
  path: readonly string[];
  tags: readonly string[];
  /** ISO timestamps from the entry's Times element, when KeePass recorded them. */
  createdAt?: string;
  updatedAt?: string;
  /** Number of file attachments the entry carries; their contents are not read. */
  attachments: number;
  /** Older versions, oldest first. */
  history: readonly KeePassHistoryEntry[];
}>;

export type KeePassDatabase = Readonly<{
  entries: readonly KeePassEntry[];
  /** Names of groups KeePass marks as recycle bins, whose entries were skipped. */
  skippedRecycleBin: number;
}>;

const INNER_FIELD_END = 0;
const INNER_FIELD_STREAM_ID = 1;
const INNER_FIELD_STREAM_KEY = 2;

const RESERVED = new Set(["Title", "UserName", "Password", "URL", "Notes", "otp"]);

/** Seconds between 0001-01-01T00:00:00Z, where KDBX 4 counts from, and the Unix epoch. */
const KDBX_EPOCH_OFFSET_SECONDS = 62_135_596_800n;
/** JavaScript dates cannot represent anything past this many milliseconds from the epoch. */
const MAX_DATE_MILLIS = 8_640_000_000_000_000n;

/**
 * Decrypts a KDBX 4 database and returns its entries.
 *
 * The password and key file are used only to derive keys and are never retained. Integrity
 * is checked before any plaintext is produced: the header HMAC gates the credentials, and
 * every payload block carries its own HMAC.
 */
export async function readKdbx(
  file: Uint8Array,
  password: string,
  keyFile?: Uint8Array,
): Promise<KeePassDatabase> {
  const header = parseKdbxHeader(file);

  const afterHeader = header.raw.length;
  const storedHash = file.slice(afterHeader, afterHeader + 32);
  const storedHmac = file.slice(afterHeader + 32, afterHeader + 64);
  if (storedHash.length !== 32 || storedHmac.length !== 32)
    throw new KdbxFormatError("File is truncated: the header digests are missing.");

  const actualHash = new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(header.raw)));
  if (!actualHash.every((byte, index) => byte === storedHash[index]))
    throw new KdbxFormatError("Header checksum mismatch: the file is corrupt.");

  const usedKeyFile = keyFile !== undefined;
  let keys = await deriveKeys(header, usedKeyFile ? { password, keyFile } : { password });
  try {
    await verifyHeader(header, keys, storedHmac, usedKeyFile);
  } catch (error) {
    // An empty master password next to a key file is ambiguous: KeePass may or may not have
    // counted it. Key-file-only was tried first; the other reading costs one more derivation.
    if (!(error instanceof KdbxPasswordError) || password !== "" || keyFile === undefined) throw error;
    keys = await deriveKeys(header, { password, keyFile, hashEmptyPassword: true });
    await verifyHeader(header, keys, storedHmac, usedKeyFile);
  }

  const blocks = await readHmacBlocks(file.slice(afterHeader + 64), keys);
  const decrypted = await decryptPayload(header, keys, blocks);
  const payload = header.compressed ? await gunzip(decrypted) : decrypted;

  const reader = new ByteReader(payload);
  let streamId = 0;
  let streamKey: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  for (;;) {
    const id = reader.u8();
    const data = reader.take(reader.u32());
    if (id === INNER_FIELD_END) break;
    if (id === INNER_FIELD_STREAM_ID) streamId = new ByteReader(data).u32();
    else if (id === INNER_FIELD_STREAM_KEY) streamKey = data;
  }

  const xml = new TextDecoder().decode(payload.slice(reader.offset));
  const cipher = await InnerStreamCipher.create(streamId, streamKey);
  return collectEntries(parseXml(xml), cipher);
}

function collectEntries(document: XmlNode, cipher: InnerStreamCipher): KeePassDatabase {
  const root = childNamed(document, "Root");
  if (root === undefined) throw new KdbxFormatError("Database XML has no Root element.");

  const recycleBinUuid = findRecycleBinUuid(document);
  const entries: KeePassEntry[] = [];
  let skippedRecycleBin = 0;

  /**
   * Children are visited in document order, not entries-then-groups. The protected-value
   * keystream is a single sequence spanning the whole document, so visiting out of order
   * desynchronises it and every later value decodes to noise.
   *
   * `path` is the group's own path and excludes the root group's name, which is an internal
   * KeePass container rather than a folder the user created.
   */
  const walk = (group: XmlNode, path: readonly string[], recycled: boolean): void => {
    const isRecycled = recycled || (recycleBinUuid !== "" && childText(group, "UUID") === recycleBinUuid);
    for (const child of group.children) {
      if (child.name === "Entry") {
        // Recycled entries are still parsed, never skipped: their protected values must be
        // consumed to keep the shared keystream aligned. They are dropped afterwards.
        const parsed = readEntry(child, path, cipher);
        if (isRecycled) skippedRecycleBin += 1;
        else entries.push(parsed);
      } else if (child.name === "Group") {
        walk(child, [...path, childText(child, "Name")], isRecycled);
      }
    }
  };

  for (const child of root.children) {
    if (child.name === "Group") walk(child, [], false);
    else if (child.name === "Entry") entries.push(readEntry(child, [], cipher));
  }

  return { entries, skippedRecycleBin };
}

function findRecycleBinUuid(document: XmlNode): string {
  const meta = childNamed(document, "Meta");
  if (meta === undefined) return "";
  return childText(meta, "RecycleBinUUID");
}

/**
 * KDBX 4 writes times as base64 of a little-endian count of seconds since year 1; KDBX 3
 * wrote ISO text. Both are accepted, and anything unreadable is simply absent.
 */
export function kdbxTime(text: string): string | undefined {
  const value = text.trim();
  if (value === "") return undefined;
  if (/^[A-Za-z0-9+/]{11}=$/u.test(value)) {
    const bytes = base64ToBytes(value);
    if (bytes.length !== 8) return undefined;
    const millis = (new ByteReader(bytes).u64() - KDBX_EPOCH_OFFSET_SECONDS) * 1000n;
    if (millis < 0n || millis > MAX_DATE_MILLIS) return undefined;
    return new Date(Number(millis)).toISOString();
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

/** Reads a String element's key and value, unmasking a protected value or merely skipping it. */
function readString(
  field: XmlNode,
  cipher: InnerStreamCipher,
  wanted: (key: string) => boolean,
): { key: string; value: string; isProtected: boolean } {
  const key = childText(field, "Key");
  const valueNode = childNamed(field, "Value");
  if (valueNode === undefined) return { key, value: "", isProtected: false };
  const isProtected = valueNode.attributes.get("Protected") === "True";
  if (!isProtected) return { key, value: valueNode.text, isProtected };
  if (wanted(key)) return { key, value: cipher.unprotect(valueNode.text), isProtected };
  cipher.skip(valueNode.text);
  return { key, value: "", isProtected };
}

/**
 * A history entry is a full entry in its own right, protected values included, so it has to
 * be walked to keep the keystream aligned even though only its password is kept.
 */
function readHistoryEntry(entry: XmlNode, cipher: InnerStreamCipher): KeePassHistoryEntry {
  let password = "";
  let modifiedAt: string | undefined;
  for (const child of entry.children) {
    if (child.name === "String") {
      const field = readString(child, cipher, (key) => key === "Password");
      if (field.key === "Password") password = field.value;
    } else if (child.name === "Times") {
      modifiedAt = kdbxTime(childText(child, "LastModificationTime"));
    }
  }
  return modifiedAt === undefined ? { password } : { password, modifiedAt };
}

/**
 * Children are read in document order for the same reason groups are: Strings, Binaries and
 * History all sit on the one keystream.
 */
function readEntry(entry: XmlNode, path: readonly string[], cipher: InnerStreamCipher): KeePassEntry {
  const fields = new Map<string, string>();
  const protectedKeys = new Set<string>();
  const history: KeePassHistoryEntry[] = [];
  let attachments = 0;
  let createdAt: string | undefined;
  let updatedAt: string | undefined;

  for (const child of entry.children) {
    if (child.name === "String") {
      const field = readString(child, cipher, () => true);
      if (field.isProtected) protectedKeys.add(field.key);
      fields.set(field.key, field.value);
    } else if (child.name === "Binary") {
      attachments += 1;
    } else if (child.name === "History") {
      for (const version of child.children)
        if (version.name === "Entry") history.push(readHistoryEntry(version, cipher));
    } else if (child.name === "Times") {
      createdAt = kdbxTime(childText(child, "CreationTime"));
      updatedAt = kdbxTime(childText(child, "LastModificationTime"));
    }
  }

  const custom = new Map<string, string>();
  for (const [key, value] of fields) if (!RESERVED.has(key) && value !== "") custom.set(key, value);

  const tagText = childText(entry, "Tags");
  const tags = tagText
    .split(/[;,]/u)
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");

  return {
    title: fields.get("Title") ?? "",
    username: fields.get("UserName") ?? "",
    password: fields.get("Password") ?? "",
    url: fields.get("URL") ?? "",
    notes: fields.get("Notes") ?? "",
    otp: fields.get("otp") ?? "",
    custom,
    protectedKeys,
    path,
    tags,
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    attachments,
    history,
  };
}
