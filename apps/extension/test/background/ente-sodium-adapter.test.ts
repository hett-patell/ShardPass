import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createEnteSodiumAdapter } from "../../src/background/ente/sodium-adapter";
import { deterministicSodiumKeypair } from "../../../../tests/tooling/ente-sodium-deterministic";

const bytes = (length: number, start = 0) =>
  Uint8Array.from({ length }, (_, i) => (start + i) & 255);

describe("bounded Ente sodium adapter", () => {
  it("provides canonical base64 and owned outputs", async () => {
    const sodium = await createEnteSodiumAdapter();
    expect(sodium.toBase64(bytes(4))).toBe("AAECAw==");
    expect([...sodium.fromBase64("AAECAw==")]).toEqual([0, 1, 2, 3]);
    expect(() => sodium.fromBase64("AB==")).toThrow();
    const first = sodium.fromBase64("AAECAw==");
    first[0] = 9;
    expect(sodium.fromBase64("AAECAw==")[0]).toBe(0);
    sodium.dispose();
    expect(() => sodium.randomBytes(1)).toThrow();
  });

  it("replays deterministic secretbox, sealed box, secretstream and Argon2id", async () => {
    const sodium = await createEnteSodiumAdapter();
    const key = bytes(32, 1),
      nonce = bytes(24, 33),
      message = bytes(31, 70);
    const box = sodium.secretboxSeal(message, nonce, key);
    expect(sodium.secretboxOpen(box, nonce, key)).toEqual(message);
    expect(() => sodium.secretboxOpen(box, nonce, bytes(32, 2))).toThrow();
    const pair = await deterministicSodiumKeypair(bytes(32, 9));
    const sealed = sodium.sealedBoxSeal(message, pair.publicKey);
    expect(sodium.sealedBoxOpen(sealed, pair.publicKey, pair.privateKey)).toEqual(message);
    const stream = sodium.secretstreamSeal(message, key);
    expect(sodium.secretstreamOpen(stream.ciphertext, stream.header, key)).toEqual(message);
    expect(sodium.argon2id(bytes(16, 3), bytes(16, 8), 2, 16 * 1024 * 1024, 32)).toHaveLength(32);
    sodium.dispose();
  });

  it("frames Auth entity metadata exactly as fresh secretstream header plus ciphertext", async () => {
    const sodium = await createEnteSodiumAdapter();
    const framed = sodium.encryptAuthEntity(bytes(12, 4), bytes(32, 7));
    const second = sodium.encryptAuthEntity(bytes(12, 4), bytes(32, 7));
    expect(sodium.decryptAuthEntity(framed, bytes(32, 7))).toEqual(bytes(12, 4));
    expect(framed).not.toEqual(second);
    expect(Object.keys(framed)).toEqual(["encryptedData", "header"]);
    sodium.dispose();
  });

  it("pins byte-exact deterministic sealed-box and secretstream FINAL wire vectors", async () => {
    const fixture = JSON.parse(
      await readFile(
        new URL("../../../../tests/fixtures/ente/sodium-wire-vectors.json", import.meta.url),
        "utf8",
      ),
    ) as {
      vectors: Array<{
        operation: string;
        expectedWireHex?: string;
        expectedWire?: { headerHex: string; ciphertextHex: string; tag: number };
      }>;
    };
    expect(fixture.vectors.find((v) => v.operation === "sealed-box")?.expectedWireHex).toMatch(
      /^[0-9a-f]+$/u,
    );
    const stream = fixture.vectors.find((v) => v.operation === "secretstream-final")?.expectedWire;
    expect(stream?.headerHex).toBe(Buffer.from(bytes(24, 5)).toString("hex"));
    expect(stream?.ciphertextHex).toHaveLength((31 + 17) * 2);
    expect(stream?.tag).toBe(3);
  });
});
