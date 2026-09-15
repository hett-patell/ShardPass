import { isCanonicalUnpaddedBase32, isUnicodeScalarText } from "@shardpass/domain";
import { MAX_OTP_AUTH_URI_LENGTH, parseOtpAuthUri as parseStrictOtpAuthUri } from "@shardpass/otp";

import {
  IMPORT_LIMITS,
  type ImportReasonCode,
  type OtpImportCandidate,
  type ParsedOtpImport,
} from "./import-model";

const MAX_QUERY_PARAMETERS = 32;
const KNOWN_PARAMETERS = new Set(["secret", "issuer", "algorithm", "digits", "period", "counter"]);
const SYNTHETIC_METADATA = Object.freeze({
  id: "00000000-0000-7000-8000-000000000000",
  revision: 1,
  createdAt: "2000-01-01T00:00:00.000Z",
  updatedAt: "2000-01-01T00:00:00.000Z",
});

type ParserFailureCode = Extract<
  ImportReasonCode,
  "IMPORT_MALFORMED" | "IMPORT_UNSUPPORTED" | "IMPORT_LIMIT_EXCEEDED"
>;

class OtpImportParseError extends Error {
  readonly code: ParserFailureCode;

  constructor(code: ParserFailureCode) {
    super(code);
    this.name = "OtpImportParseError";
    this.code = code;
  }
}

const fail = (code: ParserFailureCode): never => {
  throw new OtpImportParseError(code);
};

function measureBoundedText(text: string): { bytes: number; scalars: number } {
  if (!isUnicodeScalarText(text)) fail("IMPORT_MALFORMED");
  let bytes = 0;
  let scalars = 0;
  for (const character of text) {
    scalars += 1;
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes > IMPORT_LIMITS.maxInputBytes || scalars > IMPORT_LIMITS.maxTextScalars)
      fail("IMPORT_LIMIT_EXCEEDED");
  }
  return { bytes, scalars };
}

function hasMalformedPercentEncoding(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "%") {
      if (!/^[0-9A-Fa-f]{2}$/u.test(value.slice(index + 1, index + 3))) return true;
      index += 2;
    }
  }
  return false;
}

function strictDecode(value: string): string {
  if (hasMalformedPercentEncoding(value)) fail("IMPORT_MALFORMED");
  try {
    const decoded = decodeURIComponent(value);
    if (!isUnicodeScalarText(decoded) || decoded.includes("\0")) fail("IMPORT_MALFORMED");
    return decoded;
  } catch {
    return fail("IMPORT_MALFORMED");
  }
}

function parseInteger(value: string | null): number {
  if (value === null || !/^(?:0|[1-9]\d*)$/u.test(value)) fail("IMPORT_UNSUPPORTED");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) fail("IMPORT_UNSUPPORTED");
  return parsed;
}

function normalizeAlgorithm(value: string | null): "SHA1" | "SHA256" | "SHA512" {
  const normalized = (value ?? "SHA1").replace(/-/gu, "").toUpperCase();
  if (normalized === "SHA1" || normalized === "SHA256" || normalized === "SHA512")
    return normalized;
  return fail("IMPORT_UNSUPPORTED");
}

function canonicalizeSecret(value: string): string {
  const decoded = strictDecode(value.replace(/\+/gu, "%20"));
  const canonical = decoded.replace(/[\s-]/gu, "").replace(/=+$/u, "").toUpperCase();
  if (!isCanonicalUnpaddedBase32(canonical)) fail("IMPORT_MALFORMED");
  return canonical;
}

