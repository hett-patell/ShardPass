import { createDeterministicRandomSource } from "@shardpass/crypto";
import type { OtpItem } from "@shardpass/domain";
import { FakeStoragePort } from "@shardpass/testing/fake-storage-port";
import { ACTIVE_ROOT_KEY, MAX_GENERATION_ENTRIES, canonicalJson } from "@shardpass/storage";
import { describe, expect, it } from "vitest";

import { EnteOtpMetadataStore } from "../../src/background/ente/ente-otp-metadata-store";
import {
  EncryptedMigrationDestination,
  MigrationDestinationError,
  assertMigrationCapacity,
  migrationRecordCapacity,
} from "../../src/background/vault/migration-destination";
import { SessionService } from "../../src/background/vault/session-service";
import { SettingsService } from "../../src/background/vault/settings-service";

const ids = [
  "018f47a6-7d11-7c2f-8bd9-a1d37f147a20",
  "018f47a6-7d11-7c2f-8bd9-a1d37f147a21",
  "018f47a6-7d11-7c2f-8bd9-a1d37f147a22",
  "018f47a6-7d11-7c2f-8bd9-a1d37f147a23",
  "018f47a6-7d11-7c2f-8bd9-a1d37f147a24",
  "018f47a6-7d11-7c2f-8bd9-a1d37f147a25",
];
const kek = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const transactionKey = "shardpass:v1:migration-transaction";
const binding = {
  extensionId: "extension-id",
  contextKind: "vault" as const,
  senderUrl: "chrome-extension://extension-id/vault/index.html",
  documentId: "vault-document-1",
};

function item(): OtpItem {
  return {
    id: "018f47a6-7d11-7c2f-8bd9-a1d37f147a29",
    schemaVersion: 1,
    revision: 1,
    createdAt: "2023-11-14T22:13:20.000Z",
    updatedAt: "2023-11-14T22:13:20.000Z",
    favorite: false,
    tags: ["synthetic"],
    kind: "otp",
    issuer: "Synthetic",
    label: "fixture@example.invalid",
    secret: "JBSWY3DPEHPK3PXP",
    otpType: "totp",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    note: "fixture note",
  };
}
async function unlock(service: SessionService) {
  if ((await service.getState()).state === "unlocked") return;
  const challenge = await service.createChallenge("unlock", binding);
  await service.unlock(challenge.challengeId, kek.slice(), binding);
}

async function configured() {
  const storage = new FakeStoragePort();
  let id = 0;
  const service = new SessionService({
    local: storage,
    session: new FakeStoragePort(),
    random: createDeterministicRandomSource(
      Uint8Array.from({ length: 8192 }, (_, index) => index % 251),
    ),
    now: () => 1_000,
    isoNow: () => "2026-08-03T12:00:00.000Z",
    nextId: () => ids[id++]!,
  });
  const challenge = await service.createChallenge("setup", binding);
  await service.setup(challenge.challengeId, kek.slice(), binding);
  return { storage, service };
}

