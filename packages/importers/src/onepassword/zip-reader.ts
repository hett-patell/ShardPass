/**
 * Enough of the ZIP format to lift one file out of an archive: the central directory is found
 * through the end-of-central-directory record, and an entry is read from its local header,
 * stored or deflated (through the platform's DecompressionStream). ZIP64, encryption and every
 * other compression method are refused by name rather than misread.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_LENGTH = 22;
const MAX_COMMENT_LENGTH = 0xffff;
const CENTRAL_HEADER_LENGTH = 46;
const LOCAL_HEADER_LENGTH = 30;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const FLAG_ENCRYPTED = 0x1;
const ZIP64_16 = 0xffff;
const ZIP64_32 = 0xffffffff;
const CORRUPT = "The archive is corrupt or truncated.";

export class ZipFormatError extends Error {
  override readonly name = "ZipFormatError";
}

export type ZipEntry = Readonly<{
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}>;

/** Lists the archive's entries from its central directory without reading any data. */
export function listZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  if (eocd === undefined) throw new ZipFormatError("This file is not a ZIP archive.");
  const count = view.getUint16(eocd + 10, true);
  const size = view.getUint32(eocd + 12, true);
  const offset = view.getUint32(eocd + 16, true);
  if (count === ZIP64_16 || size === ZIP64_32 || offset === ZIP64_32)
    throw new ZipFormatError("ZIP64 archives are not supported.");
  const end = offset + size;
  if (end > eocd) throw new ZipFormatError(CORRUPT);

  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let cursor = offset;
  for (let index = 0; index < count; index += 1) {
    if (cursor + CENTRAL_HEADER_LENGTH > end || view.getUint32(cursor, true) !== CENTRAL_SIGNATURE)
      throw new ZipFormatError(CORRUPT);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const nameStart = cursor + CENTRAL_HEADER_LENGTH;
    if (nameStart + nameLength > end) throw new ZipFormatError(CORRUPT);
    entries.push({
      name: decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)),
      flags: view.getUint16(cursor + 8, true),
      method: view.getUint16(cursor + 10, true),
      compressedSize: view.getUint32(cursor + 20, true),
      uncompressedSize: view.getUint32(cursor + 24, true),
      localHeaderOffset: view.getUint32(cursor + 42, true),
    });
    cursor = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Reads one entry's bytes. `maxBytes` bounds the inflated size before any inflating happens,
 * so a small archive cannot expand into something the page cannot hold.
 */
export async function readZipEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
  maxBytes: number,
): Promise<Uint8Array> {
  if ((entry.flags & FLAG_ENCRYPTED) !== 0)
    throw new ZipFormatError(`"${entry.name}" is encrypted, which is not supported.`);
  if (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATE)
    throw new ZipFormatError(
      `"${entry.name}" uses compression method ${entry.method}, which is not supported.`,
    );
  if (entry.compressedSize === ZIP64_32 || entry.uncompressedSize === ZIP64_32)
    throw new ZipFormatError("ZIP64 archives are not supported.");
  if (entry.uncompressedSize > maxBytes)
    throw new ZipFormatError(
      `"${entry.name}" is larger than ${Math.floor(maxBytes / 1_048_576)} MiB, more than can be imported.`,
    );

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = entry.localHeaderOffset;
  if (start + LOCAL_HEADER_LENGTH > bytes.length || view.getUint32(start, true) !== LOCAL_SIGNATURE)
    throw new ZipFormatError(CORRUPT);
  const dataStart =
    start +
    LOCAL_HEADER_LENGTH +
    view.getUint16(start + 26, true) +
    view.getUint16(start + 28, true);
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > bytes.length) throw new ZipFormatError(CORRUPT);
  const data = bytes.slice(dataStart, dataEnd);

  if (entry.method === METHOD_STORED) {
    if (data.length !== entry.uncompressedSize) throw new ZipFormatError(CORRUPT);
    return data;
  }
  return inflateRaw(data, entry.uncompressedSize, entry.name);
}

function findEndOfCentralDirectory(view: DataView): number | undefined {
  const last = view.byteLength - EOCD_LENGTH;
  const first = Math.max(0, last - MAX_COMMENT_LENGTH);
  for (let offset = last; offset >= first; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  return undefined;
}

/**
 * Inflates into a buffer of exactly the declared size: more output than declared is treated as
 * corruption and stops the stream, so the declared size is the real ceiling.
 */
async function inflateRaw(
  data: Uint8Array<ArrayBuffer>,
  expectedSize: number,
  name: string,
): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined")
    throw new ZipFormatError("This browser cannot decompress the archive.");
  const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  const reader = source.pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const out = new Uint8Array(expectedSize);
  let written = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (written + value.byteLength > expectedSize) throw new ZipFormatError(CORRUPT);
      out.set(value, written);
      written += value.byteLength;
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof ZipFormatError) throw error;
    throw new ZipFormatError(`"${name}" could not be decompressed; the archive is corrupt.`);
  }
  if (written !== expectedSize) throw new ZipFormatError(CORRUPT);
  return out;
}
