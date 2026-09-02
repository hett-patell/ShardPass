import { WrappedVaultKeySchema } from "@shardpass/storage";
import { describe, expect, it } from "vitest";

import { deriveArgon2idDirect } from "../src/kdf-direct";
import { DEFAULT_ARGON2ID_PARAMETERS, type KdfExecutor } from "../src/kdf";
import {
  createVaultKeyMaterial,
  createVaultKeyMaterialFromKeyEncryptionKey,
  unwrapVaultDataKey,
  unwrapVaultDataKeyWithKeyEncryptionKey,
} from "../src/key-hierarchy";
import * as publicCrypto from "../src/index";
import { createDeterministicRandomSource } from "../src/random";
import { compatibilityFixture } from "./compatibility-fixture";

const directExecutor: KdfExecutor = {
  derive(request) {
    request.onStarted?.();
    return Promise.resolve(deriveArgon2idDirect(request));
  },
};
const deterministicBytes = Uint8Array.from({ length: 72 }, (_, index) => index);
const compatibilityParameters = Object.freeze({
  algorithm: "argon2id" as const,
  memoryKiB: 8192,
  iterations: 1,
  parallelism: 1,
});

describe("vault key hierarchy", () => {
  it("enforces setup policy and always uses the reviewed default", async () => {
    await expect(createVaultKeyMaterial(directExecutor, "")).rejects.toThrow(/12 characters/iu);
    await expect(createVaultKeyMaterial(directExecutor, "🔐".repeat(11))).rejects.toThrow(
      /12 characters/iu,
    );
    const accepted = await createVaultKeyMaterial(
      directExecutor,
      "🔐".repeat(12),
      createDeterministicRandomSource(deterministicBytes),
    );
    expect(WrappedVaultKeySchema.parse(accepted.wrappedKey)).toEqual(accepted.wrappedKey);
    expect(accepted.wrappedKey.kdf).toMatchObject(DEFAULT_ARGON2ID_PARAMETERS);
    expect("createVaultKeyMaterialForTesting" in publicCrypto).toBe(false);
  }, 15_000);

  it("wraps and unwraps with a trusted-page-derived key without accepting a password", async () => {
    const keyEncryptionKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const salt = Uint8Array.from({ length: 16 }, (_, index) => index + 33);
    const random = createDeterministicRandomSource(deterministicBytes);
    const material = await createVaultKeyMaterialFromKeyEncryptionKey(
      keyEncryptionKey,
      salt,
      DEFAULT_ARGON2ID_PARAMETERS,
      random,
    );

    await expect(
      unwrapVaultDataKeyWithKeyEncryptionKey(keyEncryptionKey, material.wrappedKey),
    ).resolves.toEqual(material.vaultDataKey);
    await expect(
      unwrapVaultDataKeyWithKeyEncryptionKey(new Uint8Array(32), material.wrappedKey),
    ).rejects.toThrow(/authentication/iu);
  });

  it("unwraps a deterministic compatibility-minimum test fixture", async () => {
    const fixture = await compatibilityFixture("compatibility-password", compatibilityParameters);
    await expect(
      unwrapVaultDataKey(directExecutor, "compatibility-password", fixture.wrapped),
    ).resolves.toEqual(fixture.dataKey);
  });

  it("rejects wrong password and tampered compatibility fixtures", async () => {
    const fixture = await compatibilityFixture("correct-password", compatibilityParameters);
    await expect(
      unwrapVaultDataKey(directExecutor, "wrong-password", fixture.wrapped),
    ).rejects.toThrow(/authentication/iu);
    const tampered = {
      ...fixture.wrapped,
      wrapping: {
        ...fixture.wrapped.wrapping,
        ciphertext: `${fixture.wrapped.wrapping.ciphertext.slice(0, -4)}AAAA`,
      },
    };
    await expect(
      unwrapVaultDataKey(directExecutor, "correct-password", tampered),
    ).rejects.toThrow();
  });
});
