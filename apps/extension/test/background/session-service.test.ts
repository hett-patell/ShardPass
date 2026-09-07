import {
  DEFAULT_ARGON2ID_PARAMETERS,
  createDeterministicRandomSource,
  unwrapVaultDataKeyWithKeyEncryptionKey,
} from "@shardpass/crypto";
import type { OtpItem } from "@shardpass/domain";
import {
  ACTIVE_ROOT_KEY,
  GenerationStore,
  VaultRepository,
  canonicalJson,
  generationKeys,
  type StorageValue,
  type VaultCryptoContext,
} from "@shardpass/storage";
import { FakeStoragePort } from "@shardpass/testing/fake-storage-port";
import { describe, expect, it, vi } from "vitest";

import { SessionService, VaultSessionError } from "../../src/background/vault/session-service";

const kek = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const wrongKek = new Uint8Array(32);
const popupBinding = {
  extensionId: "extension-id",
  contextKind: "popup" as const,
  senderUrl: "chrome-extension://extension-id/popup/index.html",
  documentId: "popup-document-1",
};
const otherPopupBinding = { ...popupBinding, documentId: "popup-document-2" };
const hotpItemId = "018f47a6-7d11-7c2f-8bd9-a1d37f147a20";
const reservationId = "018f47a6-7d11-7c2f-8bd9-a1d37f147a99";
const hotpItem: OtpItem = {
  id: hotpItemId,
  schemaVersion: 2,
  revision: 1,
  createdAt: "2026-08-03T12:00:00.000Z",
  updatedAt: "2026-08-03T12:00:00.000Z",
  favorite: false,
  tags: [],
  kind: "otp",
  issuer: "Synthetic",
  label: "counter",
  secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
  otpType: "hotp",
  algorithm: "SHA1",
  digits: 6,
  period: 0,
  counter: 0,
  note: "",
};
const hotpRequest = {
  itemId: hotpItemId,
  expectedRevision: 1,
  expectedCounter: 0,
  reservationId,
};

function fixture() {
  let milliseconds = 1_000;
  let id = 0;
  const local = new FakeStoragePort();
  const session = new FakeStoragePort();
  const random = createDeterministicRandomSource(
    Uint8Array.from({ length: 4096 }, (_, index) => index % 251),
  );
  const service = new SessionService({
    local,
    session,
    random,
    now: () => milliseconds,
    isoNow: () => new Date(milliseconds).toISOString(),
    nextId: () => `00000000-0000-4000-8000-${(++id).toString().padStart(12, "0")}`,
  });
  return { local, session, service, advance: (amount: number) => (milliseconds += amount) };
}

async function setup(service: SessionService) {
  const challenge = await service.createChallenge("setup", popupBinding);
  await service.setup(challenge.challengeId, kek.slice(), popupBinding);
}

async function unlock(service: SessionService) {
  const challenge = await service.createChallenge("unlock", popupBinding);
  await service.unlock(challenge.challengeId, kek.slice(), popupBinding);
}

async function readPortableFromStorage(local: FakeStoragePort) {
  const root = (await local.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY] as {
    wrappedKey: Parameters<typeof unwrapVaultDataKeyWithKeyEncryptionKey>[1];
  };
  const dek = await unwrapVaultDataKeyWithKeyEncryptionKey(kek.slice(), root.wrappedKey);
  let nonce = 180;
  let generation = 180;
  const context: VaultCryptoContext = {
    dek,
    random: { randomBytes: (length) => new Uint8Array(length).fill(nonce++) },
    clock: { now: () => "2026-08-03T12:05:00.000Z" },
    ids: {
      next: () => `00000000-0000-4000-8000-${(++generation).toString().padStart(12, "0")}`,
    },
  };
  try {
    return await new VaultRepository(local, root.wrappedKey).readPortableState(context);
  } finally {
    dek.fill(0);
  }
}

const importedItem: OtpItem = {
  ...hotpItem,
  id: "018f47a6-7d11-7c2f-8bd9-a1d37f147a98",
  issuer: "Portable",
  label: "imported",
  secret: "JBSWY3DPEHPK3PXP",
  otpType: "totp",
  period: 30,
  counter: undefined,
};
const portableDescriptor = {
  sourceFormat: "v2" as const,
  exportedAt: "2026-08-03T12:00:00.000Z",
  settings: { autoLockMinutes: 5 as const, lockOnScreenLock: false },
  history: {
    journal: [
      {
        sequence: 7,
        itemId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a97",
        kind: "otp" as const,
        schemaVersion: 1 as const,
        revision: 1,
        operation: "delete" as const,
        changedAt: "2026-08-03T12:00:00.000Z",
      },
    ],
    tombstones: [
      {
        itemId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a97",
        revision: 1,
        deletedAt: "2026-08-03T12:00:00.000Z",
      },
    ],
  },
};

