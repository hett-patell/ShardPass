import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LegacyEnvelopeSchema,
  deriveLegacyVaultKey,
  parseLegacySettings,
} from "@shardpass/importers/legacy-v1";
import type { MigrationRequest } from "@shardpass/messaging";
import type { StorageValue } from "@shardpass/storage";
import { FakeStoragePort } from "@shardpass/testing/fake-storage-port";
import { describe, expect, it } from "vitest";

import type { LegacyMigrationSource } from "../../src/background/vault/migration-credential-service";
import {
  MigrationService,
  type MigrationDestination,
  type MigrationPayload,
  type MigrationStage,
} from "../../src/background/vault/migration-service";
import type { SenderBinding } from "../../src/background/vault/session-service";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const token = "0123456789abcdef0123456789abcdef";
const sender: SenderBinding = {
  extensionId: "extension-id",
  contextKind: "vault",
  senderUrl: "chrome-extension://extension-id/vault/index.html",
  documentId: "vault-document-1",
};
async function fixture(name: string) {
  return JSON.parse(await readFile(path.join(root, "tests/fixtures/legacy", name), "utf8")) as {
    testOnlyPassword: string;
    attemptedTestOnlyPassword?: string;
    vault: StorageValue;
  };
}
class FakeDestination implements MigrationDestination {
  staged: MigrationPayload | null = null;
  active: MigrationPayload | null = null;
  stageCalls = 0;
  activateCalls = 0;
  fail: "verify" | "activate" | null = null;
  phase: "none" | "staged" | "verified" | "completed" | "failed" = "none";
  private fingerprint = "";
  stage(input: { payload: MigrationPayload; sourceFingerprint: string }) {
    this.stageCalls += 1;
    this.staged = structuredClone(input.payload);
    this.fingerprint = input.sourceFingerprint;
    this.phase = "staged";
    return Promise.resolve(this.stageRef());
  }
  verify() {
    if (this.fail === "verify") {
      this.phase = "failed";
      return Promise.reject(new Error("synthetic"));
    }
    this.phase = "verified";
    return Promise.resolve(structuredClone(this.staged!));
  }
  activate() {
    this.activateCalls += 1;
    if (this.fail === "activate") return Promise.reject(new Error("synthetic"));
    this.active = structuredClone(this.staged!);
    this.phase = "completed";
    return Promise.resolve();
  }
  assertSource(_stage: MigrationStage, fingerprint: string) {
    return fingerprint === this.fingerprint
      ? Promise.resolve()
      : Promise.reject(new Error("changed"));
  }
  reconcile() {
    return Promise.resolve({
      phase: this.phase,
      ...(this.fingerprint === ""
        ? {}
        : { stage: this.stageRef(), generationId: this.stageRef().generationId }),
      itemCount: this.staged?.items.length ?? 0,
    });
  }
  private stageRef(): MigrationStage {
    return {
      transactionId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a20",
      generationId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a21",
      sourceFingerprint: this.fingerprint,
    };
  }
}
async function credential(envelope: StorageValue, password: string, settings?: StorageValue) {
  const parsed = LegacyEnvelopeSchema.parse(envelope);
  const key = await deriveLegacyVaultKey(parsed, password);
  let used = false;
  const source: LegacyMigrationSource = Object.freeze({
    envelope: Object.freeze({ ...parsed }),
    ...(settings === undefined ? {} : { settings: Object.freeze(parseLegacySettings(settings)) }),
  });
  return {
    getCredentialChallenge: () => Promise.reject(new Error("unused")),
    authorizeCredential: () => Promise.reject(new Error("unused")),
    withCredential: async <T>(
      credentialToken: string,
      exact: SenderBinding,
      callback: (key: Uint8Array, source: LegacyMigrationSource) => Promise<T> | T,
    ) => {
      if (used || credentialToken !== token || exact !== sender) throw new Error("invalid token");
      used = true;
      try {
        return await callback(key, source);
      } finally {
        key.fill(0);
      }
    },
  };
}
const start: MigrationRequest = { version: 1, kind: "migration.start", credentialToken: token };
const statusSafe = (value: unknown) => {
  const text = JSON.stringify(value);
  for (const forbidden of ["password", "secret", "authToken", "masterKey", "accounts"])
    expect(text).not.toContain(forbidden);
};

