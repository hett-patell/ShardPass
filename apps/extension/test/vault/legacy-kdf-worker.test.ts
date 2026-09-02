import { describe, expect, it } from "vitest";

import { deriveLegacyPbkdf2 } from "../../src/vault/migration/legacy-kdf-worker";

const hex = (value: Uint8Array) =>
  [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");

describe("legacy PBKDF2 derivation", () => {
  it("matches an independently generated literal PBKDF2-HMAC-SHA-256 vector", async () => {
    const password = new TextEncoder().encode("synthetic passphrase");
    const salt = Uint8Array.from({ length: 16 }, (_, index) => index);
    const derived = await deriveLegacyPbkdf2({
      password,
      salt,
      iterations: 600_000,
      outputBytes: 32,
    });

    expect(hex(derived)).toBe("fa337d5e11f8af6871bc808c34cb0d9a045e88469d9d453cbe4b5da33655316a");
    expect(derived).toHaveLength(32);
  });

  it("rejects any protocol parameters outside the fixed legacy envelope policy", async () => {
    const valid = {
      password: new TextEncoder().encode("synthetic passphrase"),
      salt: new Uint8Array(16),
      iterations: 600_000,
      outputBytes: 32,
    };
    await expect(deriveLegacyPbkdf2({ ...valid, iterations: 599_999 })).rejects.toThrow(
      /^LEGACY_KDF_FAILED$/u,
    );
    await expect(deriveLegacyPbkdf2({ ...valid, outputBytes: 31 })).rejects.toThrow(
      /^LEGACY_KDF_FAILED$/u,
    );
    await expect(deriveLegacyPbkdf2({ ...valid, salt: new Uint8Array(15) })).rejects.toThrow(
      /^LEGACY_KDF_FAILED$/u,
    );
  });
});
