import { ByteReader, KdbxFormatError, toArrayBuffer } from "./kdbx-binary";
import { decryptPayload, deriveKeys, gunzip, readHmacBlocks, verifyHeader } from "./kdbx-decrypt";
import { parseKdbxHeader } from "./kdbx-header";
import {
  InnerStreamCipher,
  childNamed,
  childText,
  childrenNamed,
  parseXml,
  type XmlNode,
} from "./kdbx-xml";

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
  /** Group path from the root, e.g. ["Web", "Banking"]. */
  path: readonly string[];
  tags: readonly string[];
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

/**
 * Decrypts a KDBX 4 database and returns its entries.
 *
 * The password is used only to derive keys and is never retained. Integrity is checked before
 * any plaintext is produced: the header HMAC gates the password, and every payload block
 * carries its own HMAC.
 */
export async function readKdbx(file: Uint8Array, password: string): Promise<KeePassDatabase> {
  const header = parseKdbxHeader(file);
  const keys = await deriveKeys(header, password);

  const afterHeader = header.raw.length;
  const storedHash = file.slice(afterHeader, afterHeader + 32);
  const storedHmac = file.slice(afterHeader + 32, afterHeader + 64);
  if (storedHash.length !== 32 || storedHmac.length !== 32)
    throw new KdbxFormatError("File is truncated: the header digests are missing.");

  const actualHash = new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(header.raw)));
  if (!actualHash.every((byte, index) => byte === storedHash[index]))
    throw new KdbxFormatError("Header checksum mismatch: the file is corrupt.");

  await verifyHeader(header, keys, storedHmac);

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

function readEntry(entry: XmlNode, path: readonly string[], cipher: InnerStreamCipher): KeePassEntry {
  const fields = new Map<string, string>();
  for (const field of childrenNamed(entry, "String")) {
    const key = childText(field, "Key");
    const valueNode = childNamed(field, "Value");
    if (valueNode === undefined) {
      fields.set(key, "");
      continue;
    }
    const protectedFlag = valueNode.attributes.get("Protected");
    fields.set(
      key,
      protectedFlag === "True" ? cipher.unprotect(valueNode.text) : valueNode.text,
    );
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
    path,
    tags,
  };
}
