import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateOtp } from "@shardpass/otp";
import { describe, expect, it, vi } from "vitest";

import {
  MAX_LEGACY_PASSWORD_UTF8_BYTES,
  LegacyMigrationError,
  decryptLegacyVault,
  inspectLegacyVault,
  mapLegacyAccount,
  parseLegacySettings,
  validateLegacyEnteState,
} from "../src/legacy-v1";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function fixture(name: string) {
  return JSON.parse(await readFile(path.join(root, "tests/fixtures/legacy", name), "utf8")) as {
    attemptedTestOnlyPassword?: string;
    testOnlyPassword?: string;
    vault?: unknown;
    settings?: unknown;
  };
}

describe("legacy v1 importer", () => {
  it("strictly inspects only the bounded observed envelope", async () => {
    const standard = await fixture("vault-standard.json");
    expect(inspectLegacyVault(standard.vault)).toEqual({
      format: "shardpass-legacy-vault",
      version: 1,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });

    for (const candidate of [
      null,
      {},
      { ...(standard.vault as object), iterations: 599_999 },
      { ...(standard.vault as object), version: 2 },
      { ...(standard.vault as object), extra: true },
      {
        ...(standard.vault as object),
        salt: `${(standard.vault as { salt: string }).salt.slice(0, -3)}B==`,
      },
      {
        ...(standard.vault as object),
        ciphertext: `${(standard.vault as { ciphertext: string }).ciphertext.slice(0, -3)}B==`,
      },
    ]) {
      expect(() => inspectLegacyVault(candidate)).toThrowError(
        new LegacyMigrationError("MALFORMED_LEGACY_DATA"),
      );
    }
  });

  it("decrypts deterministic fixtures and gives authentication failures one safe category", async () => {
    const standard = await fixture("vault-standard.json");
    const decrypted = await decryptLegacyVault(standard.vault, standard.testOnlyPassword!);
    expect(decrypted.accounts).toHaveLength(8);

    const wrong = await fixture("wrong-password.json");
    const tampered = await fixture("tampered-ciphertext.json");
    for (const [envelope, password] of [
      [wrong.vault, wrong.attemptedTestOnlyPassword],
      [tampered.vault, tampered.testOnlyPassword],
    ] as const) {
      await expect(decryptLegacyVault(envelope, password!)).rejects.toEqual(
        new LegacyMigrationError("AUTHENTICATION_FAILED"),
      );
    }
  });

  it("maps every supported OTP semantic deterministically and preserves fixed-time output", async () => {
    const standard = await fixture("vault-standard.json");
    const decrypted = await decryptLegacyVault(standard.vault, standard.testOnlyPassword!);
    const mapped = decrypted.accounts.map(mapLegacyAccount);

    expect(mapped.map((item) => item.otpType)).toEqual([
      "totp",
      "totp",
      "totp",
      "totp",
      "hotp",
      "hotp",
      "steam",
      "totp",
    ]);
    expect(mapped.map((item) => [item.algorithm, item.digits, item.period, item.counter])).toEqual([
      ["SHA1", 6, 30, undefined],
      ["SHA256", 6, 30, undefined],
      ["SHA512", 6, 30, undefined],
      ["SHA256", 8, 45, undefined],
      ["SHA1", 6, 0, 0],
      ["SHA1", 6, 0, 7],
      ["SHA1", 5, 30, undefined],
      ["SHA1", 6, 30, undefined],
    ]);
    expect(mapped.map((item) => item.id)).toEqual(
      decrypted.accounts.map((account) => mapLegacyAccount(account).id),
    );
    expect(new Set(mapped.map((item) => item.id)).size).toBe(mapped.length);
    expect(mapped[0]).toMatchObject({
      issuer: "Synthetic Service",
      label: "fixture@example.invalid",
      tags: [],
      note: "",
      createdAt: "2023-11-14T22:13:20.000Z",
    });
    expect(mapped[7]).toMatchObject({
      issuer: "Synthetic Service",
      label: "fixture@example.invalid",
      tags: ["synthetic", "fixture"],
      note: "Synthetic note used only to preserve the confirmed legacy field.",
    });

    const expectations = [
      { index: 0, timestamp: 1_700_000_000_000, code: "921300", counter: 56_666_666 },
      { index: 1, timestamp: 59_000, code: "119246", counter: 1 },
      { index: 2, timestamp: 59_000, code: "693936", counter: 1 },
      { index: 3, timestamp: 1_700_000_000_000, code: "61212327", counter: 37_777_777 },
      { index: 4, timestamp: 0, code: "755224", counter: 0 },
      { index: 5, timestamp: 0, code: "162583", counter: 7 },
      { index: 6, timestamp: 1_700_000_000_000, code: "R87JJ", counter: 56_666_666 },
    ] as const;
    for (const expected of expectations) {
      await expect(generateOtp(mapped[expected.index]!, expected.timestamp)).resolves.toMatchObject(
        {
          code: expected.code,
          counter: expected.counter,
        },
      );
    }
  });

  it("clears the implementation-owned decrypted ArrayBuffer after parsing", async () => {
    const standard = await fixture("vault-standard.json");
    const originalDecrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    let observedPlaintext: ArrayBuffer | null = null;
    const decrypt = vi.spyOn(crypto.subtle, "decrypt").mockImplementation(async (...arguments_) => {
      const plaintext = await originalDecrypt(...arguments_);
      observedPlaintext = plaintext;
      return plaintext;
    });
    try {
      await expect(
        decryptLegacyVault(standard.vault, standard.testOnlyPassword!),
      ).resolves.toBeDefined();
      expect(observedPlaintext).not.toBeNull();
      expect(Array.from(new Uint8Array(observedPlaintext!)).every((byte) => byte === 0)).toBe(true);
    } finally {
      decrypt.mockRestore();
    }
  });

  it("rejects an unsupported or malformed record without returning a partial mapping", async () => {
    const standard = await fixture("vault-standard.json");
    const decrypted = await decryptLegacyVault(standard.vault, standard.testOnlyPassword!);
    const first = decrypted.accounts[0] as Record<string, unknown>;
    const unsupported = { ...first, type: "future" };
    const malformed = { ...first, unknown: true };

    for (const candidate of [unsupported, malformed]) {
      expect(() => mapLegacyAccount(candidate)).toThrowError(
        new LegacyMigrationError("UNSUPPORTED_LEGACY_RECORD"),
      );
    }
  });

  it("rejects oversized encoded input before Base64 decoding and bounds password UTF-8 before encoding", async () => {
    const standard = await fixture("vault-standard.json");
    const originalAtob = globalThis.atob;
    let decodedOversized = false;
    globalThis.atob = (value: string) => {
      if (value.length > 2_796_204) decodedOversized = true;
      return originalAtob(value);
    };
    try {
      expect(() =>
        inspectLegacyVault({
          ...(standard.vault as object),
          ciphertext: "A".repeat(2_796_208),
        }),
      ).toThrowError(new LegacyMigrationError("MALFORMED_LEGACY_DATA"));
      expect(decodedOversized).toBe(false);
    } finally {
      globalThis.atob = originalAtob;
    }

    const oversizedPassword = "😀".repeat(MAX_LEGACY_PASSWORD_UTF8_BYTES / 4 + 1);
    await expect(decryptLegacyVault(standard.vault, oversizedPassword)).rejects.toEqual(
      new LegacyMigrationError("MALFORMED_LEGACY_DATA"),
    );
  });

  it("rejects invalid epoch milliseconds with the stable record category", () => {
    const base = {
      id: "synthetic-time-boundary",
      createdAt: 1_700_000_000_000,
      issuer: "Synthetic",
      label: "fixture@example.invalid",
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      type: "totp",
      tags: [],
    };
    expect(mapLegacyAccount({ ...base, createdAt: 253_402_300_799_999 }).createdAt).toBe(
      "9999-12-31T23:59:59.999Z",
    );
    for (const createdAt of [253_402_300_800_000, Number.MAX_SAFE_INTEGER]) {
      expect(() => mapLegacyAccount({ ...base, createdAt })).toThrowError(
        new LegacyMigrationError("UNSUPPORTED_LEGACY_RECORD"),
      );
    }
  });

  it("rejects duplicate pending semantic operations while preserving ordered update then delete", () => {
    const accountId = "synthetic-local-a";
    const base = {
      email: "fixture@example.invalid",
      serverUrl: "https://synthetic.invalid",
      authToken: "synthetic-token-placeholder",
      masterKey: "synthetic-key-placeholder",
      entityMap: { "remote-a": accountId },
    };
    const update = {
      op: "update" as const,
      accountId,
      enteId: "remote-a",
      enqueuedAt: 1,
      attempts: 0,
    };
    const remove = {
      op: "delete" as const,
      accountId,
      enteId: "remote-a",
      enqueuedAt: 2,
      attempts: 0,
    };
    expect(
      validateLegacyEnteState({ ...base, pending: [update, remove] }).pending?.map(
        (operation) => operation.op,
      ),
    ).toEqual(["update", "delete"]);
    for (const duplicate of [
      [update, { ...update, enqueuedAt: 2 }],
      [remove, { ...remove, attempts: 1 }],
    ])
      expect(() => validateLegacyEnteState({ ...base, pending: duplicate })).toThrowError(
        new LegacyMigrationError("UNSUPPORTED_LEGACY_RECORD"),
      );
  });

  it("rejects destructive operations after delete while preserving list order", () => {
    const accountId = "synthetic-local-a";
    const base = {
      email: "fixture@example.invalid",
      serverUrl: "https://synthetic.invalid",
      authToken: "synthetic-token-placeholder",
      masterKey: "synthetic-key-placeholder",
      entityMap: { "remote-a": accountId },
    };
    const update = {
      op: "update" as const,
      accountId,
      enteId: "remote-a",
      enqueuedAt: 1,
      attempts: 0,
    };
    const remove = {
      op: "delete" as const,
      accountId,
      enteId: "remote-a",
      enqueuedAt: 2,
      attempts: 0,
    };
    expect(validateLegacyEnteState({ ...base, pending: [update, remove] }).pending).toEqual([
      update,
      remove,
    ]);
    for (const pending of [
      [remove, update],
      [remove, { ...remove, enqueuedAt: 3 }],
      [remove, { ...update, enqueuedAt: 3 }],
    ])
      expect(() => validateLegacyEnteState({ ...base, pending })).toThrowError(
        new LegacyMigrationError("UNSUPPORTED_LEGACY_RECORD"),
      );
  });

  it("enforces observed Ente create, update, delete, and unique mapping invariants", () => {
    const accountId = "synthetic-local-a";
    const base = {
      email: "fixture@example.invalid",
      serverUrl: "https://synthetic.invalid",
      authToken: "synthetic-token-placeholder",
      masterKey: "synthetic-key-placeholder",
      entityMap: { "remote-a": accountId },
    };
    expect(
      validateLegacyEnteState({
        ...base,
        pending: [
          { op: "create", accountId: "synthetic-local-b", enqueuedAt: 1, attempts: 0 },
          { op: "update", accountId, enteId: "remote-a", enqueuedAt: 2, attempts: 0 },
          { op: "delete", accountId, enteId: "remote-a", enqueuedAt: 3, attempts: 0 },
        ],
      }),
    ).toBeDefined();
    for (const invalid of [
      { ...base, entityMap: { "remote-a": accountId, "remote-b": accountId } },
      {
        ...base,
        pending: [{ op: "create", accountId, enteId: "remote-a", enqueuedAt: 1, attempts: 0 }],
      },
      {
        ...base,
        pending: [{ op: "update", accountId, enteId: "remote-b", enqueuedAt: 1, attempts: 0 }],
      },
      {
        ...base,
        pending: [
          { op: "delete", accountId: "dangling", enteId: "remote-a", enqueuedAt: 1, attempts: 0 },
        ],
      },
      { ...base, pending: [{ op: "delete", accountId, enqueuedAt: 1, attempts: 0 }] },
    ]) {
      expect(() => validateLegacyEnteState(invalid)).toThrowError(
        new LegacyMigrationError("UNSUPPORTED_LEGACY_RECORD"),
      );
    }
  });

  it("preserves observed whole-minute settings and rejects unbounded values", () => {
    expect(parseLegacySettings({ autoLockMinutes: 7, lockOnScreenLock: false })).toEqual({
      autoLockMinutes: 7,
      lockOnScreenLock: false,
    });
    for (const autoLockMinutes of [-1, 1.5, 1_441]) {
      expect(() => parseLegacySettings({ autoLockMinutes, lockOnScreenLock: false })).toThrowError(
        new LegacyMigrationError("UNSUPPORTED_LEGACY_SETTINGS"),
      );
    }
  });
});