export function parseOtpAuthUri(uri: string): OtpImportCandidate {
  if (
    uri.length === 0 ||
    uri.length > MAX_OTP_AUTH_URI_LENGTH ||
    uri !== uri.trim() ||
    /\s/u.test(uri) ||
    !isUnicodeScalarText(uri) ||
    uri.includes("\0")
  )
    fail("IMPORT_MALFORMED");

  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return fail("IMPORT_MALFORMED");
  }

  if (
    parsed.protocol !== "otpauth:" ||
    (parsed.hostname !== "totp" && parsed.hostname !== "hotp" && parsed.hostname !== "steam") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.hash !== ""
  )
    fail("IMPORT_MALFORMED");

  const rawQuery = uri.slice(uri.indexOf("?") + 1);
  if (!uri.includes("?") || rawQuery.length === 0) fail("IMPORT_MALFORMED");
  const rawFields = rawQuery.split("&");
  if (rawFields.length > MAX_QUERY_PARAMETERS) fail("IMPORT_MALFORMED");

  const seen = new Set<string>();
  for (const field of rawFields) {
    const separator = field.indexOf("=");
    const rawName = separator < 0 ? field : field.slice(0, separator);
    const rawValue = separator < 0 ? "" : field.slice(separator + 1);
    const name = strictDecode(rawName.replace(/\+/gu, "%20"));
    strictDecode(rawValue.replace(/\+/gu, "%20"));
    if (
      seen.has(name) ||
      (!KNOWN_PARAMETERS.has(name) &&
        (name.toLowerCase().startsWith("x-") || KNOWN_PARAMETERS.has(name.toLowerCase())))
    )
      fail("IMPORT_MALFORMED");
    seen.add(name);
  }

  const rawPath = parsed.pathname.slice(1);
  if (rawPath.length === 0) fail("IMPORT_MALFORMED");
  const decodedPath = strictDecode(rawPath);
  const queryIssuer = parsed.searchParams.get("issuer")?.trim() ?? null;
  if (queryIssuer !== null && (!isUnicodeScalarText(queryIssuer) || queryIssuer.includes("\0")))
    fail("IMPORT_MALFORMED");

  const separator = decodedPath.indexOf(":");
  const labelIssuer = separator < 0 ? "" : decodedPath.slice(0, separator).trim();
  if (separator >= 0 && labelIssuer === "") fail("IMPORT_MALFORMED");
  // "GitHub:alice" with issuer=github is one issuer spelled two ways, not a conflict.
  const fold = (value: string) => value.normalize("NFKC").toLowerCase();
  if (
    queryIssuer !== null &&
    separator >= 0 &&
    !fold(decodedPath).startsWith(`${fold(queryIssuer)}:`)
  )
    fail("IMPORT_MALFORMED");

  const secretValue = parsed.searchParams.get("secret");
  const canonicalSecret =
    secretValue === null ? fail("IMPORT_MALFORMED") : canonicalizeSecret(secretValue);

  const authority = parsed.hostname;
  const issuer = queryIssuer ?? labelIssuer;
  const algorithm = normalizeAlgorithm(parsed.searchParams.get("algorithm"));
  const digitsValue = parsed.searchParams.get("digits");
  const periodValue = parsed.searchParams.get("period");
  const counterValue = parsed.searchParams.get("counter");
  // Steam Guard travels under several conventions: its own authority, KeePassXC's
  // `encoder=steam`, the "Steam" issuer that older exporters used, or simply five digits,
  // which no other scheme produces.
  const steam =
    authority === "steam" ||
    (authority === "totp" &&
      (parsed.searchParams.get("encoder")?.trim().toLowerCase() === "steam" ||
        issuer.toLowerCase() === "steam" ||
        labelIssuer.toLowerCase() === "steam" ||
        digitsValue === "5"));

  if (authority === "hotp") {
    if (periodValue !== null) fail("IMPORT_UNSUPPORTED");
    const counter = counterValue === null ? fail("IMPORT_UNSUPPORTED") : counterValue;
    parseInteger(counter);
  } else if (counterValue !== null) {
    fail("IMPORT_UNSUPPORTED");
  }

  const digits = digitsValue === null ? (steam ? 5 : 6) : parseInteger(digitsValue);
  const period = authority === "hotp" ? 0 : periodValue === null ? 30 : parseInteger(periodValue);
  if (steam) {
    if (algorithm !== "SHA1" || digits !== 5 || period !== 30) fail("IMPORT_UNSUPPORTED");
  } else if (
    // What the vault's schema and generator accept: six to ten digits.
    digits < 6 ||
    digits > 10 ||
    (authority === "totp" && (period < 1 || period > 300))
  ) {
    fail("IMPORT_UNSUPPORTED");
  }

  try {
    // The strict parser only knows Steam by its authority, so the other spellings are
    // rewritten onto it; everything else in the URI is left as it was.
    const strictUri =
      steam && authority !== "steam" ? `otpauth://steam${parsed.pathname}${parsed.search}` : uri;
    const item = parseStrictOtpAuthUri(strictUri, SYNTHETIC_METADATA);
    const candidate: OtpImportCandidate = {
      issuer: item.issuer,
      label: item.label,
      secret: canonicalSecret,
      otpType: item.otpType,
      algorithm: item.algorithm,
      digits: item.digits,
      period: item.period,
      ...(item.counter === undefined ? {} : { counter: item.counter }),
      favorite: false,
      tags: Object.freeze([]),
      note: "",
    };
    return Object.freeze(candidate);
  } catch {
    return fail("IMPORT_MALFORMED");
  }
}

export function parseOtpAuthLines(text: string): ParsedOtpImport {
  measureBoundedText(text);

  let nonblankLines = 0;
  let lineStart = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index !== text.length && text[index] !== "\n") continue;
    const rawEnd = index > lineStart && text[index - 1] === "\r" ? index - 1 : index;
    const line = text.slice(lineStart, rawEnd);
    if (line.trim().length > 0) {
      nonblankLines += 1;
      if (nonblankLines > IMPORT_LIMITS.maxEntries) fail("IMPORT_LIMIT_EXCEEDED");
      if (line.length > MAX_OTP_AUTH_URI_LENGTH) fail("IMPORT_LIMIT_EXCEEDED");
    }
    lineStart = index + 1;
  }
  if (nonblankLines === 0) fail("IMPORT_MALFORMED");

  const candidates: OtpImportCandidate[] = [];
  const rejected: { ordinal: number; reason: ImportReasonCode }[] = [];
  let ordinal = 0;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.trim().length === 0) continue;
    ordinal += 1;
    try {
      candidates.push(Object.freeze({ ...parseOtpAuthUri(line), sourceOrdinal: ordinal }));
    } catch (error) {
      const reason =
        error instanceof OtpImportParseError && error.code === "IMPORT_UNSUPPORTED"
          ? "IMPORT_UNSUPPORTED"
          : "IMPORT_MALFORMED";
      rejected.push(Object.freeze({ ordinal, reason }));
    }
  }

  return Object.freeze({
    format: "otpauth",
    candidates: Object.freeze(candidates),
    rejected: Object.freeze(rejected),
  });
}
