import { describe, expect, it } from "vitest";

import { VaultRequestSchema, VaultResponseSchema, vaultSenderPolicy } from "../src/vault";

const kek = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

describe("vault messaging", () => {
  it.each([
    { version: 1, kind: "vault.getState" },
    { version: 1, kind: "vault.getKdfChallenge", purpose: "setup" },
    {
      version: 1,
      kind: "vault.setup",
      challengeId: "0123456789abcdef0123456789abcdef",
      keyEncryptionKey: kek,
    },
    {
      version: 1,
      kind: "vault.unlock",
      challengeId: "0123456789abcdef0123456789abcdef",
      keyEncryptionKey: kek,
    },
    { version: 1, kind: "vault.lock" },
    {
      version: 1,
      kind: "vault.changePassword",
      currentChallengeId: "0123456789abcdef0123456789abcdef",
      currentKeyEncryptionKey: kek,
      newChallengeId: "fedcba9876543210fedcba9876543210",
      newKeyEncryptionKey: kek,
    },
    { version: 1, kind: "vault.updateLockSettings", autoLockMinutes: 15, lockOnScreenLock: true },
  ])("accepts strict command %#", (value) => {
    expect(VaultRequestSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    { version: 2, kind: "vault.getState" },
    { version: 1, kind: "vault.getState", extra: true },
    { version: 1, kind: "vault.unlock", challengeId: "short", keyEncryptionKey: kek },
    {
      version: 1,
      kind: "vault.unlock",
      challengeId: "0123456789abcdef0123456789abcdef",
      keyEncryptionKey: "AA==",
    },
    {
      version: 1,
      kind: "vault.updateLockSettings",
      autoLockMinutes: 1_441,
      lockOnScreenLock: true,
    },
  ])("rejects malformed command %#", (value) => {
    expect(VaultRequestSchema.safeParse(value).success).toBe(false);
  });

  it("accepts only secret-free responses", () => {
    expect(
      VaultResponseSchema.safeParse({
        version: 1,
        kind: "vault.state",
        state: "locked",
        autoLockMinutes: 15,
        lockOnScreenLock: true,
        retryAfterMs: 0,
        streamId: "00000000000000000000000000000001",
        sequence: 1,
      }).success,
    ).toBe(true);
    expect(
      VaultResponseSchema.safeParse({
        version: 1,
        kind: "vault.kdfChallenge",
        challengeId: "0123456789abcdef0123456789abcdef",
        purpose: "unlock",
        kdf: {
          algorithm: "argon2id",
          salt: "AAAAAAAAAAAAAAAAAAAAAA==",
          memoryKiB: 65536,
          iterations: 2,
          parallelism: 1,
        },
        expiresAt: 1_000,
      }).success,
    ).toBe(true);
    expect(
      VaultResponseSchema.safeParse({
        version: 1,
        kind: "vault.ok",
        state: "unlocked",
        secret: kek,
      }).success,
    ).toBe(false);
  });

  it("allows summary, setup, unlock, lock, and settings in popup/vault but password and PIN changes only in vault", () => {
    for (const [kind, policy] of Object.entries(vaultSenderPolicy)) {
      expect(policy.allowedContexts).toEqual(
        kind === "vault.changePassword" || kind === "vault.setPin" || kind === "vault.removePin"
          ? ["vault"]
          : ["popup", "vault"],
      );
    }
  });
});
