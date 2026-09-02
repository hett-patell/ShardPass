import { createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { link, mkdir, mkdtemp, open, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertCandidateUnchanged } from "./project1-candidate.mjs";
import { computeProject1Candidate } from "./project1-release-evidence.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const byteSort = (a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
const DOS_DATE = 0x21;
const table = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  table[n] = c >>> 0;
}
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function safeArchivePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\\") &&
    !path.posix.isAbsolute(value) &&
    path.posix.normalize(value) === value &&
    !value.split("/").includes("..") &&
    value.normalize("NFC") === value
  );
}
function localHeader(name, crc, compressed, size) {
  const value = Buffer.alloc(30);
  value.writeUInt32LE(0x04034b50, 0);
  value.writeUInt16LE(20, 4);
  value.writeUInt16LE(0x800, 6);
  value.writeUInt16LE(8, 8);
  value.writeUInt16LE(0, 10);
  value.writeUInt16LE(DOS_DATE, 12);
  value.writeUInt32LE(crc, 14);
  value.writeUInt32LE(compressed, 18);
  value.writeUInt32LE(size, 22);
  value.writeUInt16LE(Buffer.byteLength(name), 26);
  return value;
}
function centralHeader(entry, offset) {
  const name = Buffer.from(entry.name);
  const value = Buffer.alloc(46);
  value.writeUInt32LE(0x02014b50, 0);
  value.writeUInt16LE((3 << 8) | 20, 4);
  value.writeUInt16LE(20, 6);
  value.writeUInt16LE(0x800, 8);
  value.writeUInt16LE(entry.directory ? 0 : 8, 10);
  value.writeUInt16LE(0, 12);
  value.writeUInt16LE(DOS_DATE, 14);
  value.writeUInt32LE(entry.crc, 16);
  value.writeUInt32LE(entry.compressed.length, 20);
  value.writeUInt32LE(entry.bytes.length, 24);
  value.writeUInt16LE(name.length, 28);
  value.writeUInt16LE(0, 30);
  value.writeUInt16LE(0, 32);
  value.writeUInt16LE(0, 34);
  value.writeUInt16LE(0, 36);
  value.writeUInt32LE(((entry.directory ? 0o40755 : 0o100644) << 16) >>> 0, 38);
  value.writeUInt32LE(offset, 42);
  return Buffer.concat([value, name]);
}
function eocd(count, centralSize, centralOffset) {
  const value = Buffer.alloc(22);
  value.writeUInt32LE(0x06054b50, 0);
  value.writeUInt16LE(count, 8);
  value.writeUInt16LE(count, 10);
  value.writeUInt32LE(centralSize, 12);
  value.writeUInt32LE(centralOffset, 16);
  return value;
}
async function entries(candidate) {
  const top = `ShardPass-${candidate.identity.version}`;
  if (!/^[A-Za-z0-9._-]+$/u.test(candidate.identity.version))
    throw new Error("ARCHIVE_VERSION_INVALID");
  const directories = new Set([`${top}/`]);
  const result = [];
  for (const file of candidate.files) {
    if (!safeArchivePath(file.path)) throw new Error("ARCHIVE_PATH_INVALID");
    const parts = file.path.split("/");
    for (let index = 1; index < parts.length; index++)
      directories.add(`${top}/${parts.slice(0, index).join("/")}/`);
    const bytes = await readFile(path.join(candidate.root, ...parts));
    result.push({
      name: `${top}/${file.path}`,
      directory: false,
      bytes,
      compressed: deflateRawSync(bytes, { level: 9 }),
      crc: crc32(bytes),
    });
  }
  for (const name of directories)
    result.push({
      name,
      directory: true,
      bytes: Buffer.alloc(0),
      compressed: Buffer.alloc(0),
      crc: 0,
    });
  result.sort((a, b) => byteSort(a.name, b.name));
  return result;
}
function archiveBytes(archiveEntries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of archiveEntries) {
    const name = Buffer.from(entry.name);
    const header = localHeader(entry.name, entry.crc, entry.compressed.length, entry.bytes.length);
    if (entry.directory) header.writeUInt16LE(0, 8);
    local.push(header, name, entry.compressed);
    central.push(centralHeader(entry, offset));
    offset += header.length + name.length + entry.compressed.length;
  }
  const centralBytes = Buffer.concat(central);
  return Buffer.concat([
    ...local,
    centralBytes,
    eocd(archiveEntries.length, centralBytes.length, offset),
  ]);
}
export async function createDeterministicArchive(candidate, output) {
  await assertCandidateUnchanged(candidate);
  const absolute = path.resolve(output);
  if (absolute === candidate.root || absolute.startsWith(`${candidate.root}${path.sep}`))
    throw new Error("ARCHIVE_INSIDE_CANDIDATE");
  const archiveEntries = await entries(candidate);
  const bytes = archiveBytes(archiveEntries);
  await mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp-${process.pid}-${sha256(bytes).slice(0, 12)}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    try {
      await link(temporary, absolute);
    } catch (error) {
      if (error?.code === "EEXIST") throw new Error("ARCHIVE_OUTPUT_EXISTS", { cause: error });
      throw error;
    }
    await unlink(temporary);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  await assertCandidateUnchanged(candidate);
  return Object.freeze({
    path: absolute,
    sha256: sha256(bytes),
    size: bytes.length,
    candidate: candidate.identity,
    entryCount: archiveEntries.length,
    compression: "DEFLATE-9",
    timestamp: "1980-01-01T00:00:00.000Z",
  });
}
function parseZip(bytes, limits) {
  if (bytes.length < 22 || bytes.readUInt32LE(bytes.length - 22) !== 0x06054b50)
    throw new Error("ARCHIVE_FORMAT_INVALID");
  const end = bytes.length - 22;
  const count = bytes.readUInt16LE(end + 10);
  const centralOffset = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 20) !== 0 || count > limits.maxEntries)
    throw new Error("ARCHIVE_LIMIT_INVALID");
  const files = [];
  let cursor = centralOffset;
  let total = 0;
  const seen = new Set();
  const folded = new Set();
  for (let index = 0; index < count; index++) {
    if (bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error("ARCHIVE_CENTRAL_INVALID");
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const size = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extra = bytes.readUInt16LE(cursor + 30);
    const comment = bytes.readUInt16LE(cursor + 32);
    const external = bytes.readUInt32LE(cursor + 38);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if (
      !safeArchivePath(name.replace(/\/$/u, "")) ||
      extra ||
      comment ||
      seen.has(name) ||
      folded.has(name.toLocaleLowerCase("en-US"))
    )
      throw new Error("ARCHIVE_ENTRY_INVALID");
    seen.add(name);
    folded.add(name.toLocaleLowerCase("en-US"));
    const directory = name.endsWith("/");
    const expectedMode = directory ? 0o40755 : 0o100644;
    if (external >>> 16 !== expectedMode || (directory ? method !== 0 : method !== 8))
      throw new Error("ARCHIVE_METADATA_INVALID");
    if (bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("ARCHIVE_LOCAL_INVALID");
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtra = bytes.readUInt16LE(localOffset + 28);
    if (localExtra) throw new Error("ARCHIVE_EXTRA_INVALID");
    const compressed = bytes.subarray(
      localOffset + 30 + localNameLength,
      localOffset + 30 + localNameLength + compressedSize,
    );
    const output = directory
      ? Buffer.alloc(0)
      : inflateRawSync(compressed, { maxOutputLength: limits.maxBytes - total });
    if (output.length !== size || crc32(output) !== bytes.readUInt32LE(cursor + 16))
      throw new Error("ARCHIVE_CONTENT_INVALID");
    total += output.length;
    if (total > limits.maxBytes) throw new Error("ARCHIVE_LIMIT_INVALID");
    files.push({ name, directory, bytes: output });
    cursor += 46 + nameLength + extra + comment;
  }
  return files;
}
export async function verifyArchiveRoundTrip(
  candidate,
  archive,
  limits = { maxEntries: 10000, maxBytes: 256 * 1024 * 1024 },
) {
  await assertCandidateUnchanged(candidate);
  const bytes = await readFile(archive.path ?? archive);
  if (archive.sha256 && sha256(bytes) !== archive.sha256) throw new Error("ARCHIVE_HASH_MISMATCH");
  const canonicalBytes = archiveBytes(await entries(candidate));
  if (!bytes.equals(canonicalBytes)) throw new Error("ARCHIVE_NONCANONICAL");
  const parsed = parseZip(bytes, limits);
  const expectedRoot = `ShardPass-${candidate.identity.version}/`;
  const names = parsed.map((entry) => entry.name);
  const expectedNames = (await entries(candidate)).map((entry) => entry.name);
  if (
    JSON.stringify(names) !== JSON.stringify(expectedNames) ||
    names.some((name) => !name.startsWith(expectedRoot))
  )
    throw new Error("ARCHIVE_INVENTORY_MISMATCH");
  const temporary = await mkdtemp(path.join(tmpdir(), "shardpass-archive-roundtrip-"));
  const root = path.join(temporary, expectedRoot);
  try {
    for (const entry of parsed) {
      const relative = entry.name.slice(expectedRoot.length);
      if (!relative) {
        await mkdir(root, { recursive: true });
        continue;
      }
      const target = path.join(root, ...relative.replace(/\/$/u, "").split("/"));
      if (entry.directory) await mkdir(target, { recursive: true });
      else {
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, entry.bytes, { flag: "wx", mode: 0o644 });
      }
    }
    const identity = await computeProject1Candidate(root);
    if (JSON.stringify(identity) !== JSON.stringify(candidate.identity))
      throw new Error("ARCHIVE_IDENTITY_MISMATCH");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  await assertCandidateUnchanged(candidate);
}
