import { createHash } from "node:crypto";
import { lstat, open, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateRawSync, inflateSync } from "node:zlib";

export const SECRET_SCANNER_SCHEMA_VERSION = 1;

const HASH_PATTERN = /^[a-f\d]{64}$/u;
const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".csv",
  ".d.mts",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".mts",
  ".proto",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const RATIONALES = new Set([
  "documented-public-key",
  "reserved-synthetic-fixture",
  "reviewed-public-identifier",
  "scanner-test-canary",
]);
const FINDING_KEYS = [
  "ruleId",
  "path",
  "fileSha256",
  "matchSha256",
  "startByte",
  "endByte",
  "count",
];
const ALLOWANCE_KEYS = [
  "schemaVersion",
  "scannerSchemaVersion",
  "mode",
  ...FINDING_KEYS,
  "rationale",
];
const REPORT_KEYS = [
  "schemaVersion",
  "mode",
  "rootName",
  "rootDigest",
  "allowlistSha256",
  "filesScanned",
  "findings",
  "allowancesUsed",
  "status",
];
const MAX_ZIP_ENTRIES = 128;
const MAX_ZIP_RATIO = 100;
const MAX_ZIP_DEPTH = 2;
const MAX_PNG_CHUNKS = 256;
const MAX_PNG_METADATA_BYTES = 64 * 1024;
const MAX_WASM_SECTIONS = 256;
const MAX_WASM_STRING_BYTES = 16 * 1024;
const MAX_WASM_METADATA_BYTES = 64 * 1024;

export const REPORTABLE_RULE_IDS = Object.freeze([
  "base32-secret",
  "bearer-token",
  "candidate-allowlist",
  "candidate-network-executable",
  "candidate-test-artifact",
  "environment-file",
  "fixture-marker",
  "high-entropy-literal",
  "jwt",
  "otpauth-uri",
  "pem-private-key",
  "secret-logging",
  "serialized-secret",
  "source-map",
  "test-helper",
  "url-credentials",
]);
const REPORTABLE_RULE_ID_SET = new Set(REPORTABLE_RULE_IDS);

