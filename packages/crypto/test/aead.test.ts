import { describe, expect, it } from "vitest";

import {
  AeadEnvelopeSchema,
  decodeAssociatedData,
  decryptEnvelope,
  encodeAssociatedData,
  encryptEnvelope,
  type AeadAssociatedData,
} from "../src/aead";
import { createDeterministicRandomSource } from "../src/random";

const hex = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, "hex"));
const toHex = (value: Uint8Array): string => Buffer.from(value).toString("hex");

const associatedData: AeadAssociatedData = Object.freeze({
  format: "shardpass-encrypted-record",
  formatVersion: 1,
  itemId: "01J00000000000000000000000",
  kind: "otp",
  schemaVersion: 1,
  revision: 7,
});

describe("XChaCha20-Poly1305 envelopes", () => {
  it("matches the CFRG XChaCha20-Poly1305 AEAD vector", async () => {
    const key = hex("808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f");
    const nonce = hex("404142434445464748494a4b4c4d4e4f5051525354555657");
    const aad = hex("50515253c0c1c2c3c4c5c6c7");
    const plaintext = hex(
      "4c616469657320616e642047656e746c656d656e206f662074686520636c617373206f66202739393a204966204920636f756c64206f6666657220796f75206f6e6c79206f6e652074697020666f7220746865206675747572652c2073756e73637265656e20776f756c642062652069742e",
    );
    const expected =
      "bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb731c7f1b0b4aa6440bf3a82f4eda7e39ae64c6708c54c216cb96b72e1213b4522f8c9ba40db5d945b11b69b982c1bb9e3f3fac2bc369488f76b2383565d3fff921f9664c97637da9768812f615c68b13b52ec0875924c1c7987947deafd8780acf49";

    const envelope = await encryptEnvelope(
      key,
      plaintext,
      aad,
      createDeterministicRandomSource(nonce),
    );

    expect(toHex(envelope.nonce)).toBe(toHex(nonce));
    expect(toHex(envelope.ciphertext)).toBe(expected);
    await expect(decryptEnvelope(key, envelope, aad)).resolves.toEqual(plaintext);
  });

  it("strictly validates exact envelope fields and byte lengths", () => {
    const valid = { nonce: new Uint8Array(24), ciphertext: new Uint8Array(16) };
    expect(AeadEnvelopeSchema.parse(valid)).toEqual(valid);
    expect(() => AeadEnvelopeSchema.parse({ ...valid, extra: true })).toThrow();
    expect(() =>
      AeadEnvelopeSchema.parse({ nonce: new Uint8Array(23), ciphertext: new Uint8Array(16) }),
    ).toThrow();
    expect(() =>
      AeadEnvelopeSchema.parse({ nonce: new Uint8Array(24), ciphertext: new Uint8Array(15) }),
    ).toThrow();
  });

  it("canonically length-prefixes fixed associated-data fields", () => {
    const encoded = encodeAssociatedData(associatedData);
    expect(decodeAssociatedData(encoded)).toEqual(associatedData);
    expect(encoded.slice(0, 4)).toEqual(new Uint8Array([0, 0, 0, 26]));
  });

  it.each([
    ["item ID", { itemId: "01J00000000000000000000001" }],
    ["kind", { kind: "login" }],
    ["revision", { revision: 8 }],
    ["schema version", { schemaVersion: 2 }],
    ["format", { format: "other-record" }],
  ])("rejects modified %s associated data", async (_label, override) => {
    const key = new Uint8Array(32).fill(1);
    const envelope = await encryptEnvelope(
      key,
      new TextEncoder().encode("secret"),
      encodeAssociatedData(associatedData),
      createDeterministicRandomSource(new Uint8Array(24).fill(2)),
    );
    const modified = encodeAssociatedData({ ...associatedData, ...override });

    await expect(decryptEnvelope(key, envelope, modified)).rejects.toThrow(/authentication/iu);
  });

  it("rejects modified nonce and ciphertext", async () => {
    const key = new Uint8Array(32).fill(3);
    const aad = encodeAssociatedData(associatedData);
    const envelope = await encryptEnvelope(
      key,
      new TextEncoder().encode("secret"),
      aad,
      createDeterministicRandomSource(new Uint8Array(24).fill(4)),
    );
    const nonce = envelope.nonce.slice();
    nonce[0] = (nonce[0] ?? 0) ^ 1;
    const ciphertext = envelope.ciphertext.slice();
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;

    await expect(decryptEnvelope(key, { ...envelope, nonce }, aad)).rejects.toThrow(
      /authentication/iu,
    );
    await expect(decryptEnvelope(key, { ...envelope, ciphertext }, aad)).rejects.toThrow(
      /authentication/iu,
    );
  });

  it("uses fresh random nonces and validates key/envelope lengths", async () => {
    const key = new Uint8Array(32).fill(5);
    const first = await encryptEnvelope(key, new Uint8Array(), new Uint8Array());
    const second = await encryptEnvelope(key, new Uint8Array(), new Uint8Array());
    expect(first.nonce).not.toEqual(second.nonce);
    await expect(
      encryptEnvelope(new Uint8Array(31), new Uint8Array(), new Uint8Array()),
    ).rejects.toThrow(/32-byte key/iu);
    await expect(
      decryptEnvelope(
        key,
        { nonce: new Uint8Array(23), ciphertext: new Uint8Array(16) },
        new Uint8Array(),
      ),
    ).rejects.toThrow(/24-byte nonce/iu);
  });
});
