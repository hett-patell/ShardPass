import { describe, expect, it } from "vitest";

import type { Argon2idWorkParameters, KdfRequestData } from "../src/kdf";
import { deriveArgon2idDirect } from "../src/kdf-direct";
import { deriveArgon2idWithSodium, sodiumDerives } from "../src/kdf-sodium";

const request = (
  parameters: Omit<Argon2idWorkParameters, "algorithm">,
  password = "correct horse battery staple",
): KdfRequestData => ({
  password: new TextEncoder().encode(password),
  salt: Uint8Array.from({ length: 16 }, (_, index) => (index * 37 + 11) % 256),
  parameters: { algorithm: "argon2id", ...parameters },
});

describe("libsodium Argon2id", () => {
  it.each([
    [8_192, 1],
    [8_192, 3],
    [16_384, 2],
  ])(
    "matches the pure-JS primitive bit for bit at %i KiB and %i passes",
    async (memoryKiB, iterations) => {
      const data = request({ memoryKiB, iterations, parallelism: 1 });
      const fast = await deriveArgon2idWithSodium(data);
      expect(fast).toHaveLength(32);
      expect(Array.from(fast)).toEqual(Array.from(deriveArgon2idDirect(data)));
    },
  );

  it("separates passwords and returns bytes the caller owns", async () => {
    const parameters = { memoryKiB: 8_192, iterations: 1, parallelism: 1 };
    const first = await deriveArgon2idWithSodium(request(parameters, "one"));
    const second = await deriveArgon2idWithSodium(request(parameters, "two"));
    expect(Array.from(first)).not.toEqual(Array.from(second));
    expect(first.buffer).toBeInstanceOf(ArrayBuffer);
    expect(first.byteOffset).toBe(0);
  });

  it("serves only single-lane parameters; other lane counts stay with the pure-JS primitive", async () => {
    expect(
      sodiumDerives({ algorithm: "argon2id", memoryKiB: 8_192, iterations: 1, parallelism: 1 }),
    ).toBe(true);
    expect(
      sodiumDerives({ algorithm: "argon2id", memoryKiB: 8_192, iterations: 1, parallelism: 2 }),
    ).toBe(false);
    await expect(
      deriveArgon2idWithSodium(request({ memoryKiB: 8_192, iterations: 1, parallelism: 2 })),
    ).rejects.toThrow(RangeError);
  });
});
