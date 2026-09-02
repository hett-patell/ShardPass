import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { z } from "zod/mini";

import { type RandomSource, webCryptoRandomSource } from "./random";

export const AEAD_KEY_BYTES = 32;
export const AEAD_NONCE_BYTES = 24;
export const AEAD_TAG_BYTES = 16;

const exactBytes = (length: number) =>
  z.custom<Uint8Array>(
    (value) => value instanceof Uint8Array && value.byteLength === length,
    `Value must be exactly ${length} bytes`,
  );

export const AeadEnvelopeSchema = z.strictObject({
  nonce: exactBytes(AEAD_NONCE_BYTES),
  ciphertext: z.custom<Uint8Array>(
    (value) => value instanceof Uint8Array && value.byteLength >= AEAD_TAG_BYTES,
    `Ciphertext must contain at least the ${AEAD_TAG_BYTES}-byte authentication tag`,
  ),
});

export type AeadEnvelope = z.infer<typeof AeadEnvelopeSchema>;

export interface AeadAssociatedData {
  readonly format: string;
  readonly formatVersion: number;
  readonly itemId: string;
  readonly kind: string;
  readonly schemaVersion: number;
  readonly revision: number;
}

const associatedDataFields = [
  "format",
  "formatVersion",
  "itemId",
  "kind",
  "schemaVersion",
  "revision",
] as const;

function bytes(value: Uint8Array | AeadAssociatedData): Uint8Array {
  return value instanceof Uint8Array ? value : encodeAssociatedData(value);
}

function assertKey(key: Uint8Array): void {
  if (key.byteLength !== AEAD_KEY_BYTES) throw new RangeError("AEAD requires a 32-byte key.");
}

function assertEnvelope(envelope: AeadEnvelope): void {
  if (envelope.nonce.byteLength !== AEAD_NONCE_BYTES) {
    throw new RangeError("AEAD envelope requires a 24-byte nonce.");
  }
  if (envelope.ciphertext.byteLength < AEAD_TAG_BYTES) {
    throw new RangeError("AEAD ciphertext must contain a 16-byte authentication tag.");
  }
}

export async function encryptEnvelope(
  key: Uint8Array,
  plaintext: Uint8Array,
  associatedData: Uint8Array | AeadAssociatedData,
  random: RandomSource = webCryptoRandomSource,
): Promise<AeadEnvelope> {
  assertKey(key);
  const nonce = random.randomBytes(AEAD_NONCE_BYTES);
  if (nonce.byteLength !== AEAD_NONCE_BYTES) {
    throw new RangeError("Random source returned an invalid nonce length.");
  }
  await Promise.resolve();
  return {
    nonce,
    ciphertext: xchacha20poly1305(key, nonce, bytes(associatedData)).encrypt(plaintext),
  };
}

export async function decryptEnvelope(
  key: Uint8Array,
  envelope: AeadEnvelope,
  associatedData: Uint8Array | AeadAssociatedData,
): Promise<Uint8Array> {
  assertKey(key);
  assertEnvelope(envelope);
  await Promise.resolve();
  try {
    return xchacha20poly1305(key, envelope.nonce, bytes(associatedData)).decrypt(
      envelope.ciphertext,
    );
  } catch {
    throw new Error("AEAD authentication failed.");
  }
}

function encodeField(value: string): Uint8Array {
  const payload = new TextEncoder().encode(value);
  const output = new Uint8Array(4 + payload.byteLength);
  new DataView(output.buffer).setUint32(0, payload.byteLength, false);
  output.set(payload, 4);
  return output;
}

export function encodeAssociatedData(value: AeadAssociatedData): Uint8Array {
  const encoded = associatedDataFields.map((field) => encodeField(String(value[field])));
  const length = encoded.reduce((total, field) => total + field.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const field of encoded) {
    output.set(field, offset);
    offset += field.byteLength;
  }
  return output;
}

export function decodeAssociatedData(encoded: Uint8Array): AeadAssociatedData {
  const values: string[] = [];
  let offset = 0;
  for (let fieldIndex = 0; fieldIndex < associatedDataFields.length; fieldIndex += 1) {
    if (offset + 4 > encoded.byteLength) throw new RangeError("Associated data is truncated.");
    const length = new DataView(encoded.buffer, encoded.byteOffset + offset, 4).getUint32(0, false);
    offset += 4;
    if (offset + length > encoded.byteLength) throw new RangeError("Associated data is truncated.");
    values.push(
      new TextDecoder("utf-8", { fatal: true }).decode(encoded.subarray(offset, offset + length)),
    );
    offset += length;
  }
  if (offset !== encoded.byteLength) throw new RangeError("Associated data has trailing bytes.");
  const [format, formatVersion, itemId, kind, schemaVersion, revision] = values;
  if (
    format === undefined ||
    itemId === undefined ||
    kind === undefined ||
    formatVersion === undefined ||
    schemaVersion === undefined ||
    revision === undefined
  ) {
    throw new RangeError("Associated data is incomplete.");
  }
  const numbers = [formatVersion, schemaVersion, revision].map(Number);
  if (!numbers.every(Number.isSafeInteger))
    throw new RangeError("Associated data number is invalid.");
  return {
    format,
    formatVersion: numbers[0] as number,
    itemId,
    kind,
    schemaVersion: numbers[1] as number,
    revision: numbers[2] as number,
  };
}
