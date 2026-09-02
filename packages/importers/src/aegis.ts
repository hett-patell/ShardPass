import { sha256 } from "@noble/hashes/sha2.js";
import { decodeCanonicalBase64 } from "@shardpass/security";

import {
  IMPORT_LIMITS,
  type ImportReasonCode,
  type OtpImportCandidate,
  type ParsedOtpImport,
} from "./import-model";
import {
  canonicalJsonSecret,
  exactKeys,
  requiredRecord,
  stringArray,
  validatedCandidate,
} from "./json-candidate";
import { failJson, isPlainRecord, JsonImportError, parseBoundedJson } from "./strict-json";

const ENVELOPE_KEYS = ["version", "header", "db"] as const;
const DB_REQUIRED_KEYS = ["version", "entries", "groups"] as const;
const DB_OPTIONAL_KEYS = ["icons_optimized"] as const;
const ENTRY_BASE_KEYS = [
  "type",
  "uuid",
  "name",
  "issuer",
  "note",
  "icon",
  "favorite",
  "info",
  "groups",
] as const;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ICON_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/svg+xml"]);
const ICON_HASH_PATTERN = /^[0-9a-f]{64}$/u;
const textEncoder = new TextEncoder();
function malformed(): never {
  return failJson("IMPORT_MALFORMED");
}