describe("MigrationService", () => {
  it("handles strict sender-bound start, restart phases without a token, and safe statuses", async () => {
    const source = await fixture("vault-standard.json");
    const settings = { autoLockMinutes: 7, lockOnScreenLock: false };
    const storage = new FakeStoragePort({ vault: source.vault, settings });
    const destination = new FakeDestination();
    const service = new MigrationService(
      storage,
      destination,
      await credential(source.vault, source.testOnlyPassword, settings),
    );
    await expect(service.handle(start, sender)).resolves.toMatchObject({
      kind: "migration.status",
      phase: "staged",
      itemCount: 8,
    });
    const verifyService = new MigrationService(
      storage,
      destination,
      await credential(source.vault, source.testOnlyPassword, settings),
    );
    await expect(
      verifyService.handle({ version: 1, kind: "migration.verify" }, sender),
    ).resolves.toMatchObject({ phase: "verified" });
    const activateService = new MigrationService(
      storage,
      destination,
      await credential(source.vault, source.testOnlyPassword, settings),
    );
    const completed = await activateService.handle(
      { version: 1, kind: "migration.activate" },
      sender,
    );
    expect(completed).toMatchObject({ phase: "completed", itemCount: 8 });
    expect(destination.active?.settings).toEqual(settings);
    expect((await storage.snapshot()).vault).toEqual(source.vault);
    statusSafe(completed);
  });

  it("consumes a token once and binds it to the exact sender", async () => {
    const source = await fixture("vault-standard.json");
    const storage = new FakeStoragePort({ vault: source.vault });
    const destination = new FakeDestination();
    const credentials = await credential(source.vault, source.testOnlyPassword);
    const service = new MigrationService(storage, destination, credentials);
    await expect(service.handle(start, { ...sender, documentId: "other" })).rejects.toThrow();
    expect(destination.stageCalls).toBe(0);
    await expect(service.handle(start, sender)).resolves.toMatchObject({ phase: "staged" });
    await expect(service.handle(start, sender)).rejects.toThrow();
    expect(destination.stageCalls).toBe(1);
  });

  it("uses the same safe failure for a wrong derived key and authenticated tamper", async () => {
    const wrong = await fixture("wrong-password.json");
    const tampered = await fixture("tampered-ciphertext.json");
    const failures: string[] = [];
    for (const [source, password] of [
      [wrong, wrong.attemptedTestOnlyPassword!],
      [tampered, tampered.testOnlyPassword],
    ] as const) {
      const destination = new FakeDestination();
      const service = new MigrationService(
        new FakeStoragePort({ vault: source.vault }),
        destination,
        await credential(source.vault, password),
      );
      await service
        .handle(start, sender)
        .catch((error: unknown) => failures.push((error as { code: string }).code));
      expect(destination.stageCalls).toBe(0);
    }
    expect(failures).toEqual(["AUTHENTICATION_FAILED", "AUTHENTICATION_FAILED"]);
  });

  it("rejects an exact settings snapshot change before activation", async () => {
    const source = await fixture("vault-standard.json");
    const settings = { autoLockMinutes: 7, lockOnScreenLock: false };
    const storage = new FakeStoragePort({ vault: source.vault, settings });
    const destination = new FakeDestination();
    const service = new MigrationService(
      storage,
      destination,
      await credential(source.vault, source.testOnlyPassword, settings),
    );
    await service.handle(start, sender);
    await service.handle({ version: 1, kind: "migration.verify" }, sender);
    await storage.set({ settings: { autoLockMinutes: 8, lockOnScreenLock: false } });
    await expect(
      service.handle({ version: 1, kind: "migration.activate" }, sender),
    ).rejects.toThrow();
    expect(destination.activateCalls).toBe(0);
  });

  it("retries failed/new source with a fresh token but completed without one", async () => {
    const source = await fixture("vault-standard.json");
    const storage = new FakeStoragePort({ vault: source.vault });
    const destination = new FakeDestination();
    destination.fail = "verify";
    await new MigrationService(
      storage,
      destination,
      await credential(source.vault, source.testOnlyPassword),
    ).handle(start, sender);
    await expect(
      new MigrationService(
        storage,
        destination,
        await credential(source.vault, source.testOnlyPassword),
      ).handle({ version: 1, kind: "migration.verify" }, sender),
    ).rejects.toMatchObject({ code: "MIGRATION_FAILED" });
    destination.fail = null;
    await expect(
      new MigrationService(
        storage,
        destination,
        await credential(source.vault, source.testOnlyPassword),
      ).handle({ version: 1, kind: "migration.retry" }, sender),
    ).rejects.toMatchObject({ code: "RETRY_REQUIRED" });
    const restarted = new MigrationService(
      storage,
      destination,
      await credential(source.vault, source.testOnlyPassword),
    );
    await restarted.handle({ version: 1, kind: "migration.retry", credentialToken: token }, sender);
    await restarted.handle({ version: 1, kind: "migration.verify" }, sender);
    await restarted.handle({ version: 1, kind: "migration.activate" }, sender);
    await expect(
      restarted.handle({ version: 1, kind: "migration.retry" }, sender),
    ).resolves.toMatchObject({ phase: "completed" });
    expect(destination.activateCalls).toBe(1);
  });
});
