import { isUnicodeScalarText } from "@shardpass/domain";

import { IMPORT_LIMITS, type ImportReasonCode } from "./import-model";

const URI_PREFIX = "otpauth-migration://offline?data=";
const MAX_PROTOBUF_BYTES = IMPORT_LIMITS.maxInputBytes;
const MAX_BASE64_LENGTH = Math.ceil(MAX_PROTOBUF_BYTES / 3) * 4;
const MAX_AGGREGATE_BASE64_LENGTH = MAX_BASE64_LENGTH + IMPORT_LIMITS.maxMigrationBatches * 4;
const BASE64_STANDARD = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const BASE64_STANDARD_UNPADDED = /^[A-Za-z0-9+/]*$/u;
const BASE64_URL_SAFE = /^[A-Za-z0-9_-]*$/u;

type ParserFailureCode = Extract<ImportReasonCode, "IMPORT_MALFORMED" | "IMPORT_LIMIT_EXCEEDED">;
type Base64Descriptor = Readonly<{ canonical: string; decodedLength: number }>;
type Base64Decoder = (canonical: string, decodedLength: number) => Uint8Array;

const fail = (code: ParserFailureCode): never => {
  throw new Error(code);
};

function hasMalformedPercentEncoding(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "%") continue;
    if (!/^[0-9A-Fa-f]{2}$/u.test(value.slice(index + 1, index + 3))) return true;
    index += 2;
  }
  return false;
}

function describeCanonicalBase64(value: string): Base64Descriptor {
  if (value.length === 0) fail("IMPORT_MALFORMED");
  if (value.length > MAX_BASE64_LENGTH) fail("IMPORT_LIMIT_EXCEEDED");
  if (value.length % 4 === 1) fail("IMPORT_MALFORMED");
  const hasStandard = /[+/]/u.test(value);
  const hasUrlSafe = /[-_]/u.test(value);
  if (hasStandard && hasUrlSafe) fail("IMPORT_MALFORMED");
  if (value.includes("=")) {
    if (hasUrlSafe || !BASE64_STANDARD.test(value)) fail("IMPORT_MALFORMED");
  } else if (!(hasUrlSafe ? BASE64_URL_SAFE : BASE64_STANDARD_UNPADDED).test(value)) {
    fail("IMPORT_MALFORMED");
  }
  const padding = (4 - (value.length % 4)) % 4;
  const canonical = value.replace(/-/gu, "+").replace(/_/gu, "/") + "=".repeat(padding);
  if (!BASE64_STANDARD.test(canonical)) fail("IMPORT_MALFORMED");
  const decodedLength =
    (canonical.length / 4) * 3 -
    (canonical.endsWith("==") ? 2 : 0) -
    (canonical.endsWith("=") && !canonical.endsWith("==") ? 1 : 0);
  if (decodedLength > MAX_PROTOBUF_BYTES) fail("IMPORT_LIMIT_EXCEEDED");
  return Object.freeze({ canonical, decodedLength });
}

const decodeCanonicalBase64: Base64Decoder = (canonical, decodedLength) => {
  let binary: string;
  try {
    binary = atob(canonical);
  } catch {
    return fail("IMPORT_MALFORMED");
  }
  if (binary.length !== decodedLength) fail("IMPORT_MALFORMED");
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  let binaryCopy = "";
  for (let offset = 0; offset < bytes.length; offset += 16_384) {
    binaryCopy += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
  }
  if (btoa(binaryCopy) !== canonical) {
    bytes.fill(0);
    fail("IMPORT_MALFORMED");
  }
  return bytes;
};

function extractEncodedData(uri: string): string {
  if (
    uri.length <= URI_PREFIX.length ||
    uri.length > URI_PREFIX.length + MAX_BASE64_LENGTH * 3 ||
    uri !== uri.trim() ||
    !isUnicodeScalarText(uri) ||
    uri.includes("\0") ||
    !uri.startsWith(URI_PREFIX)
  )
    fail("IMPORT_MALFORMED");
  const encoded = uri.slice(URI_PREFIX.length);
  if (encoded.includes("#") || encoded.includes("&") || hasMalformedPercentEncoding(encoded))
    fail("IMPORT_MALFORMED");
  let data: string;
  try {
    data = decodeURIComponent(encoded);
  } catch {
    return fail("IMPORT_MALFORMED");
  }
  if (data.length > MAX_BASE64_LENGTH) fail("IMPORT_LIMIT_EXCEEDED");
  return data;
}

export function decodeGoogleMigrationUriBytes(
  uris: readonly string[],
  decode: Base64Decoder = decodeCanonicalBase64,
): Uint8Array[] {
  if (uris.length === 0) fail("IMPORT_MALFORMED");
  if (uris.length > IMPORT_LIMITS.maxMigrationBatches) fail("IMPORT_LIMIT_EXCEEDED");

  const descriptors: Base64Descriptor[] = [];
  let aggregateDecodedLength = 0;
  let aggregateEncodedLength = 0;
  for (const uri of uris) {
    const encodedData = extractEncodedData(uri);
    aggregateEncodedLength += encodedData.length;
    if (
      !Number.isSafeInteger(aggregateEncodedLength) ||
      aggregateEncodedLength > MAX_AGGREGATE_BASE64_LENGTH
    )
      fail("IMPORT_LIMIT_EXCEEDED");
    const descriptor = describeCanonicalBase64(encodedData);
    aggregateDecodedLength += descriptor.decodedLength;
    if (
      !Number.isSafeInteger(aggregateDecodedLength) ||
      aggregateDecodedLength > MAX_PROTOBUF_BYTES
    )
      fail("IMPORT_LIMIT_EXCEEDED");
    descriptors.push(descriptor);
  }

  const payloads: Uint8Array[] = [];
  try {
    for (const descriptor of descriptors) {
      const payload = decode(descriptor.canonical, descriptor.decodedLength);
      if (!(payload instanceof Uint8Array) || payload.byteLength !== descriptor.decodedLength)
        fail("IMPORT_MALFORMED");
      payloads.push(payload);
    }
    return payloads;
  } catch (error) {
    for (const payload of payloads) payload.fill(0);
    throw error;
  }
}