function parseGroups(value: unknown): Map<string, string> {
  if (!Array.isArray(value)) return failJson("IMPORT_UNSUPPORTED");
  const items: unknown[] = value;
  if (items.length > IMPORT_LIMITS.maxEntries) failJson("IMPORT_LIMIT_EXCEEDED");
  const groups = new Map<string, string>();
  for (const item of items) {
    const group = requiredRecord(item);
    if (
      !exactKeys(group, ["uuid", "name"]) ||
      typeof group.uuid !== "string" ||
      !UUID_V4.test(group.uuid) ||
      typeof group.name !== "string" ||
      groups.has(group.uuid)
    )
      return failJson("IMPORT_UNSUPPORTED");
    groups.set(group.uuid, group.name);
  }
  return groups;
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateIcon(entry: Record<string, unknown>): void {
  if (entry.icon === null) {
    const hasMime = Object.hasOwn(entry, "icon_mime");
    const hasHash = Object.hasOwn(entry, "icon_hash");
    if (hasMime !== hasHash || (hasMime && (entry.icon_mime !== null || entry.icon_hash !== null)))
      malformed();
    return;
  }
  if (
    typeof entry.icon !== "string" ||
    typeof entry.icon_mime !== "string" ||
    !ICON_MIME_TYPES.has(entry.icon_mime) ||
    typeof entry.icon_hash !== "string" ||
    !ICON_HASH_PATTERN.test(entry.icon_hash)
  )
    malformed();
  const bytes = decodeCanonicalBase64(entry.icon, 1, IMPORT_LIMITS.maxInputBytes);
  if (bytes === null) malformed();
  try {
    const mimeBytes = textEncoder.encode(entry.icon_mime);
    const material = new Uint8Array(mimeBytes.byteLength + bytes.byteLength);
    material.set(mimeBytes);
    material.set(bytes, mimeBytes.byteLength);
    try {
      if (hex(sha256(material)) !== entry.icon_hash) malformed();
    } finally {
      material.fill(0);
    }
  } finally {
    bytes.fill(0);
  }
}

function parseAegisEntry(value: unknown, groups: Map<string, string>): OtpImportCandidate {
  if (!isPlainRecord(value)) malformed();
  const iconIsNull = value.icon === null;
  const hasNullIconAux =
    iconIsNull && Object.hasOwn(value, "icon_mime") && Object.hasOwn(value, "icon_hash");
  const entryKeys =
    iconIsNull && !hasNullIconAux
      ? ENTRY_BASE_KEYS
      : ([...ENTRY_BASE_KEYS, "icon_mime", "icon_hash"] as const);
  if (!exactKeys(value, entryKeys)) malformed();
  if (typeof value.type !== "string") return malformed();
  const type = value.type;
  if (type !== "totp" && type !== "hotp" && type !== "steam") return failJson("IMPORT_UNSUPPORTED");
  if (
    typeof value.uuid !== "string" ||
    !UUID_V4.test(value.uuid) ||
    typeof value.name !== "string" ||
    typeof value.issuer !== "string" ||
    typeof value.note !== "string" ||
    typeof value.favorite !== "boolean"
  )
    malformed();
  validateIcon(value);
  const info = requiredRecord(value.info);
  const required =
    type === "hotp"
      ? (["secret", "algo", "digits", "counter"] as const)
      : (["secret", "algo", "digits", "period"] as const);
  if (!exactKeys(info, required)) malformed();
  const algorithm = info.algo;
  if (algorithm !== "SHA1" && algorithm !== "SHA256" && algorithm !== "SHA512") malformed();
  if (!Number.isSafeInteger(info.digits)) malformed();
  let groupIds: readonly string[];
  try {
    groupIds = stringArray(value.groups);
  } catch {
    return malformed();
  }
  const tags = groupIds.map((id) => {
    const name = groups.get(id);
    if (name === undefined) return failJson("IMPORT_UNSUPPORTED");
    return name;
  });
  const base: Omit<OtpImportCandidate, "period" | "counter"> = {
    issuer: value.issuer,
    label: value.name,
    secret: canonicalJsonSecret(info.secret),
    otpType: type,
    algorithm,
    digits: info.digits as number,
    favorite: value.favorite,
    tags,
    note: value.note,
  };
  try {
    if (type === "hotp") {
      if (!Number.isSafeInteger(info.counter)) malformed();
      return validatedCandidate({ ...base, period: 0, counter: info.counter as number });
    }
    if (!Number.isSafeInteger(info.period)) malformed();
    return validatedCandidate({ ...base, period: info.period as number });
  } catch (error) {
    if (error instanceof JsonImportError && error.code === "IMPORT_LIMIT_EXCEEDED") throw error;
    return malformed();
  }
}

export function parseAegisExport(text: string): ParsedOtpImport {
  const raw = parseBoundedJson(text);
  if (!isPlainRecord(raw)) return failJson("IMPORT_MALFORMED");
  if (!Object.hasOwn(raw, "version") || !Object.hasOwn(raw, "header") || !Object.hasOwn(raw, "db"))
    failJson("IMPORT_UNSUPPORTED");
  if (!exactKeys(raw, ENVELOPE_KEYS) || raw.version !== 1) failJson("IMPORT_UNSUPPORTED");
  const header = requiredRecord(raw.header);
  const isEmptyHeader = exactKeys(header, []);
  const isNullHeader =
    exactKeys(header, ["slots", "params"]) && header.slots === null && header.params === null;
  if ((!isEmptyHeader && !isNullHeader) || typeof raw.db === "string")
    failJson("IMPORT_UNSUPPORTED");
  const db = requiredRecord(raw.db);
  if (!exactKeys(db, DB_REQUIRED_KEYS, DB_OPTIONAL_KEYS) || db.version !== 3)
    failJson("IMPORT_UNSUPPORTED");
  if (db.icons_optimized !== undefined && typeof db.icons_optimized !== "boolean")
    failJson("IMPORT_UNSUPPORTED");
  if (!Array.isArray(db.entries)) return failJson("IMPORT_UNSUPPORTED");
  const entries: unknown[] = db.entries;
  if (entries.length > IMPORT_LIMITS.maxEntries) failJson("IMPORT_LIMIT_EXCEEDED");
  const groups = parseGroups(db.groups);
  const entryIds = new Set<string>();
  for (const entry of entries) {
    if (isPlainRecord(entry) && typeof entry.uuid === "string") {
      if (entryIds.has(entry.uuid)) failJson("IMPORT_UNSUPPORTED");
      entryIds.add(entry.uuid);
    }
    if (isPlainRecord(entry) && Array.isArray(entry.groups)) {
      for (const groupId of entry.groups as unknown[]) {
        if (typeof groupId === "string" && !groups.has(groupId)) failJson("IMPORT_UNSUPPORTED");
      }
    }
  }
  const candidates: OtpImportCandidate[] = [];
  const rejected: { ordinal: number; reason: ImportReasonCode }[] = [];
  entries.forEach((entry, index) => {
    try {
      candidates.push(
        Object.freeze({ ...parseAegisEntry(entry, groups), sourceOrdinal: index + 1 }),
      );
    } catch (error) {
      const reason: ImportReasonCode =
        error instanceof JsonImportError && error.code === "IMPORT_LIMIT_EXCEEDED"
          ? "IMPORT_LIMIT_EXCEEDED"
          : error instanceof JsonImportError && error.code === "IMPORT_MALFORMED"
            ? "IMPORT_MALFORMED"
            : "IMPORT_UNSUPPORTED";
      rejected.push(Object.freeze({ ordinal: index + 1, reason }));
    }
  });
  return Object.freeze({
    format: "aegis",
    candidates: Object.freeze(candidates),
    rejected: Object.freeze(rejected),
  });
}