describe("EncryptedMigrationDestination", () => {
  it("stages encrypted OTP records and encrypted settings/Ente metadata, authenticates read-back, and CAS activates", async () => {
    const { storage, service } = await configured();
    const root = (await storage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY];
    const destination = new EncryptedMigrationDestination(storage, service);
    const payload = {
      items: [item()],
      settings: { autoLockMinutes: 7, lockOnScreenLock: false },
      ente: {
        email: "fixture@example.invalid",
        serverUrl: "https://synthetic.invalid",
        authToken: "synthetic-token-placeholder",
        masterKey: "synthetic-key-placeholder",
        entityMap: { remote: item().id },
      },
    } as const;

    const stage = await destination.stage({ payload, sourceFingerprint: "a".repeat(64) });
    expect((await storage.snapshot())[ACTIVE_ROOT_KEY]).toEqual(root);
    expect(JSON.stringify(await storage.snapshot())).not.toContain("fixture note");
    expect(JSON.stringify(await storage.snapshot())).not.toContain("synthetic-token-placeholder");
    const restartedForVerify = new EncryptedMigrationDestination(storage, service);
    await expect(restartedForVerify.verify(stage)).resolves.toEqual(payload);
    const restartedForActivate = new EncryptedMigrationDestination(storage, service);
    await restartedForActivate.activate(stage);
    const snapshot = await storage.snapshot();
    expect((snapshot[ACTIVE_ROOT_KEY] as { activeGenerationId: string }).activeGenerationId).toBe(
      stage.generationId,
    );
    await expect(destination.reconcile()).resolves.toMatchObject({
      phase: "completed",
      generationId: stage.generationId,
    });
  });

  it("finalizes only authenticated active settings and Ente metadata, then retries without a second root write", async () => {
    const { storage, service } = await configured();
    let schedules = 0;
    let failSettings = true;
    const settings = new SettingsService(
      storage,
      {
        scheduleAutoLock: () => {
          schedules += 1;
          if (failSettings) return Promise.reject(new Error("synthetic settings interruption"));
          return Promise.resolve();
        },
        onUserActivity: () => () => undefined,
        onIdleStateChanged: () => () => undefined,
      },
      () => Promise.resolve(),
    );
    const destination = new EncryptedMigrationDestination(storage, service, {
      settings,
      ente: new EnteOtpMetadataStore(),
    });
    const payload = {
      items: [item()],
      settings: { autoLockMinutes: 7, lockOnScreenLock: false },
      ente: {
        email: "fixture@example.invalid",
        serverUrl: "https://synthetic.invalid",
        authToken: "synthetic-token-placeholder",
        masterKey: "synthetic-key-placeholder",
        entityMap: { remote: item().id },
      },
    } as const;
    const stage = await destination.stage({ payload, sourceFingerprint: "a".repeat(64) });
    await destination.verify(stage);
    await expect(destination.activate(stage)).rejects.toThrow();
    const rootWrites = storage.writes.filter((entry) =>
      entry.keys.includes(ACTIVE_ROOT_KEY),
    ).length;
    failSettings = false;
    const restarted = new EncryptedMigrationDestination(storage, service, {
      settings,
      ente: new EnteOtpMetadataStore(),
    });
    await restarted.activate(stage);
    expect(storage.writes.filter((entry) => entry.keys.includes(ACTIVE_ROOT_KEY))).toHaveLength(
      rootWrites,
    );
    expect(schedules).toBe(2);
    expect(restarted.getEnteSummary()).toEqual({
      present: true,
      entityCount: 1,
      pendingCount: 0,
      createCount: 0,
      updateCount: 0,
      deleteCount: 0,
    });
    expect(JSON.stringify(restarted.getEnteSummary())).not.toContain("synthetic-token-placeholder");
  });

  it("rejects changed roots and source fingerprints without overwriting a newer root", async () => {
    const { storage, service } = await configured();
    const root = (await storage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY]!;
    const destination = new EncryptedMigrationDestination(storage, service);
    const stage = await destination.stage({
      payload: { items: [item()] },
      sourceFingerprint: "a".repeat(64),
    });
    const currentRoot = { ...(root as object), activeGenerationId: ids[3]! };
    await storage.set({ [ACTIVE_ROOT_KEY]: currentRoot });
    await expect(destination.activate(stage)).rejects.toMatchObject({
      code: "EXTERNAL_ROOT_CHANGED",
    });
    expect((await storage.snapshot())[ACTIVE_ROOT_KEY]).toEqual(currentRoot);
    await expect(destination.assertSource(stage, "b".repeat(64))).rejects.toMatchObject({
      code: "SOURCE_CHANGED",
    });
  });

  it("resumes activation after every before/after write interruption without a duplicate root commit", async () => {
    for (const phase of ["before", "after"] as const) {
      for (let write = 1; write <= 4; write += 1) {
        const { storage, service } = await configured();
        const destination = new EncryptedMigrationDestination(storage, service);
        const stage = await destination.stage({
          payload: { items: [item()], settings: { autoLockMinutes: 7, lockOnScreenLock: false } },
          sourceFingerprint: "a".repeat(64),
        });
        await destination.verify(stage);
        storage.resetOperationCount();
        storage.failWriteAt(write, phase, new Error("synthetic interruption"));
        await destination.activate(stage).catch(() => undefined);
        storage.clearFailure();
        await unlock(service);
        const rootWritesBeforeRetry = storage.writes.filter((entry) =>
          entry.keys.includes(ACTIVE_ROOT_KEY),
        ).length;
        await new EncryptedMigrationDestination(storage, service).activate(stage);
        const rootWritesAfterRetry = storage.writes.filter((entry) =>
          entry.keys.includes(ACTIVE_ROOT_KEY),
        ).length;
        expect(rootWritesAfterRetry).toBeLessThanOrEqual(rootWritesBeforeRetry + 1);
        await expect(
          new EncryptedMigrationDestination(storage, service).reconcile(),
        ).resolves.toMatchObject({ phase: "completed", generationId: stage.generationId });
      }
    }
  });

  it("completes after every before/after interrupted staging write without activating partial data", async () => {
    for (const phase of ["before", "after"] as const) {
      for (let write = 1; write <= 8; write += 1) {
        const { storage, service } = await configured();
        const root = (await storage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY];
        const rootWritesBefore = storage.writes.filter((entry) =>
          entry.keys.includes(ACTIVE_ROOT_KEY),
        ).length;
        const input = { payload: { items: [item()] }, sourceFingerprint: "a".repeat(64) };
        storage.resetOperationCount();
        storage.failWriteAt(write, phase, new Error("synthetic interruption"));
        const destination = new EncryptedMigrationDestination(storage, service);
        await destination.stage(input).catch(() => undefined);
        storage.clearFailure();
        expect((await storage.snapshot())[ACTIVE_ROOT_KEY]).toEqual(root);

        const restarted = new EncryptedMigrationDestination(storage, service);
        const stage = await restarted.stage(input);
        await expect(restarted.verify(stage)).resolves.toEqual(input.payload);
        await restarted.activate(stage);
        await expect(restarted.reconcile()).resolves.toMatchObject({
          phase: "completed",
          generationId: stage.generationId,
          itemCount: 1,
        });
        expect(storage.writes.filter((entry) => entry.keys.includes(ACTIVE_ROOT_KEY))).toHaveLength(
          rootWritesBefore + 1,
        );
      }
    }
  });

  it.each([
    { settings: false, ente: false, pending: false, metadataCount: 1 },
    { settings: false, ente: false, pending: true, metadataCount: 2 },
    { settings: true, ente: false, pending: false, metadataCount: 2 },
    { settings: false, ente: true, pending: false, metadataCount: 2 },
    { settings: true, ente: true, pending: false, metadataCount: 3 },
    { settings: true, ente: true, pending: true, metadataCount: 4 },
  ])(
    "reserves the exact metadata count before staging ($metadataCount entries)",
    ({ settings, ente, pending, metadataCount }) => {
      const capacity = migrationRecordCapacity({ settings, ente, pending });
      expect(capacity).toBe(MAX_GENERATION_ENTRIES - metadataCount);
      expect(capacity + metadataCount).toBe(MAX_GENERATION_ENTRIES);

      expect(() => assertMigrationCapacity(capacity, { settings, ente, pending })).not.toThrow();
      expect(() => assertMigrationCapacity(capacity + 1, { settings, ente, pending })).toThrowError(
        new MigrationDestinationError("STORAGE_CAPACITY_EXCEEDED"),
      );
    },
  );

  it("accepts only one durable stage across competing destination owners", async () => {
    const { storage, service } = await configured();
    const first = new EncryptedMigrationDestination(storage, service, {
      now: () => 1_000,
      ownerId: "00000000-0000-4000-8000-000000000101",
    });
    const second = new EncryptedMigrationDestination(storage, service, {
      now: () => 1_000,
      ownerId: "00000000-0000-4000-8000-000000000202",
    });
    const attempts = await Promise.allSettled([
      first.stage({ payload: { items: [item()] }, sourceFingerprint: "a".repeat(64) }),
      second.stage({ payload: { items: [item()] }, sourceFingerprint: "a".repeat(64) }),
    ]);
    const accepted = attempts.find((result) => result.status === "fulfilled");
    const denied = attempts.find((result) => result.status === "rejected");
    expect(accepted?.status).toBe("fulfilled");
    expect(denied).toMatchObject({
      status: "rejected",
      reason: { code: "MIGRATION_IN_PROGRESS" },
    });
    const writes = storage.writeCount;
    await expect(first.verify(accepted!.value)).resolves.toEqual({ items: [item()] });
    expect(storage.writeCount).toBe(writes + 2);
  });

  it("serializes same-owner verification to one monotonic transaction progression", async () => {
    const { storage, service } = await configured();
    const destination = new EncryptedMigrationDestination(storage, service, {
      now: () => 1_000,
      ownerId: "00000000-0000-4000-8000-000000000101",
    });
    const stage = await destination.stage({
      payload: { items: [item()] },
      sourceFingerprint: "a".repeat(64),
    });
    const writes = storage.writeCount;

    const results = await Promise.all([destination.verify(stage), destination.verify(stage)]);
    expect(results).toEqual([{ items: [item()] }, { items: [item()] }]);
    expect(storage.writeCount).toBe(writes + 2);
  });

  it("projects every strict plaintext transaction tamper as one safe invalid result", async () => {
    const { storage, service } = await configured();
    const destination = new EncryptedMigrationDestination(storage, service);
    const stage = await destination.stage({
      payload: { items: [item()] },
      sourceFingerprint: "a".repeat(64),
    });
    const envelope = (await storage.snapshot())[transactionKey]!;
    const opened = await service.openMigrationTransaction(envelope);
    const valid = JSON.parse(new TextDecoder().decode(opened.plaintext)) as Record<string, unknown>;
    const cases: Record<string, unknown>[] = [
      { ...valid, extra: true },
      { ...valid, revision: 0 },
      { ...valid, revision: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, phase: "unknown" },
      { ...valid, transactionId: ids[3] },
      { ...valid, sourceFingerprint: "g".repeat(64) },
      { ...valid, payloadDigest: "0".repeat(63) },
      { ...valid, expectedGenerationId: "wrong" },
      { ...valid, targetStage: "v4" },
      { ...valid, targetGenerationId: "wrong" },
      { ...valid, itemCount: -1 },
      { ...valid, presence: { settings: false, ente: false, extra: true } },
      { ...valid, owner: { ...(valid.owner as object), leaseVersion: 0 } },
      { ...valid, updatedAt: -1 },
      { ...valid, safeRetry: "unknown" },
    ];
    const missingRevision = { ...valid };
    delete missingRevision.revision;
    cases.push(missingRevision);

    for (const plaintext of cases) {
      const tampered = await service.sealMigrationTransaction(
        stage.transactionId,
        new TextEncoder().encode(canonicalJson(plaintext)),
      );
      await storage.set({ [transactionKey]: tampered });
      await expect(destination.reconcile()).resolves.toEqual({ phase: "none" });
    }
  });

  it("denies a foreign live lease and permits authenticated expiry takeover without restaging", async () => {
    const { storage, service } = await configured();
    let now = 1_000;
    const first = new EncryptedMigrationDestination(storage, service, {
      now: () => now,
      ownerId: "00000000-0000-4000-8000-000000000101",
    });
    const stage = await first.stage({
      payload: { items: [item()] },
      sourceFingerprint: "a".repeat(64),
    });
    const writesAfterStage = storage.writeCount;
    const foreign = new EncryptedMigrationDestination(storage, service, {
      now: () => now,
      ownerId: "00000000-0000-4000-8000-000000000202",
    });

    await expect(foreign.verify(stage)).rejects.toMatchObject({ code: "MIGRATION_IN_PROGRESS" });
    expect(storage.writeCount).toBe(writesAfterStage);

    now += 30_001;
    await expect(foreign.verify(stage)).resolves.toEqual({ items: [item()] });
    expect(storage.writes.filter((entry) => entry.keys.includes(ACTIVE_ROOT_KEY))).toHaveLength(1);
  });
});