describe("SessionService", () => {
  it("sets up only an empty vault and keeps the DEK out of local storage", async () => {
    const { local, session, service } = fixture();
    expect(await service.getState()).toMatchObject({ state: "unconfigured" });
    await setup(service);
    expect(await service.getState()).toMatchObject({ state: "unlocked" });
    expect((await local.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY]).toBeDefined();
    // The unlocked key lives in session storage (memory-only) so a worker restart keeps
    // the session; it is bound to the root it was unlocked against.
    const stored = (await session.snapshot()) as Record<string, { dek?: string; root?: string }>;
    expect(Object.keys(stored)).toEqual(["shardpass:v1:session"]);
    const record = stored["shardpass:v1:session"]!;
    expect(typeof record.dek).toBe("string");
    expect(JSON.stringify(await local.snapshot())).not.toContain(record.dek);
    await expect(setup(service)).rejects.toMatchObject({ code: "VAULT_ALREADY_CONFIGURED" });
  });

  it("reopens the session a previous worker instance left behind, but not after a lock or a root change", async () => {
    const values = fixture();
    await setup(values.service);
    const restart = () =>
      new SessionService({
        local: values.local,
        session: values.session,
        random: createDeterministicRandomSource(new Uint8Array(1024)),
        now: () => 2_000,
        isoNow: () => new Date(2_000).toISOString(),
        nextId: () => "10000000-0000-4000-8000-000000000001",
      });

    const survived = restart();
    expect(await survived.getState()).toMatchObject({ state: "locked" });
    expect(await survived.restoreSession()).toBe("restored");
    expect(await survived.getState()).toMatchObject({ state: "unlocked" });

    await survived.lock();
    expect(await values.session.snapshot()).toEqual({});
    const afterLock = restart();
    expect(await afterLock.restoreSession()).toBe("locked");
    expect(await afterLock.getState()).toMatchObject({ state: "locked" });

    await unlock(afterLock);
    // The root changing underneath (another profile, a restore) invalidates the key.
    const root = (await values.local.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY] as Record<string, unknown>;
    await values.local.set({ [ACTIVE_ROOT_KEY]: { ...root, generationId: "00000000-0000-4000-8000-00000000dead" } });
    const changed = restart();
    expect(await changed.restoreSession()).toBe("locked");
    expect(await values.session.snapshot()).toEqual({});
  });

  it("seals migration transaction plaintext with transaction-bound authenticated data", async () => {
    const { service } = fixture();
    await setup(service);
    const transactionId = "00000000-0000-4000-8000-000000000099";
    const plaintext = new TextEncoder().encode(
      canonicalJson({ revision: 1, phase: "staging", transactionId }),
    );

    const envelope = await service.sealMigrationTransaction(transactionId, plaintext);
    expect(JSON.stringify(envelope)).not.toContain("staging");
    await expect(service.openMigrationTransaction(envelope)).resolves.toEqual({
      transactionId,
      plaintext,
    });

    await expect(
      service.openMigrationTransaction({ ...envelope, transactionId: hotpItemId }),
    ).rejects.toMatchObject({ code: "VAULT_UNAVAILABLE" });
  });

  it("rejects malformed migration transaction envelopes with one safe public category", async () => {
    const { service } = fixture();
    await setup(service);
    const transactionId = "00000000-0000-4000-8000-000000000099";
    const envelope = await service.sealMigrationTransaction(
      transactionId,
      new TextEncoder().encode("{}"),
    );
    const cases: unknown[] = [
      { ...envelope, extra: true },
      { ...envelope, format: "wrong" },
      { ...envelope, version: 1 },
      { ...envelope, transactionId: hotpItemId },
      { ...envelope, nonce: "AA==" },
      { ...envelope, nonce: `${envelope.nonce.slice(0, -2)}A=` },
      { ...envelope, ciphertext: "AA==" },
      { ...envelope, ciphertext: "A".repeat(400_000) },
      { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -2)}A=` },
      { format: envelope.format, version: envelope.version, transactionId, nonce: envelope.nonce },
    ];

    for (const candidate of cases)
      await expect(service.openMigrationTransaction(candidate)).rejects.toMatchObject({
        code: "VAULT_UNAVAILABLE",
      });
  });

  it("rejects oversized canonical transaction ciphertext before Base64 allocation", async () => {
    const { service } = fixture();
    await setup(service);
    const atobSpy = vi.spyOn(globalThis, "atob");
    atobSpy.mockClear();
    await expect(
      service.openMigrationTransaction({
        format: "shardpass:migration-transaction",
        version: 2,
        transactionId: "00000000-0000-4000-8000-000000000099",
        nonce: "A".repeat(32),
        ciphertext: "A".repeat(400_000),
      }),
    ).rejects.toMatchObject({ code: "VAULT_UNAVAILABLE" });
    expect(atobSpy.mock.calls.every(([value]) => value.length < 400_000)).toBe(true);
    atobSpy.mockRestore();
  });

  it("returns an opaque migration capability with no root, DEK, context, or closures", async () => {
    const { service } = fixture();
    await setup(service);
    const capability = await service.beginMigration();
    expect(Object.keys(capability).sort()).toEqual(["activeGenerationId", "epoch"]);
    expect(JSON.stringify(capability)).not.toContain("wrappedKey");
    expect(Object.values(capability as object).some((value) => value instanceof Uint8Array)).toBe(
      false,
    );
    expect(Object.values(capability).some((value) => typeof value === "function")).toBe(false);
    await expect(service.assertMigrationCapability(capability)).resolves.toBeUndefined();
    expect(() => service.assertMigrationCapabilityCurrent(capability)).not.toThrow();
    expect(() => service.assertMigrationCapabilityCurrent({ ...capability })).toThrowError(
      expect.objectContaining({ code: "VAULT_LOCKED" }),
    );
    await expect(service.assertMigrationCapability({ ...capability })).rejects.toMatchObject({
      code: "VAULT_LOCKED",
    });
    const staged = await service.stageMigration(capability, { items: [], metadata: [] });
    expect(Object.keys(staged)).toEqual(["generationId"]);
    expect(JSON.stringify(staged)).not.toContain("wrappedKey");
    await expect(service.readMigration(staged)).resolves.toEqual({ items: [], metadata: [] });
    await service.lock();
    await expect(
      service.stageMigration(capability, { items: [], metadata: [] }),
    ).rejects.toMatchObject({ code: "VAULT_LOCKED" });
    await expect(service.readMigration(staged)).rejects.toMatchObject({ code: "VAULT_LOCKED" });
    await expect(
      service.stageMigration({ ...capability }, { items: [], metadata: [] }),
    ).rejects.toMatchObject({ code: "VAULT_LOCKED" });
  });

  it("settles root-write-then-throw without reacquiring the mutation mutex and locks", async () => {
    const values = fixture();
    values.local.failWriteAt(4, "after", new Error("synthetic root write failure"));
    const challenge = await values.service.createChallenge("setup", popupBinding);
    await expect(
      Promise.race([
        values.service.setup(challenge.challengeId, kek.slice(), popupBinding),
        new Promise((_, reject) => setTimeout(() => reject(new Error("commit timed out")), 250)),
      ]),
    ).resolves.toEqual({ committed: true, state: "locked" });
    await expect(values.service.getState()).resolves.toMatchObject({ state: "locked" });
  });

  it("never reports an unauthenticated ambiguous target as committed", async () => {
    for (const corruption of [
      "missing-marker",
      "tampered-manifest",
      "read-root-failure",
    ] as const) {
      const values = fixture();
      const originalSet = values.local.set.bind(values.local);
      values.local.set = async (entries) => {
        await originalSet(entries);
        const root = entries[ACTIVE_ROOT_KEY] as { activeGenerationId?: string } | undefined;
        if (root?.activeGenerationId === undefined) return;
        const keys = generationKeys(root.activeGenerationId);
        if (corruption === "missing-marker") await values.local.remove([keys.verified]);
        if (corruption === "tampered-manifest") {
          const snapshot = await values.local.snapshot();
          await originalSet({
            [keys.manifest]: {
              ...(snapshot[keys.manifest] as object),
              manifestHash: Buffer.alloc(32, 9).toString("base64"),
            },
          });
        }
        if (corruption === "read-root-failure")
          values.local.failNext("get", new Error("synthetic read failure"));
        throw new Error("synthetic root write failure");
      };
      const challenge = await values.service.createChallenge("setup", popupBinding);
      await expect(
        Promise.race([
          values.service.setup(challenge.challengeId, kek.slice(), popupBinding),
          new Promise((_, reject) => setTimeout(() => reject(new Error("commit timed out")), 250)),
        ]),
      ).rejects.toMatchObject({ code: "VAULT_LOCKED" });
      await expect(values.service.getState()).resolves.toMatchObject({ state: "locked" });
    }
  });

  it("settles a competing root write and locks without claiming commitment", async () => {
    const values = fixture();
    const originalSet = values.local.set.bind(values.local);
    values.local.set = async (entries) => {
      const root = entries[ACTIVE_ROOT_KEY] as Record<string, StorageValue> | undefined;
      if (root === undefined) return originalSet(entries);
      await originalSet({
        [ACTIVE_ROOT_KEY]: {
          ...root,
          activeGenerationId: "10000000-0000-4000-8000-000000000099",
        },
      });
      throw new Error("synthetic competing root");
    };
    const challenge = await values.service.createChallenge("setup", popupBinding);
    await expect(
      Promise.race([
        values.service.setup(challenge.challengeId, kek.slice(), popupBinding),
        new Promise((_, reject) => setTimeout(() => reject(new Error("commit timed out")), 250)),
      ]),
    ).rejects.toMatchObject({ code: "VAULT_LOCKED" });
    await expect(values.service.getState()).resolves.toMatchObject({ state: "locked" });
  });

  it("runs lock/dispose callbacks without exposing migration key material", async () => {
    const { service } = fixture();
    await setup(service);
    let cleared = 0;
    const dispose = service.onLockOrDispose(() => {
      cleared += 1;
    });
    await service.lock();
    expect(cleared).toBe(1);
    dispose();
    await service.lock();
    expect(cleared).toBe(1);
  });

  it("locks on explicit lock and a fresh service-worker instance starts locked", async () => {
    const values = fixture();
    await setup(values.service);
    await values.service.lock();
    expect(await values.service.getState()).toMatchObject({ state: "locked" });

    const restarted = new SessionService({
      local: values.local,
      session: values.session,
      random: createDeterministicRandomSource(new Uint8Array(1024)),
      now: () => 2_000,
      isoNow: () => new Date(2_000).toISOString(),
      nextId: () => "10000000-0000-4000-8000-000000000001",
    });
    expect(await restarted.getState()).toMatchObject({ state: "locked" });
  });

  it("unlocks only with a current challenge and maps wrong key or tamper to INVALID_CREDENTIALS", async () => {
    const { service } = fixture();
    await setup(service);
    await service.lock();
    const challenge = await service.createChallenge("unlock", popupBinding);
    await expect(
      service.unlock(challenge.challengeId, wrongKek.slice(), popupBinding),
    ).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    await expect(
      service.unlock(challenge.challengeId, wrongKek.slice(), popupBinding),
    ).rejects.toMatchObject({
      code: "CHALLENGE_INVALID",
    });
    const fresh = await service.createChallenge("unlock", popupBinding);
    await expect(
      service.unlock(fresh.challengeId, kek.slice(), popupBinding),
    ).resolves.toBeUndefined();
  });

  it("binds a challenge to one exact extension document and consumes mismatches atomically", async () => {
    const { service } = fixture();
    const challenge = await service.createChallenge("setup", popupBinding);
    const supplied = kek.slice();
    await expect(
      service.setup(challenge.challengeId, supplied, otherPopupBinding),
    ).rejects.toMatchObject({
      code: "CHALLENGE_INVALID",
    });
    expect(supplied.every((value) => value === 0)).toBe(true);
    await expect(
      service.setup(challenge.challengeId, kek.slice(), popupBinding),
    ).rejects.toMatchObject({
      code: "CHALLENGE_INVALID",
    });
  });

  it("keeps a document-bound challenge valid for a slow approved KDF but expires it at five minutes", async () => {
    const { service, advance } = fixture();
    const usable = await service.createChallenge("setup", popupBinding);
    advance(299_999);
    await expect(
      service.setup(usable.challengeId, kek.slice(), popupBinding),
    ).resolves.toMatchObject({
      committed: true,
    });

    const next = fixture();
    const expired = await next.service.createChallenge("setup", popupBinding);
    next.advance(300_001);
    await expect(
      next.service.setup(expired.challengeId, kek.slice(), popupBinding),
    ).rejects.toMatchObject({ code: "CHALLENGE_INVALID" });
  });

  it("invalidates outstanding challenges on lock", async () => {
    const { service } = fixture();
    const challenge = await service.createChallenge("setup", popupBinding);
    await service.lock();
    await expect(
      service.setup(challenge.challengeId, kek.slice(), popupBinding),
    ).rejects.toMatchObject({
      code: "CHALLENGE_INVALID",
    });
  });

  it("persists throttling across service instances without revealing vault contents", async () => {
    const values = fixture();
    await setup(values.service);
    await values.service.lock();
    for (let attempt = 0; attempt < 5; attempt++) {
      const challenge = await values.service.createChallenge("unlock", popupBinding);
      await expect(
        values.service.unlock(challenge.challengeId, wrongKek.slice(), popupBinding),
      ).rejects.toMatchObject({
        code: "INVALID_CREDENTIALS",
      });
    }
    await expect(values.service.createChallenge("unlock", popupBinding)).rejects.toMatchObject({
      code: "THROTTLED",
      retryAfterMs: 30_000,
    });

    const restarted = new SessionService({
      local: values.local,
      session: values.session,
      random: createDeterministicRandomSource(new Uint8Array(1024)),
      now: () => 1_000,
      isoNow: () => new Date(1_000).toISOString(),
      nextId: () => "10000000-0000-4000-8000-000000000001",
    });
    await expect(restarted.createChallenge("unlock", popupBinding)).rejects.toMatchObject({
      code: "THROTTLED",
    });
    values.advance(30_000);
    const challenge = await values.service.createChallenge("unlock", popupBinding);
    expect(challenge.kdf).toMatchObject(DEFAULT_ARGON2ID_PARAMETERS);
  });

  it("locks on an external authenticated root notification instead of overwriting it", async () => {
    const { local, service } = fixture();
    await setup(service);
    const current = (await local.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY] as Record<
      string,
      StorageValue
    >;
    const external = {
      ...current,
      activeGenerationId: "10000000-0000-4000-8000-000000000099",
    };

    await local.set({ [ACTIVE_ROOT_KEY]: external });
    await service.handleActiveRootChange(external);

    await expect(service.getState()).resolves.toMatchObject({ state: "locked" });
    expect((await local.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY]).toEqual(external);
  });

  it("keeps the session unlocked when Chrome reports a stale root after migration commit", async () => {
    const { local, service } = fixture();
    await setup(service);
    const preMigrationRoot = (await local.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY];
    const capability = await service.beginMigration();
    const migrated = await service.stageMigration(capability, { items: [], metadata: [] });

    await expect(service.commitMigration(migrated)).resolves.toEqual({
      committed: true,
      state: "unlocked",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    await service.handleActiveRootChange(preMigrationRoot);

    await expect(service.getState()).resolves.toMatchObject({ state: "unlocked" });
    await expect(service.assertActiveRoot()).resolves.toBeUndefined();
  });

  it("preserves authenticated metadata and HOTP receipt idempotence across password rotation", async () => {
    const { local, service } = fixture();
    await setup(service);
    const metadata = [
      {
        name: "migration-descriptor" as const,
        schemaVersion: 1 as const,
        plaintext: new TextEncoder().encode(canonicalJson({ source: "synthetic" })),
      },
      {
        name: "lock-settings" as const,
        schemaVersion: 1 as const,
        plaintext: new TextEncoder().encode(
          canonicalJson({ autoLockMinutes: 7, lockOnScreenLock: false }),
        ),
      },
      {
        name: "ente-otp-state" as const,
        schemaVersion: 1 as const,
        plaintext: new TextEncoder().encode(canonicalJson({ entityMap: {}, pending: [] })),
      },
    ];
    const capability = await service.beginMigration();
    const migrated = await service.stageMigration(capability, { items: [hotpItem], metadata });
    await service.commitMigration(migrated);
    await service.lock();

    const beforeReceiptRoot = (await local.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY] as {
      wrappedKey: Parameters<typeof unwrapVaultDataKeyWithKeyEncryptionKey>[1];
    };
    const dek = await unwrapVaultDataKeyWithKeyEncryptionKey(
      kek.slice(),
      beforeReceiptRoot.wrappedKey,
    );
    let generation = 50;
    let nonce = 100;
    const repositoryContext: VaultCryptoContext = {
      dek,
      random: { randomBytes: (length) => new Uint8Array(length).fill(nonce++) },
      clock: { now: () => "2026-08-03T12:01:00.000Z" },
      ids: {
        next: () => `00000000-0000-4000-8000-${(++generation).toString().padStart(12, "0")}`,
      },
    };
    const repository = new VaultRepository(local, beforeReceiptRoot.wrappedKey);
    const receiptResult = await repository.commitHotpReservation(hotpRequest, repositoryContext);
    dek.fill(0);

    const unlockCurrent = await service.createChallenge("unlock", popupBinding);
    await service.unlock(unlockCurrent.challengeId, kek.slice(), popupBinding);
    const current = await service.createChallenge("change-current", popupBinding);
    const next = await service.createChallenge("change-new", popupBinding);
    const newKek = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
    await service.changePassword(
      current.challengeId,
      kek.slice(),
      next.challengeId,
      newKek.slice(),
      popupBinding,
    );
    await service.lock();

    const oldChallenge = await service.createChallenge("unlock", popupBinding);
    await expect(
      service.unlock(oldChallenge.challengeId, kek.slice(), popupBinding),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    const newChallenge = await service.createChallenge("unlock", popupBinding);
    await service.unlock(newChallenge.challengeId, newKek.slice(), popupBinding);

    const rotatedRoot = (await local.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY] as {
      wrappedKey: Parameters<typeof unwrapVaultDataKeyWithKeyEncryptionKey>[1];
    };
    const rotatedDek = await unwrapVaultDataKeyWithKeyEncryptionKey(
      newKek.slice(),
      rotatedRoot.wrappedKey,
    );
    const rotatedContext: VaultCryptoContext = { ...repositoryContext, dek: rotatedDek };
    const active = await new GenerationStore(local).readActive(rotatedContext);
    const semantics = await Promise.all(
      active!.metadata.map((entry) =>
        new GenerationStore(local).decryptMetadata(entry, rotatedContext),
      ),
    );
    expect(active!.metadata.map((entry, index) => [entry.name, semantics[index]])).toEqual(
      metadata
        .map((entry) => [entry.name, entry.plaintext] as const)
        .sort(([left], [right]) => left.localeCompare(right)),
    );
    const rotatedRepository = new VaultRepository(local, rotatedRoot.wrappedKey);
    const writes = local.writeCount;
    await expect(
      rotatedRepository.commitHotpReservation(hotpRequest, rotatedContext),
    ).resolves.toEqual(receiptResult);
    expect(local.writeCount).toBe(writes);
    await expect(rotatedRepository.get(hotpItemId, rotatedContext)).resolves.toMatchObject({
      revision: 2,
      counter: 1,
    });
    rotatedDek.fill(0);
  });

  it("verifies a current-key challenge without changing the password and binds opaque backup authority", async () => {
    const { service } = fixture();
    await setup(service);
    const challenge = await service.createBackupStepUpChallenge(popupBinding);
    const ownedKey = kek.slice();
    const authority = await service.authorizeBackupExport(
      challenge.challengeId,
      ownedKey,
      popupBinding,
    );
    expect(ownedKey).toEqual(new Uint8Array(32));
    await expect(service.assertBackupSession(authority)).resolves.toBeUndefined();

    const replayKey = kek.slice();
    await expect(
      service.authorizeBackupExport(challenge.challengeId, replayKey, popupBinding),
    ).rejects.toMatchObject({ code: "CHALLENGE_INVALID" });
    expect(replayKey).toEqual(new Uint8Array(32));

    const captured = await service.captureBackupSession();
    await expect(service.assertBackupSession(captured)).resolves.toBeUndefined();
    await service.lock();
    await expect(service.assertBackupSession(authority)).rejects.toMatchObject({
      code: "VAULT_LOCKED",
    });
    await expect(service.assertBackupSession(captured)).rejects.toMatchObject({
      code: "VAULT_LOCKED",
    });
  });

  it("builds authenticated portable snapshots with narrow settings and confirms imports under authority", async () => {
    const { local, service } = fixture();
    await setup(service);
    await service.vaultRepository.create(hotpItem);
    await service.captureBackupSession();
    const settings = { autoLockMinutes: 30 as const, lockOnScreenLock: false };

    await service.updateLockSettings(settings);
    const updatedAuthority = await service.captureBackupSession();
    const snapshot = await service.readPortableBackupSnapshot(updatedAuthority, () => ({
      autoLockMinutes: 5,
      lockOnScreenLock: true,
    }));
    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      items: [{ id: hotpItemId, counter: 0 }],
      settings,
      history: { tombstones: [] },
    });
    const descriptor = {
      sourceFormat: "v2" as const,
      exportedAt: snapshot.exportedAt,
      settings,
      history: snapshot.history,
    };
    const changedDescriptor = {
      ...descriptor,
      settings: { autoLockMinutes: 5 as const, lockOnScreenLock: false },
    };
    const preview = await service.previewPortableBackupImport(
      changedDescriptor,
      snapshot.items,
      updatedAuthority,
    );
    expect(preview).toMatchObject({
      duplicate: 1,
      accepted: 0,
      conflict: 0,
      settings: "replace",
      history: { journalAdded: 0, tombstonesAdded: 0 },
    });
    const beforeConfirm = await service.previewPortableBackupImport(
      descriptor,
      snapshot.items,
      updatedAuthority,
    );
    expect(beforeConfirm.settings).toBe("unchanged");
    const rootsBeforeConfirm = local.writes.filter((write) =>
      write.keys.includes(ACTIVE_ROOT_KEY),
    ).length;
    await service.confirmPortableBackupImport(
      changedDescriptor,
      snapshot.items,
      preview,
      updatedAuthority,
    );
    const rootsAfterConfirm = local.writes.filter((write) =>
      write.keys.includes(ACTIVE_ROOT_KEY),
    ).length;
    expect(rootsAfterConfirm).toBe(rootsBeforeConfirm + 1);
    const afterConfirm = await service.readPortableBackupSnapshot(updatedAuthority, () => settings);
    expect(afterConfirm.settings).toEqual(changedDescriptor.settings);
    const stale = await service.confirmPortableBackupImport(
      changedDescriptor,
      snapshot.items,
      preview,
      updatedAuthority,
    );
    expect(stale).toMatchObject({ previewChanged: true, preview: { settings: "unchanged" } });
    const reconfirm = await service.confirmPortableBackupImport(
      changedDescriptor,
      snapshot.items,
      stale.previewChanged ? stale.preview : preview,
      updatedAuthority,
    );
    expect(reconfirm).toMatchObject({ previewChanged: false });
    expect(local.writes.filter((write) => write.keys.includes(ACTIVE_ROOT_KEY))).toHaveLength(
      rootsAfterConfirm,
    );
    const finalPreview = await service.previewPortableBackupImport(
      changedDescriptor,
      snapshot.items,
      updatedAuthority,
    );
    expect(finalPreview.settings).toBe("unchanged");
    await expect(
      service.confirmPortableBackupImport(
        changedDescriptor,
        snapshot.items,
        finalPreview,
        updatedAuthority,
      ),
    ).resolves.toMatchObject({ previewChanged: false, imported: 0, duplicate: 1, conflict: 0 });
  });

  it("fails closed after an active-root write-then-throw ambiguity and retries without partial or duplicate portable state", async () => {
    async function prepared() {
      const values = fixture();
      await setup(values.service);
      await values.service.vaultRepository.create(hotpItem);
      const authority = await values.service.captureBackupSession();
      const preview = await values.service.previewPortableBackupImport(
        portableDescriptor,
        [importedItem],
        authority,
      );
      return { ...values, authority, preview };
    }

    const probe = await prepared();
    const probeStart = probe.local.writes.length;
    await probe.service.confirmPortableBackupImport(
      portableDescriptor,
      [importedItem],
      probe.preview,
      probe.authority,
    );
    const rootOffset = probe.local.writes
      .slice(probeStart)
      .findIndex((write) => write.keys.includes(ACTIVE_ROOT_KEY));
    expect(rootOffset).toBeGreaterThanOrEqual(0);

    const values = await prepared();
    const rootsBefore = values.local.writes.filter((write) =>
      write.keys.includes(ACTIVE_ROOT_KEY),
    ).length;
    values.local.failWriteAt(
      values.local.writeCount + rootOffset + 1,
      "after",
      new Error("ambiguous active-root write"),
    );

    await expect(
      values.service.confirmPortableBackupImport(
        portableDescriptor,
        [importedItem],
        values.preview,
        values.authority,
      ),
    ).rejects.toMatchObject({ code: "VAULT_LOCKED" });
    await expect(values.service.getState()).resolves.toMatchObject({ state: "locked" });
    const committed = await readPortableFromStorage(values.local);
    expect(committed.items.map((candidate) => candidate.issuer).sort()).toEqual(
      [hotpItem.issuer, importedItem.issuer].sort(),
    );
    expect(committed.settings).toEqual(portableDescriptor.settings);
    expect(committed.tombstones).toEqual(portableDescriptor.history.tombstones);
    expect(committed.journal).toHaveLength(3);
    expect(
      values.local.writes.filter((write) => write.keys.includes(ACTIVE_ROOT_KEY)),
    ).toHaveLength(rootsBefore + 1);

    await unlock(values.service);
    const retryAuthority = await values.service.captureBackupSession();
    const retryPreview = await values.service.previewPortableBackupImport(
      portableDescriptor,
      [importedItem],
      retryAuthority,
    );
    await expect(
      values.service.confirmPortableBackupImport(
        portableDescriptor,
        [importedItem],
        retryPreview,
        retryAuthority,
      ),
    ).resolves.toMatchObject({ previewChanged: false, imported: 0, duplicate: 1 });
    const retried = await readPortableFromStorage(values.local);
    expect(retried.items).toHaveLength(2);
    expect(retried.journal).toEqual(committed.journal);
    expect(
      values.local.writes.filter((write) => write.keys.includes(ACTIVE_ROOT_KEY)),
    ).toHaveLength(rootsBefore + 1);
  });

  it("serializes concurrent overlapping portable confirmations to at most one active-root transition", async () => {
    const { local, service } = fixture();
    await setup(service);
    await service.vaultRepository.create(hotpItem);
    const authority = await service.captureBackupSession();
    const preview = await service.previewPortableBackupImport(
      portableDescriptor,
      [importedItem],
      authority,
    );
    const rootsBefore = local.writes.filter((write) => write.keys.includes(ACTIVE_ROOT_KEY)).length;

    const results = await Promise.all([
      service.confirmPortableBackupImport(portableDescriptor, [importedItem], preview, authority),
      service.confirmPortableBackupImport(portableDescriptor, [importedItem], preview, authority),
    ]);

    expect(results.filter((result) => !result.previewChanged)).toHaveLength(1);
    expect(results.filter((result) => result.previewChanged)).toHaveLength(1);
    expect(local.writes.filter((write) => write.keys.includes(ACTIVE_ROOT_KEY))).toHaveLength(
      rootsBefore + 1,
    );
    const state = await readPortableFromStorage(local);
    expect(state.items.map((candidate) => candidate.issuer).sort()).toEqual(
      [hotpItem.issuer, importedItem.issuer].sort(),
    );
    expect(state.settings).toEqual(portableDescriptor.settings);
    expect(state.tombstones).toEqual(portableDescriptor.history.tombstones);
    expect(state.journal).toHaveLength(3);
  });

  it("fails closed when an external-root notification crosses an in-flight portable confirmation and retries without duplicates", async () => {
    const { local, service } = fixture();
    await setup(service);
    await service.vaultRepository.create(hotpItem);
    const oldState = await readPortableFromStorage(local);
    expect(oldState.items).toHaveLength(1);
    expect(oldState.items[0]).toMatchObject({
      id: hotpItem.id,
      issuer: hotpItem.issuer,
      counter: 0,
    });
    expect(oldState.settings).toEqual({ autoLockMinutes: 15, lockOnScreenLock: true });
    expect(oldState.journal).toHaveLength(1);
    expect(oldState.tombstones).toEqual([]);
    const authority = await service.captureBackupSession();
    const preview = await service.previewPortableBackupImport(
      portableDescriptor,
      [importedItem],
      authority,
    );
    const originalSet = local.set.bind(local);
    let release!: () => void;
    let reached!: () => void;
    const reachedWrite = new Promise<void>((resolve) => (reached = resolve));
    const releaseWrite = new Promise<void>((resolve) => (release = resolve));
    let paused = false;
    local.set = async (values) => {
      if (!paused && Object.keys(values).some((key) => key.includes(":record:"))) {
        paused = true;
        reached();
        await releaseWrite;
      }
      return originalSet(values);
    };
    const rootsBefore = local.writes.filter((write) => write.keys.includes(ACTIVE_ROOT_KEY)).length;

    const pending = service.confirmPortableBackupImport(
      portableDescriptor,
      [importedItem],
      preview,
      authority,
    );
    await reachedWrite;
    const notification = service.handleActiveRootChange({ external: true });
    release();
    await expect(pending).rejects.toMatchObject({ code: "VAULT_LOCKED" });
    await notification;
    await expect(service.getState()).resolves.toMatchObject({ state: "locked" });
    expect(local.writes.filter((write) => write.keys.includes(ACTIVE_ROOT_KEY))).toHaveLength(
      rootsBefore + 1,
    );
    const committed = await readPortableFromStorage(local);
    expect(committed.items).toHaveLength(2);
    expect(committed.settings).toEqual(portableDescriptor.settings);
    expect(committed.tombstones).toEqual(portableDescriptor.history.tombstones);
    expect(committed.journal).toHaveLength(3);

    await unlock(service);
    const retryAuthority = await service.captureBackupSession();
    const retryPreview = await service.previewPortableBackupImport(
      portableDescriptor,
      [importedItem],
      retryAuthority,
    );
    await expect(
      service.confirmPortableBackupImport(
        portableDescriptor,
        [importedItem],
        retryPreview,
        retryAuthority,
      ),
    ).resolves.toMatchObject({ previewChanged: false, imported: 0, duplicate: 1 });
    const retried = await readPortableFromStorage(local);
    expect(retried.items).toHaveLength(2);
    expect(retried.journal).toEqual(committed.journal);
  });

  it("rejects the wrong current key without changing the unlocked session", async () => {
    const { service } = fixture();
    await setup(service);
    const challenge = await service.createBackupStepUpChallenge(popupBinding);
    await expect(
      service.authorizeBackupExport(challenge.challengeId, wrongKek.slice(), popupBinding),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(service.getState()).resolves.toMatchObject({ state: "unlocked" });
  });

  it("rotates the wrapped key around the same DEK and invalidates the old key", async () => {
    const { local, service } = fixture();
    await setup(service);
    const before = (await local.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY];
    const current = await service.createChallenge("change-current", popupBinding);
    const next = await service.createChallenge("change-new", popupBinding);
    const newKek = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
    await service.changePassword(
      current.challengeId,
      kek.slice(),
      next.challengeId,
      newKek.slice(),
      popupBinding,
    );
    const after = (await local.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY];
    expect(after).not.toEqual(before);
    await service.lock();
    const oldChallenge = await service.createChallenge("unlock", popupBinding);
    await expect(
      service.unlock(oldChallenge.challengeId, kek.slice(), popupBinding),
    ).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    const newChallenge = await service.createChallenge("unlock", popupBinding);
    await expect(
      service.unlock(newChallenge.challengeId, newKek.slice(), popupBinding),
    ).resolves.toBeUndefined();
  });

  it("locks immediately when authenticated active storage changes externally", async () => {
    const { local, service } = fixture();
    await setup(service);
    await local.set({ [ACTIVE_ROOT_KEY]: { corrupt: true } });
    await expect(service.assertActiveRoot()).rejects.toBeInstanceOf(VaultSessionError);
    await expect(service.getState()).rejects.toMatchObject({ code: "VAULT_UNAVAILABLE" });
  });
});
