import { describe, expect, it } from "vitest";

import { deriveArgon2idDirect } from "../src/kdf-direct";
import {
  DEFAULT_ARGON2ID_PARAMETERS,
  MAX_PASSWORD_UTF8_BYTES,
  validateArgon2idWorkParameters,
  validateKdfRequestData,
} from "../src/kdf";

const toHex = (value: Uint8Array): string => Buffer.from(value).toString("hex");

describe("internal Argon2id primitive", () => {
  it("matches node-argon2's published no-secret raw vector", () => {
    const derived = deriveArgon2idDirect({
      password: new TextEncoder().encode("password"),
      salt: new TextEncoder().encode("saltsaltsaltsalt"),
      parameters: { algorithm: "argon2id", memoryKiB: 65_536, iterations: 3, parallelism: 4 },
    });
    expect(toHex(derived)).toBe("ac15942c3e63386a50cb7dab2ef19c9af40c56a2153409ab0ad7a45af500f1bc");
  }, 15_000);

  it("validates bounded bytes and stored parameters", () => {
    expect(() =>
      validateKdfRequestData({
        password: new Uint8Array(MAX_PASSWORD_UTF8_BYTES + 1),
        salt: new Uint8Array(16),
        parameters: DEFAULT_ARGON2ID_PARAMETERS,
      }),
    ).toThrow(/password/iu);
    expect(() =>
      validateKdfRequestData({
        password: new Uint8Array(),
        salt: new Uint8Array(15),
        parameters: DEFAULT_ARGON2ID_PARAMETERS,
      }),
    ).toThrow(/salt/iu);
  });

  it.each([
    [{ algorithm: "argon2id", memoryKiB: 8191, iterations: 3, parallelism: 1 }],
    [{ algorithm: "argon2id", memoryKiB: 131073, iterations: 3, parallelism: 1 }],
    [{ algorithm: "argon2id", memoryKiB: 65536, iterations: 0, parallelism: 1 }],
    [{ algorithm: "argon2id", memoryKiB: 65536, iterations: 11, parallelism: 1 }],
    [{ algorithm: "argon2id", memoryKiB: 65536, iterations: 3, parallelism: 0 }],
    [{ algorithm: "argon2id", memoryKiB: 65536, iterations: 3, parallelism: 5 }],
  ])("rejects persisted work parameters outside schema bounds: %j", (parameters) => {
    expect(() => validateArgon2idWorkParameters(parameters)).toThrow(/Argon2id parameters/iu);
  });

  it("publishes the reviewed setup default", () => {
    expect(DEFAULT_ARGON2ID_PARAMETERS).toEqual({
      algorithm: "argon2id",
      memoryKiB: 65_536,
      iterations: 2,
      parallelism: 1,
    });
  });
});
