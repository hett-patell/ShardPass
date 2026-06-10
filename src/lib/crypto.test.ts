import { expect, test } from "vitest";
import {
  CRYPTO_PARAMS,
  decryptJSON,
  deriveKey,
  encryptJSON,
  randomBytes,
} from "@/lib/crypto";

test("PBKDF2 iteration count meets OWASP guidance for SHA-256 (600k)", () => {
  expect(CRYPTO_PARAMS.PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
});

test("encrypt/decrypt roundtrip", async () => {
  // Low iteration count: this exercises the AES-GCM path, not the KDF cost.
  const key = await deriveKey("correct horse battery staple", randomBytes(16), 1_000);
  const { iv, ciphertext } = await encryptJSON({ hello: "world" }, key);
  await expect(decryptJSON(iv, ciphertext, key)).resolves.toEqual({ hello: "world" });
});

test("decrypt with the wrong key fails (GCM auth)", async () => {
  const key = await deriveKey("password-one-123", randomBytes(16), 1_000);
  const wrong = await deriveKey("password-two-456", randomBytes(16), 1_000);
  const { iv, ciphertext } = await encryptJSON({ hello: "world" }, key);
  await expect(decryptJSON(iv, ciphertext, wrong)).rejects.toThrow();
});