const RULES = [
  {
    id: "pem-private-key",
    pattern:
      // Marker, a body of nothing but base64 lines, marker. Code that merely names the markers
      // (an importer deciding what it was handed) has quotes and punctuation in between.
      /-----BEGIN (?:ENCRYPTED |RSA |EC |OPENSSH )?PRIVATE KEY-----[ \t]*[\r\n]+(?:[ \t]*[A-Za-z\d+/=:,. -]{1,120}[\r\n]+)+[ \t]*-----END (?:ENCRYPTED |RSA |EC |OPENSSH )?PRIVATE KEY-----/gu,
  },
  { id: "otpauth-uri", pattern: /otpauth:\/\/[^\s"'`<>]+/giu },
  { id: "bearer-token", pattern: /\bBearer\s+[A-Za-z\d._~+/=-]{12,}/giu },
  // A password carried in a URL's authority (the part before the @). Neither half may
  // hold a slash or an @ of its own.
  {
    id: "url-credentials",
    pattern: /\b[a-z][a-z\d+.-]*:\/\/[^\s"'`/@:]+:[^\s"'`/@]{3,}@[a-z\d.-]+/giu,
  },
  // A JSON Web Token: three base64url parts, the first decoding to a JSON header.
  {
    id: "jwt",
    pattern: /\beyJ[A-Za-z\d_-]{10,}\.[A-Za-z\d_-]{10,}\.[A-Za-z\d_-]{10,}/gu,
  },
  {
    id: "serialized-secret",
    pattern:
      /(?<![A-Za-z\d_$])(?:["']?(?:password|passwd|passphrase|token|api[_-]?key|auth[_-]?key|private[_-]?key|secret|seed|ciphertext)["']?\s*[:=]\s*["'`])([^"'`\r\n]{6,})(?:["'`])/giu,
    group: 1,
    sourceOnly: true,
  },
  {
    id: "serialized-secret",
    pattern:
      /(?:[,{]\s*["']?(?:password|passwd|passphrase|token|api[_-]?key|auth[_-]?key|private[_-]?key|secret|seed|ciphertext)["']?\s*:\s*["'`])([^"'`\r\n]{6,})(?:["'`])/giu,
    group: 1,
    candidateOnly: true,
    candidateSerialized: true,
  },
  {
    id: "base32-secret",
    pattern:
      /["']?(?:secret|seed)["']?\s*[:=]\s*["'`]((?=[A-Z2-7]{16,128}(?:["'`\s]|$))(?=[A-Z2-7]*[2-7])[A-Z2-7]{16,128})/gu,
    group: 1,
    candidateOnly: true,
  },
  {
    id: "base32-secret",
    pattern: /\b(?=[A-Z2-7]{16,128}\b)(?=[A-Z2-7]*[2-7])[A-Z2-7]{16,128}\b/gu,
    sourceOnly: true,
  },
  {
    id: "secret-logging",
    pattern:
      /\b(?:console\s*(?:\.\s*(?:log|debug|info|warn|error)|\[\s*["'](?:log|debug|info|warn|error)["']\s*\])|diagnostics?\s*\.\s*(?:capture|record|emit|log))\s*\([^\r\n;]*(?:password|credential|token|secret|seed|key|ciphertext|otpauth)[^\r\n;]*\)/giu,
    sourceOnly: true,
  },
  { id: "source-map", pattern: /(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL\s*=\s*[^\s*]+/gu },
  {
    id: "test-helper",
    pattern:
      /\b(?:createVaultKeyMaterialForTesting|runDefaultArgon2idBenchmark|__shardpassRunDefaultArgon2idBenchmark|picker-harness|test-harness)\b/gu,
  },
  {
    id: "fixture-marker",
    pattern:
      /\b(?:TEST-ONLY|synthetic[^\r\n]{0,40}(?:credential[^\r\n]{0,40}fixture|fixture[^\r\n]{0,40}credential)|fixture[^\r\n]{0,40}credential)\b/giu,
    testContextOnly: true,
  },
  {
    id: "high-entropy-literal",
    pattern:
      /["'`]((?=[A-Za-z\d+/=_-]{32,160}["'`])(?=[A-Za-z\d+/=_-]*[A-Z])(?=[A-Za-z\d+/=_-]*[a-z])(?=[A-Za-z\d+/=_-]*\d)[A-Za-z\d+/=_-]{32,160})["'`]/gu,
    group: 1,
    entropy: true,
    candidateContext: true,
  },
];

function fail(category) {
  throw new Error(category);
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function resolvePath(value) {
  return value instanceof URL ? fileURLToPath(value) : path.resolve(value);
}
function bytewiseCompare(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function safeRelativePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\\") &&
    !/[?*[]/u.test(value) &&
    !path.posix.isAbsolute(value) &&
    path.posix.normalize(value) === value &&
    !value.split("/").includes("..") &&
    value.normalize("NFC") === value
  );
}
function validateFinding(value, category = "SECRET_SCAN_REPORT") {
  if (
    !exactKeys(value, FINDING_KEYS) ||
    typeof value.ruleId !== "string" ||
    !REPORTABLE_RULE_ID_SET.has(value.ruleId) ||
    !safeRelativePath(value.path) ||
    !HASH_PATTERN.test(value.fileSha256) ||
    !HASH_PATTERN.test(value.matchSha256) ||
    !Number.isSafeInteger(value.startByte) ||
    value.startByte < 0 ||
    !Number.isSafeInteger(value.endByte) ||
    value.endByte <= value.startByte ||
    !Number.isSafeInteger(value.count) ||
    value.count < 1
  )
    fail(category);
  return value;
}
function validateAllowance(value) {
  if (
    !exactKeys(value, ALLOWANCE_KEYS) ||
    value.schemaVersion !== 1 ||
    value.scannerSchemaVersion !== SECRET_SCANNER_SCHEMA_VERSION ||
    !["source", "candidate"].includes(value.mode) ||
    !RATIONALES.has(value.rationale)
  )
    fail("SECRET_SCAN_ALLOWLIST");
  validateFinding(
    Object.fromEntries(FINDING_KEYS.map((key) => [key, value[key]])),
    "SECRET_SCAN_ALLOWLIST",
  );
  return Object.freeze({ ...value });
}
export function parseSecretAllowlist(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("SECRET_SCAN_ALLOWLIST");
  }
  if (
    JSON.stringify(parsed) !== text ||
    !exactKeys(parsed, ["schemaVersion", "scannerSchemaVersion", "allowances"]) ||
    parsed.schemaVersion !== 1 ||
    parsed.scannerSchemaVersion !== SECRET_SCANNER_SCHEMA_VERSION ||
    !Array.isArray(parsed.allowances)
  )
    fail("SECRET_SCAN_ALLOWLIST");
  const allowances = parsed.allowances.map(validateAllowance);
  const identities = new Set();
  const groups = new Map();
  for (const allowance of allowances) {
    const identity = JSON.stringify(allowance);
    if (identities.has(identity)) fail("SECRET_SCAN_ALLOWLIST");
    identities.add(identity);
    const key = `${allowance.mode}\0${allowance.path}`;
    const group = groups.get(key) ?? [];
    group.push(allowance);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.startByte - b.startByte || a.endByte - b.endByte);
    for (let index = 1; index < group.length; index += 1)
      if (group[index].startByte < group[index - 1].endByte) fail("SECRET_SCAN_ALLOWLIST");
  }
  return Object.freeze(allowances);
}

function classify(relativePath, bytes) {
  const lower = relativePath.toLowerCase();
  const extension = lower.endsWith(".d.mts") ? ".d.mts" : path.posix.extname(lower);
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "png";
  if (bytes.subarray(0, 4).equals(Buffer.from("0061736d", "hex"))) return "wasm";
  if (bytes.subarray(0, 4).equals(Buffer.from("504b0304", "hex"))) return "zip";
  if (
    TEXT_EXTENSIONS.has(extension) ||
    path.posix.basename(lower).startsWith(".env") ||
    path.posix.basename(lower) === ".npmrc"
  )
    return "text";
  return "unknown";
}
function decodeText(bytes) {
  if (
    bytes.length >= 2 &&
    ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))
  )
    fail("SECRET_SCAN_ENCODING");
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    fail("SECRET_SCAN_ENCODING");
  if (bytes.includes(0)) fail("SECRET_SCAN_ENCODING");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("SECRET_SCAN_ENCODING");
  }
}
function entropy(value) {
  const frequencies = new Map();
  for (const character of value) frequencies.set(character, (frequencies.get(character) ?? 0) + 1);
  let result = 0;
  for (const count of frequencies.values()) {
    const probability = count / value.length;
    result -= probability * Math.log2(probability);
  }
  return result;
}
function finding(ruleId, relativePath, fileSha256, bytes, startByte, endByte, count = 1) {
  if (!REPORTABLE_RULE_ID_SET.has(ruleId)) fail("SECRET_SCAN_INTERNAL_RULE");
  return {
    ruleId,
    path: relativePath,
    fileSha256,
    matchSha256: sha256(bytes.subarray(startByte, endByte)),
    startByte,
    endByte,
    count,
  };
}
function candidateEntropyContext(text, match) {
  const before = text.slice(Math.max(0, match.index - 48), match.index).toLowerCase();
  return (
    /(?:password|passwd|passphrase|token|api[_-]?key|auth[_-]?key|private[_-]?key|secret|seed|ciphertext)\s*[:=]\s*["'`]?$|(?:authorization|credential)[^\r\n]{0,20}$/u.test(
      before,
    ) || /^(?:tok_|sk_|pk_|ghp_|eyj)/iu.test(match[1])
  );
}
const CANDIDATE_SERIALIZED_BENIGN_VALUES_BY_PATH = Object.freeze([
  {
    path: /(?:^|\/)schema(?:s|\/options)?(?:[./-]|$)/iu,
    values: new Set([
      "current-password",
      "hidden",
      "new-password",
      "one-time-code",
      "password",
      "text",
    ]),
  },
]);
function candidateSerializedValue(relativePath, value) {
  return !CANDIDATE_SERIALIZED_BENIGN_VALUES_BY_PATH.some(
    (entry) => entry.path.test(relativePath) && entry.values.has(value.toLowerCase()),
  );
}
function sourceSerializedValue(value) {
  const normalized = value.toLowerCase();
  return (
    !new Set(["current-password", "new-password", "one-time-code", "password", "text"]).has(
      normalized,
    ) &&
    !/^(?:enter (?:a |the )?|conceal |reveal |invalid |missing |canonical )[a-z\d ._-]+$/u.test(
      normalized,
    ) &&
    // A sentence or a label, not a credential: "Add a secret", "Show password", "No notes yet."
    !/\s/u.test(value) &&
    // A plain word, so a Record of display names ({ secret: "Secret" }) is not a finding.
    !/^[A-Za-z][a-z]+$/u.test(value)
  );
}
function scanText(relativePath, bytes, mode, fileSha256, text = decodeText(bytes)) {
  const findings = [];
  for (const rule of RULES) {
    if (
      (mode === "candidate" && rule.sourceOnly === true) ||
      (mode === "source" && rule.candidateOnly === true)
    )
      continue;
    rule.pattern.lastIndex = 0;
    for (let match = rule.pattern.exec(text); match !== null; match = rule.pattern.exec(text)) {
      const matched = rule.group === undefined ? match[0] : match[rule.group];
      const isTestContext =
        /(?:^|[/_.-])(?:tests?|fixtures?|__tests__|playwright|vitest)(?:$|[/_.-])/iu.test(
          relativePath,
        ) || /(?:fixture|canary|synthetic)/iu.test(match[0]);
      if (
        matched === undefined ||
        (rule.testContextOnly === true && !isTestContext) ||
        (mode === "source" &&
          /(?:^|\/)scripts\/(?:scan-build|scan-secrets)(?:\.d)?\.m(?:j|t)s$/u.test(relativePath) &&
          new Set(["base32-secret", "fixture-marker", "test-helper"]).has(rule.id)) ||
        (mode === "source" &&
          rule.id === "base32-secret" &&
          /(?:alphabet|regex|pattern|regexp)/iu.test(
            text.slice(Math.max(0, match.index - 96), match.index),
          )) ||
        (mode === "source" &&
          rule.id === "otpauth-uri" &&
          (match[0].includes("${") || !/[?&]secret=[A-Za-z2-7]/iu.test(match[0]))) ||
        (mode === "source" &&
          rule.id === "high-entropy-literal" &&
          /(?:alphabet|regex|pattern|regexp)/iu.test(
            text.slice(Math.max(0, match.index - 96), match.index),
          )) ||
        (rule.entropy === true && entropy(matched) < 4) ||
        (mode === "candidate" &&
          rule.candidateContext === true &&
          !candidateEntropyContext(text, match)) ||
        (mode === "candidate" &&
          rule.candidateSerialized === true &&
          !candidateSerializedValue(relativePath, matched)) ||
        (mode === "source" && rule.id === "serialized-secret" && !sourceSerializedValue(matched))
      )
        continue;
      const prefixChars = rule.group === undefined ? 0 : match[0].indexOf(matched);
      const startCharacter = match.index + prefixChars;
      const startByte = Buffer.byteLength(text.slice(0, startCharacter), "utf8");
      const endByte = startByte + Buffer.byteLength(matched, "utf8");
      findings.push(finding(rule.id, relativePath, fileSha256, bytes, startByte, endByte));
      if (match[0].length === 0) rule.pattern.lastIndex += 1;
    }
  }
  if (path.posix.basename(relativePath).toLowerCase().startsWith(".env"))
    findings.push(
      finding("environment-file", relativePath, fileSha256, bytes, 0, Math.max(bytes.length, 1)),
    );
  if (mode === "candidate") {
    if (/(?:^|\/)secret-allowlist\.json$/iu.test(relativePath))
      findings.push(
        finding(
          "candidate-allowlist",
          relativePath,
          fileSha256,
          bytes,
          0,
          Math.max(bytes.length, 1),
        ),
      );
    if (
      /(?:^|[/_.-])(?:tests?|fixtures?|__tests__|playwright|vitest)(?:$|[/_.-])/iu.test(
        relativePath,
      )
    )
      findings.push(
        finding(
          "candidate-test-artifact",
          relativePath,
          fileSha256,
          bytes,
          0,
          Math.max(bytes.length, 1),
        ),
      );
    const executable =
      /\b(?:fetch\s*\(\s*["']https?:\/\/|WebSocket\s*\(|EventSource\s*\(|sendBeacon\s*\(|XMLHttpRequest\s*\()/giu;
    for (let match = executable.exec(text); match !== null; match = executable.exec(text)) {
      const startByte = Buffer.byteLength(text.slice(0, match.index), "utf8");
      findings.push(
        finding(
          "candidate-network-executable",
          relativePath,
          fileSha256,
          bytes,
          startByte,
          startByte + Buffer.byteLength(match[0], "utf8"),
        ),
      );
    }
  }
  return findings.filter(
    (item) =>
      !(
        item.ruleId === "base32-secret" &&
        findings.some(
          (other) =>
            other.ruleId === "otpauth-uri" &&
            other.startByte <= item.startByte &&
            other.endByte >= item.endByte,
        )
      ) &&
      !(
        item.ruleId === "serialized-secret" &&
        findings.some(
          (other) =>
            new Set(["base32-secret", "bearer-token"]).has(other.ruleId) &&
            other.startByte === item.startByte &&
            other.endByte === item.endByte,
        )
      ) &&
      !(
        mode === "source" &&
        item.ruleId === "high-entropy-literal" &&
        findings.some(
          (other) =>
            other.ruleId === "serialized-secret" &&
            other.startByte === item.startByte &&
            other.endByte === item.endByte,
        )
      ),
  );
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function zipMemberPath(archivePath, memberPath) {
  return `${archivePath}!/${memberPath}`;
}
function parseZip(bytes, maxExpandedBytes) {
  if (bytes.length < 22) fail("SECRET_SCAN_MALFORMED_ZIP");
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1)
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  if (
    eocd < 0 ||
    eocd + 22 + bytes.readUInt16LE(eocd + 20) !== bytes.length ||
    bytes.readUInt16LE(eocd + 4) !== 0 ||
    bytes.readUInt16LE(eocd + 6) !== 0 ||
    bytes.readUInt16LE(eocd + 8) !== bytes.readUInt16LE(eocd + 10)
  )
    fail("SECRET_SCAN_MALFORMED_ZIP");
  const count = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (count > MAX_ZIP_ENTRIES || centralOffset + centralSize !== eocd)
    fail("SECRET_SCAN_ZIP_LIMIT");
  const entries = [];
  const seen = new Set();
  let offset = centralOffset;
  let expandedTotal = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > eocd || bytes.readUInt32LE(offset) !== 0x02014b50)
      fail("SECRET_SCAN_MALFORMED_ZIP");
    const flags = bytes.readUInt16LE(offset + 8),
      method = bytes.readUInt16LE(offset + 10),
      crc = bytes.readUInt32LE(offset + 16);
    const compressedSize = bytes.readUInt32LE(offset + 20),
      expandedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28),
      extraLength = bytes.readUInt16LE(offset + 30),
      commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42),
      end = offset + 46 + nameLength + extraLength + commentLength;
    if (
      end > eocd ||
      (flags & 1) !== 0 ||
      ![0, 8].includes(method) ||
      compressedSize === 0xffffffff ||
      expandedSize === 0xffffffff
    )
      fail("SECRET_SCAN_MALFORMED_ZIP");
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    let name;
    try {
      name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
    } catch {
      fail("SECRET_SCAN_MALFORMED_ZIP");
    }
    const isDirectory = name.endsWith("/");
    const normalizedName = isDirectory ? name.slice(0, -1) : name;
    if (!safeRelativePath(normalizedName) || seen.has(normalizedName.toLowerCase()))
      fail("SECRET_SCAN_MALFORMED_ZIP");
    seen.add(normalizedName.toLowerCase());
    expandedTotal += expandedSize;
    if (
      expandedTotal > maxExpandedBytes ||
      (compressedSize === 0 ? expandedSize > 0 : expandedSize / compressedSize > MAX_ZIP_RATIO)
    )
      fail("SECRET_SCAN_ZIP_LIMIT");
    entries.push({
      name,
      isDirectory,
      flags,
      method,
      crc,
      compressedSize,
      expandedSize,
      localOffset,
    });
    offset = end;
  }
  if (offset !== eocd) fail("SECRET_SCAN_MALFORMED_ZIP");
  return entries.map((entry) => {
    const o = entry.localOffset;
    if (
      o + 30 > centralOffset ||
      bytes.readUInt32LE(o) !== 0x04034b50 ||
      bytes.readUInt16LE(o + 6) !== entry.flags ||
      bytes.readUInt16LE(o + 8) !== entry.method
    )
      fail("SECRET_SCAN_MALFORMED_ZIP");
    const nameLength = bytes.readUInt16LE(o + 26),
      extraLength = bytes.readUInt16LE(o + 28),
      dataStart = o + 30 + nameLength + extraLength;
    if (dataStart + entry.compressedSize > centralOffset) fail("SECRET_SCAN_MALFORMED_ZIP");
    const localName = bytes.subarray(o + 30, o + 30 + nameLength);
    if (!localName.equals(Buffer.from(entry.name, "utf8"))) fail("SECRET_SCAN_MALFORMED_ZIP");
    if (entry.isDirectory) {
      if (entry.compressedSize !== 0 || entry.expandedSize !== 0) fail("SECRET_SCAN_MALFORMED_ZIP");
      return { ...entry, bytes: Buffer.alloc(0) };
    }
    const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);
    let expanded;
    try {
      expanded =
        entry.method === 0
          ? Buffer.from(compressed)
          : inflateRawSync(compressed, { maxOutputLength: maxExpandedBytes });
    } catch {
      fail("SECRET_SCAN_MALFORMED_ZIP");
    }
    if (expanded.length !== entry.expandedSize || crc32(expanded) !== entry.crc)
      fail("SECRET_SCAN_MALFORMED_ZIP");
    return { ...entry, bytes: expanded };
  });
}
function scanVirtualText(relativePath, bytes, mode) {
  if (bytes.length === 0) return [];
  const text = decodeText(bytes);
  return scanText(relativePath, bytes, mode, sha256(bytes), text);
}
function parsePng(bytes, relativePath, mode) {
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
    fail("SECRET_SCAN_MALFORMED_PNG");
  const findings = [];
  let offset = 8;
  let chunks = 0;
  let seenIhdr = false;
  let seenPlte = false;
  let seenIdat = false;
  let endedIdat = false;
  let seenIend = false;
  while (offset < bytes.length) {
    if (++chunks > MAX_PNG_CHUNKS || offset + 12 > bytes.length) fail("SECRET_SCAN_MALFORMED_PNG");
    const length = bytes.readUInt32BE(offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const end = dataEnd + 4;
    if (length > bytes.length || end > bytes.length) fail("SECRET_SCAN_MALFORMED_PNG");
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString("ascii");
    if (
      !/^[A-Za-z]{4}$/u.test(type) ||
      crc32(bytes.subarray(offset + 4, dataEnd)) !== bytes.readUInt32BE(dataEnd)
    )
      fail("SECRET_SCAN_MALFORMED_PNG");
    const data = bytes.subarray(dataStart, dataEnd);
    if (!seenIhdr) {
      if (type !== "IHDR" || length !== 13) fail("SECRET_SCAN_MALFORMED_PNG");
      const width = data.readUInt32BE(0),
        height = data.readUInt32BE(4);
      if (
        width === 0 ||
        height === 0 ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        ![0, 1].includes(data[12])
      )
        fail("SECRET_SCAN_MALFORMED_PNG");
      seenIhdr = true;
    } else if (type === "IHDR" || seenIend) fail("SECRET_SCAN_MALFORMED_PNG");
    else if (type === "PLTE") {
      if (seenPlte || seenIdat || length === 0 || length % 3 !== 0 || length > 768)
        fail("SECRET_SCAN_MALFORMED_PNG");
      seenPlte = true;
    } else if (type === "IDAT") {
      if (endedIdat) fail("SECRET_SCAN_MALFORMED_PNG");
      seenIdat = true;
    } else {
      if (seenIdat) endedIdat = true;
      if (type === "IEND") {
        if (!seenIdat || length !== 0 || end !== bytes.length) fail("SECRET_SCAN_MALFORMED_PNG");
        seenIend = true;
      } else if ((typeBytes[0] & 0x20) === 0) fail("SECRET_SCAN_MALFORMED_PNG");
      else if (["tEXt", "zTXt", "iTXt"].includes(type)) {
        const zero = data.indexOf(0);
        if (zero < 1 || zero > 79) fail("SECRET_SCAN_MALFORMED_PNG");
        let metadata;
        try {
          if (type === "tEXt") metadata = data.subarray(zero + 1);
          else if (type === "zTXt") {
            if (data[zero + 1] !== 0) fail("SECRET_SCAN_MALFORMED_PNG");
            metadata = inflateSync(data.subarray(zero + 2), {
              maxOutputLength: MAX_PNG_METADATA_BYTES + 1,
            });
          } else {
            const compressed = data[zero + 1],
              method = data[zero + 2];
            if (![0, 1].includes(compressed) || method !== 0) fail("SECRET_SCAN_MALFORMED_PNG");
            const languageEnd = data.indexOf(0, zero + 3);
            const translatedEnd = languageEnd < 0 ? -1 : data.indexOf(0, languageEnd + 1);
            if (languageEnd < 0 || translatedEnd < 0) fail("SECRET_SCAN_MALFORMED_PNG");
            const payload = data.subarray(translatedEnd + 1);
            metadata =
              compressed === 1
                ? inflateSync(payload, { maxOutputLength: MAX_PNG_METADATA_BYTES + 1 })
                : payload;
          }
        } catch (error) {
          if (error instanceof Error && error.message.startsWith("SECRET_SCAN_")) throw error;
          fail("SECRET_SCAN_PNG_LIMIT");
        }
        if (metadata.length > MAX_PNG_METADATA_BYTES) fail("SECRET_SCAN_PNG_LIMIT");
        findings.push(...scanVirtualText(`${relativePath}!/${type}-${chunks}.txt`, metadata, mode));
      }
    }
    offset = end;
  }
  if (!seenIend || offset !== bytes.length) fail("SECRET_SCAN_MALFORMED_PNG");
  return findings;
}
function readWasmUleb(bytes, state, limit = 0xffffffff) {
  let value = 0;
  let shift = 0;
  const start = state.offset;
  for (let count = 0; count < 5; count += 1) {
    if (state.offset >= bytes.length) fail("SECRET_SCAN_MALFORMED_WASM");
    const byte = bytes[state.offset++];
    if (count === 4 && (byte & 0xf0) !== 0) fail("SECRET_SCAN_MALFORMED_WASM");
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) {
      if ((state.offset - start > 1 && byte === 0) || value > limit)
        fail("SECRET_SCAN_MALFORMED_WASM");
      return value;
    }
    shift += 7;
  }
  fail("SECRET_SCAN_MALFORMED_WASM");
}
function readWasmString(bytes, state) {
  const length = readWasmUleb(bytes, state, MAX_WASM_STRING_BYTES);
  if (state.offset + length > bytes.length) fail("SECRET_SCAN_MALFORMED_WASM");
  const value = bytes.subarray(state.offset, state.offset + length);
  state.offset += length;
  decodeText(value);
  return value;
}
function parseWasm(bytes, relativePath, mode) {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(Buffer.from("0061736d01000000", "hex")))
    fail("SECRET_SCAN_MALFORMED_WASM");
  const findings = [];
  const state = { offset: 8 };
  let sections = 0;
  let lastSection = 0;
  let metadataTotal = 0;
  while (state.offset < bytes.length) {
    if (++sections > MAX_WASM_SECTIONS) fail("SECRET_SCAN_WASM_LIMIT");
    const id = bytes[state.offset++];
    if (id > 12 || (id !== 0 && id <= lastSection)) fail("SECRET_SCAN_MALFORMED_WASM");
    if (id !== 0) lastSection = id;
    const length = readWasmUleb(bytes, state, bytes.length);
    const end = state.offset + length;
    if (end > bytes.length) fail("SECRET_SCAN_MALFORMED_WASM");
    const section = bytes.subarray(state.offset, end);
    if (id === 0) {
      const inner = { offset: 0 };
      const name = readWasmString(section, inner);
      const payload = section.subarray(inner.offset);
      metadataTotal += name.length + payload.length;
      if (metadataTotal > MAX_WASM_METADATA_BYTES) fail("SECRET_SCAN_WASM_LIMIT");
      findings.push(...scanVirtualText(`${relativePath}!/custom-${sections}-name.txt`, name, mode));
      if (payload.length > 0)
        findings.push(
          ...scanVirtualText(`${relativePath}!/custom-${sections}-data.txt`, payload, mode),
        );
    } else if (id === 2 || id === 7) {
      const inner = { offset: 0 };
      const count = readWasmUleb(section, inner, 10_000);
      const strings = [];
      for (let index = 0; index < count; index += 1) {
        if (id === 2) strings.push(readWasmString(section, inner));
        strings.push(readWasmString(section, inner));
        if (inner.offset >= section.length) fail("SECRET_SCAN_MALFORMED_WASM");
        const kind = section[inner.offset++];
        if (kind > 4) fail("SECRET_SCAN_MALFORMED_WASM");
        if (kind === 0) readWasmUleb(section, inner);
        else fail("SECRET_SCAN_MALFORMED_WASM");
      }
      if (inner.offset !== section.length) fail("SECRET_SCAN_MALFORMED_WASM");
      metadataTotal += strings.reduce((total, value) => total + value.length, 0);
      if (metadataTotal > MAX_WASM_METADATA_BYTES) fail("SECRET_SCAN_WASM_LIMIT");
      const text = Buffer.from(
        strings
          .map((value, index) =>
            index % 2 === 0 && id === 2 ? `${value.toString()}=` : `"${value.toString()}"`,
          )
          .join("\n"),
      );
      findings.push(
        ...scanVirtualText(`${relativePath}!/section-${id}-${sections}.txt`, text, mode),
      );
    }
    state.offset = end;
  }
  return findings;
}
function scanBytes(relativePath, bytes, mode, limits, depth = 0) {
  const classification = classify(relativePath, bytes.subarray(0, 16));
  const fileSha256 = sha256(bytes);
  if (classification === "unknown") fail("SECRET_SCAN_UNKNOWN_TYPE");
  if (classification === "text") {
    const text = decodeText(bytes);
    if (relativePath.toLowerCase().endsWith(".json")) {
      try {
        JSON.parse(text);
      } catch {
        fail("SECRET_SCAN_MALFORMED");
      }
    }
    return scanText(relativePath, bytes, mode, fileSha256, text);
  }
  if (classification === "png") return parsePng(bytes, relativePath, mode);
  if (classification === "wasm") return parseWasm(bytes, relativePath, mode);
  if (classification === "zip") {
    if (depth >= MAX_ZIP_DEPTH) fail("SECRET_SCAN_ZIP_LIMIT");
    const findings = [];
    for (const entry of parseZip(bytes, limits.maxBinaryBytes)) {
      if (entry.isDirectory) continue;
      const memberPath = zipMemberPath(relativePath, entry.name);
      const memberClassification = classify(entry.name, entry.bytes.subarray(0, 16));
      if (memberClassification === "unknown") fail("SECRET_SCAN_UNKNOWN_TYPE");
      findings.push(...scanBytes(memberPath, entry.bytes, mode, limits, depth + 1));
    }
    return findings;
  }
  return [];
}

async function readBoundedFile(filePath, limit, category) {
  let handle;
  try {
    handle = await open(filePath, "r");
    const stat = await handle.stat();
    if (stat.size > limit) fail(category);
    const chunks = [];
    let total = 0,
      position = 0;
    for (;;) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, limit - total + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      total += bytesRead;
      position += bytesRead;
      if (total > limit) fail(category);
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("SECRET_SCAN_")) throw error;
    fail("SECRET_SCAN_UNREADABLE");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
async function readPrefix(filePath, length) {
  let handle;
  try {
    handle = await open(filePath, "r");
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } catch {
    fail("SECRET_SCAN_UNREADABLE");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
async function walk(root) {
  const rootStat = await lstat(root).catch(() => fail("SECRET_SCAN_ROOT"));
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("SECRET_SCAN_ROOT");
  const files = [],
    seen = new Set();
  async function visit(directory, prefix) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      fail("SECRET_SCAN_UNREADABLE");
    }
    entries.sort((a, b) => bytewiseCompare(a.name, b.name));
    for (const entry of entries) {
      const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (!safeRelativePath(relativePath)) fail("SECRET_SCAN_UNSTABLE_PATH");
      const collisionKey = relativePath.normalize("NFC").toLowerCase();
      if (seen.has(collisionKey)) fail("SECRET_SCAN_PATH_COLLISION");
      seen.add(collisionKey);
      const absolutePath = path.join(directory, entry.name);
      const stat = await lstat(absolutePath).catch(() => fail("SECRET_SCAN_UNREADABLE"));
      if (stat.isSymbolicLink()) fail("SECRET_SCAN_NONREGULAR");
      else if (stat.isDirectory()) await visit(absolutePath, relativePath);
      else if (stat.isFile()) files.push({ absolutePath, path: relativePath });
      else fail("SECRET_SCAN_NONREGULAR");
    }
  }
  await visit(root, "");
  return files.sort((a, b) => bytewiseCompare(a.path, b.path));
}
function allowanceIdentity(value) {
  return ALLOWANCE_KEYS.map((key) => String(value[key])).join("\0");
}
function compareFindings(left, right) {
  return (
    bytewiseCompare(left.path, right.path) ||
    left.startByte - right.startByte ||
    left.endByte - right.endByte ||
    bytewiseCompare(left.ruleId, right.ruleId) ||
    bytewiseCompare(left.matchSha256, right.matchSha256)
  );
}
function compareAllowances(left, right) {
  return (
    compareFindings(left, right) ||
    bytewiseCompare(left.mode, right.mode) ||
    bytewiseCompare(left.rationale, right.rationale)
  );
}

export async function scanSecretRoot(options) {
  if (
    options === null ||
    typeof options !== "object" ||
    Object.keys(options).sort().join(",") !==
      "allowlistPath,maxBinaryBytes,maxTextBytes,mode,root,rootName" ||
    !["source", "candidate"].includes(options.mode) ||
    typeof options.rootName !== "string" ||
    options.rootName.length === 0 ||
    !Number.isSafeInteger(options.maxTextBytes) ||
    options.maxTextBytes < 1 ||
    !Number.isSafeInteger(options.maxBinaryBytes) ||
    options.maxBinaryBytes < 1
  )
    fail("SECRET_SCAN_OPTIONS");
  const root = resolvePath(options.root),
    allowlistPath = resolvePath(options.allowlistPath);
  const allowlistBytes = await readFile(allowlistPath).catch(() => fail("SECRET_SCAN_ALLOWLIST"));
  const allowlistText = decodeText(allowlistBytes);
  const allowances = parseSecretAllowlist(allowlistText);
  if (allowances.some((allowance) => allowance.mode !== options.mode))
    fail("SECRET_SCAN_UNUSED_ALLOWANCE");
  const files = await walk(root),
    findings = [],
    rootHasher = createHash("sha256");
  for (const file of files) {
    const stat = await lstat(file.absolutePath).catch(() => fail("SECRET_SCAN_UNREADABLE"));
    const sniff = await readPrefix(file.absolutePath, 16);
    const classification = classify(file.path, sniff);
    if (classification === "unknown") {
      if (stat.size > options.maxBinaryBytes) fail("SECRET_SCAN_BINARY_LIMIT");
      fail("SECRET_SCAN_UNKNOWN_TYPE");
    }
    const limit = classification === "text" ? options.maxTextBytes : options.maxBinaryBytes;
    const bytes = await readBoundedFile(
      file.absolutePath,
      limit,
      classification === "text" ? "SECRET_SCAN_TEXT_LIMIT" : "SECRET_SCAN_BINARY_LIMIT",
    );
    rootHasher.update(Buffer.from(file.path, "utf8"));
    rootHasher.update(Buffer.from([0]));
    rootHasher.update(bytes);
    rootHasher.update(Buffer.from([0]));
    findings.push(...scanBytes(file.path, bytes, options.mode, options));
  }
  findings.sort(compareFindings);
  const remaining = new Map(
    allowances.map((allowance) => [allowanceIdentity(allowance), allowance]),
  );
  const unallowed = [],
    allowancesUsed = [];
  for (const item of findings) {
    const matching = allowances.find(
      (allowance) =>
        allowance.mode === options.mode &&
        FINDING_KEYS.every((key) => allowance[key] === item[key]),
    );
    if (matching !== undefined && remaining.delete(allowanceIdentity(matching)))
      allowancesUsed.push(matching);
    else unallowed.push(item);
  }
  if (remaining.size > 0) fail("SECRET_SCAN_UNUSED_ALLOWANCE");
  allowancesUsed.sort(compareAllowances);
  const report = {
    schemaVersion: 1,
    mode: options.mode,
    rootName: options.rootName,
    rootDigest: rootHasher.digest("hex"),
    allowlistSha256: sha256(allowlistBytes),
    filesScanned: files.length,
    findings: unallowed,
    allowancesUsed,
    status: unallowed.length === 0 ? "PASS" : "FAIL",
  };
  verifySecretScanReport(report);
  return report;
}

export function verifySecretScanReport(report) {
  if (
    !exactKeys(report, REPORT_KEYS) ||
    report.schemaVersion !== 1 ||
    !["source", "candidate"].includes(report.mode) ||
    typeof report.rootName !== "string" ||
    report.rootName.length === 0 ||
    !HASH_PATTERN.test(report.rootDigest) ||
    !HASH_PATTERN.test(report.allowlistSha256) ||
    !Number.isSafeInteger(report.filesScanned) ||
    report.filesScanned < 0 ||
    !Array.isArray(report.findings) ||
    !Array.isArray(report.allowancesUsed) ||
    !["PASS", "FAIL"].includes(report.status) ||
    (report.status === "PASS") !== (report.findings.length === 0)
  )
    fail("SECRET_SCAN_REPORT");
  for (const item of report.findings) validateFinding(item);
  for (const allowance of report.allowancesUsed) {
    validateAllowance(allowance);
    if (allowance.mode !== report.mode) fail("SECRET_SCAN_REPORT");
  }
  if (
    report.findings.some(
      (item, index) => index > 0 && compareFindings(report.findings[index - 1], item) >= 0,
    ) ||
    report.allowancesUsed.some(
      (item, index) => index > 0 && compareAllowances(report.allowancesUsed[index - 1], item) >= 0,
    )
  )
    fail("SECRET_SCAN_REPORT");
  const all = [...report.findings, ...report.allowancesUsed];
  const identities = new Set();
  for (const item of all) {
    const identity = FINDING_KEYS.map((key) => String(item[key])).join("\0");
    if (identities.has(identity)) fail("SECRET_SCAN_REPORT");
    identities.add(identity);
  }
}

async function main() {
  const [root, mode = "source", allowlistPath = "config/project1-secret-allowlist.json"] =
    process.argv.slice(2);
  if (root === undefined) fail("SECRET_SCAN_OPTIONS");
  const report = await scanSecretRoot({
    root,
    rootName: path.basename(path.resolve(root)),
    mode,
    allowlistPath,
    maxTextBytes: 8 * 1024 * 1024,
    maxBinaryBytes: 32 * 1024 * 1024,
  });
  if (report.status !== "PASS") {
    process.stderr.write(`Secret scan failed: ${report.findings.length} finding(s)\n`);
    process.exitCode = 1;
  } else process.stdout.write(`Secret scan passed: ${report.filesScanned} file(s)\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error && error.message.startsWith("SECRET_SCAN_") ? error.message : "SECRET_SCAN_INTERNAL"}\n`,
    );
    process.exitCode = 1;
  });
