import {
  MAX_ITEM_TAGS,
  MAX_ITEM_TAG_LENGTH,
  MAX_OTP_ISSUER_LENGTH,
  MAX_OTP_LABEL_LENGTH,
  MAX_OTP_NOTE_LENGTH,
  MAX_OTP_SECRET_LENGTH,
  OtpItemSchema,
} from "@shardpass/domain";
import { describe, expect, it } from "vitest";

import { encodePendingHotpReservations } from "../src/hotp-pending";
import { FakeStoragePort } from "../../testing/src/fake-storage-port";
import {
  ACTIVE_ROOT_KEY,
  GENERATION_PREFIX,
  GenerationStore,
  VaultRepository,
  canonicalJson,
  generationKeys,
  preflightOtpImportGenerationCapacity,
  type VaultCryptoContext,
  type VaultRepositoryActivationCoordinator,
  type WrappedVaultKey,
} from "../src";

const itemId = "018f47a6-7d11-7c2f-8bd9-a1d37f147a20";
const generations = [
  "018f47a6-7d11-7c2f-8bd9-a1d37f147a21",
  "018f47a6-7d11-7c2f-8bd9-a1d37f147a22",
  "018f47a6-7d11-7c2f-8bd9-a1d37f147a23",
  "018f47a6-7d11-7c2f-8bd9-a1d37f147a24",
  "018f47a6-7d11-7c2f-8bd9-a1d37f147a25",
  "018f47a6-7d11-7c2f-8bd9-a1d37f147a26",
  "018f47a6-7d11-7c2f-8bd9-a1d37f147a27",
  "018f47a6-7d11-7c2f-8bd9-a1d37f147a28",
];
const timestamps = [
  "2026-07-29T10:20:30.000Z",
  "2026-07-29T10:21:30.000Z",
  "2026-07-29T10:22:30.000Z",
  "2026-07-29T10:23:30.000Z",
];
const wrappedKey: WrappedVaultKey = {
  formatVersion: 1,
  kdf: {
    algorithm: "argon2id",
    salt: Buffer.alloc(16, 1).toString("base64"),
    memoryKiB: 65_536,
    iterations: 2,
    parallelism: 1,
  },
  wrapping: {
    algorithm: "xchacha20-poly1305",
    nonce: Buffer.alloc(24, 2).toString("base64"),
    ciphertext: Buffer.alloc(48, 3).toString("base64"),
    encoding: "base64",
  },
};

function cryptoContext(): VaultCryptoContext {
  let generationIndex = 0;
  let clockIndex = 0;
  let nonce = 1;
  return {
    dek: new Uint8Array(32).fill(7),
    random: {
      randomBytes(length) {
        const output = new Uint8Array(length).fill(nonce);
        nonce += 1;
        return output;
      },
    },
    clock: { now: () => timestamps[Math.min(clockIndex++, timestamps.length - 1)]! },
    ids: { next: () => generations[generationIndex++]! },
  };
}

function collisionContext(generationId: string, nonceBytes: readonly number[]): VaultCryptoContext {
  let nonceIndex = 0;
  return {
    dek: new Uint8Array(32).fill(7),
    random: {
      randomBytes(length) {
        return new Uint8Array(length).fill(nonceBytes[nonceIndex++] ?? 250);
      },
    },
    clock: { now: () => timestamps[3]! },
    ids: { next: () => generationId },
  };
}

function maximumEscapedItem() {
  const worstEscapingText = (length: number, suffix = "") =>
    `${suffix}${"\u0001".repeat(length - suffix.length)}`;
  return OtpItemSchema.parse({
    id: itemId,
    schemaVersion: 1,
    revision: 1,
    createdAt: timestamps[0]!,
    updatedAt: timestamps[0]!,
    favorite: true,
    archivedAt: timestamps[0]!,
    deletedAt: timestamps[0]!,
    tags: Array.from({ length: MAX_ITEM_TAGS }, (_, index) =>
      worstEscapingText(MAX_ITEM_TAG_LENGTH, `${String(index).padStart(2, "0")}\\"😀`),
    ),
    kind: "otp",
    issuer: worstEscapingText(MAX_OTP_ISSUER_LENGTH, '\\"😀'),
    label: worstEscapingText(MAX_OTP_LABEL_LENGTH, '\\"😀'),
    secret: "A".repeat(MAX_OTP_SECRET_LENGTH),
    otpType: "hotp",
    algorithm: "SHA512",
    digits: 10,
    period: 0,
    counter: Number.MAX_SAFE_INTEGER,
    note: worstEscapingText(MAX_OTP_NOTE_LENGTH, '\\"😀'),
  });
}

function hotpItem(counter = 7) {
  return OtpItemSchema.parse({
    ...item(),
    otpType: "hotp",
    period: 0,
    counter,
  });
}

function pending(
  overrides: Partial<{
    reservationId: string;
    itemId: string;
    expectedRevision: number;
    expectedCounter: number;
    binding: { tabId: number; frameId: number; documentId: string };
    createdAt: number;
    expiresAt: number;
    sessionEpoch: number;
    state: "pending";
  }> = {},
) {
  return {
    reservationId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a99",
    itemId,
    expectedRevision: 1,
    expectedCounter: 7,
    binding: { tabId: 4, frameId: 0, documentId: "document-a" },
    createdAt: 1_000,
    expiresAt: 31_000,
    sessionEpoch: 0,
    state: "pending" as const,
    ...overrides,
  };
}

function item(revision = 1) {
  return {
    id: itemId,
    schemaVersion: 1 as const,
    revision,
    createdAt: timestamps[0]!,
    updatedAt: timestamps[0]!,
    favorite: false,
    tags: ["work"],
    kind: "otp" as const,
    issuer: "Example",
    label: "user@example.test",
    secret: "JBSWY3DPEHPK3PXP",
    otpType: "totp" as const,
    algorithm: "SHA1" as const,
    digits: 6,
    period: 30,
    note: "private",
  };
}

function portableCandidate() {
  return OtpItemSchema.parse({
    ...item(),
    id: generations[7]!,
    issuer: "Portable",
    label: "import@example.test",
    secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    tags: ["imported"],
    note: "",
  });
}

function portableDescriptor() {
  return {
    settings: { autoLockMinutes: 5 as const, lockOnScreenLock: false },
    history: {
      journal: [
        {
          sequence: 9,
          itemId: generations[6]!,
          kind: "otp" as const,
          schemaVersion: 1 as const,
          revision: 1,
          operation: "delete" as const,
          changedAt: timestamps[1]!,
        },
      ],
      tombstones: [{ itemId: generations[6]!, revision: 1, deletedAt: timestamps[1]! }],
    },
  };
}

describe("VaultRepository", () => {
  it("cancels an authenticated recreated pending reservation and removes final metadata", async () => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey);
    const context = cryptoContext();
    await repository.create(hotpItem(), context);
    const value = pending();
    await repository.savePendingHotpReservation(value, context);

    await expect(
      new VaultRepository(storage, wrappedKey).cancelPendingHotpReservation(
        value.reservationId,
        value.binding,
        value.sessionEpoch,
        30_999,
        context,
      ),
    ).resolves.toBe(true);

    const restarted = new VaultRepository(storage, wrappedKey);
    await expect(
      restarted.commitPendingHotpReservation(
        value.reservationId,
        value.binding,
        value.sessionEpoch,
        30_999,
        context,
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(restarted.get(itemId, context)).resolves.toMatchObject({ counter: 7 });
    const active = await new GenerationStore(storage).readActive(context);
    expect(active!.metadata.map((entry) => entry.name)).not.toContain("hotp-pending-state");
  });

  it("commits counter, receipt, and pending removal in one generation", async () => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey);
    const context = cryptoContext();
    await repository.create(hotpItem(), context);
    const value = pending();
    await repository.savePendingHotpReservation(value, context);
    const before = storage.writes.length;

    await expect(
      repository.commitPendingHotpReservation(
        value.reservationId,
        value.binding,
        value.sessionEpoch,
        30_999,
        context,
      ),
    ).resolves.toEqual({ revision: 2, counter: 8 });

    const roots = storage.writes
      .slice(before)
      .flatMap((write) => write.keys)
      .filter((key) => key === ACTIVE_ROOT_KEY);
    expect(roots).toHaveLength(1);
    await expect(repository.get(itemId, context)).resolves.toMatchObject({ counter: 8 });
    const active = await new GenerationStore(storage).readActive(context);
    expect(active!.metadata.map((entry) => entry.name)).not.toContain("hotp-pending-state");
  });

  it("replaces the durable same-item/session pending identity", async () => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey);
    const context = cryptoContext();
    const first = pending();
    const second = pending({ reservationId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a98" });
    await repository.savePendingHotpReservation(first, context);
    await repository.savePendingHotpReservation(second, context);

    const restarted = new VaultRepository(storage, wrappedKey);
    await expect(
      restarted.lookupPendingHotpReservation(first.reservationId, 0, context),
    ).resolves.toBeNull();
    await expect(
      restarted.lookupPendingHotpReservation(second.reservationId, 0, context),
    ).resolves.toEqual(second);
  });

  it("prunes exact expired and prior-epoch entries before the 100-entry capacity preflight", async () => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey);
    const context = cryptoContext();
    const stale = Array.from({ length: 100 }, (_, index) =>
      pending({
        reservationId: `018f47a6-7d11-7c2f-8bd9-${String(index).padStart(12, "0")}`,
        itemId: `018f47a6-7d11-7c2f-8bd9-${String(1000 + index).padStart(12, "0")}`,
        expiresAt: index < 50 ? 2_000 : 40_000,
        sessionEpoch: index < 50 ? 1 : 0,
      }),
    );
    const generationsStore = new GenerationStore(storage);
    const staged = await generationsStore.stage({
      expectedRoot: null,
      wrappedKey,
      records: [],
      journal: [],
      metadata: [
        {
          name: "hotp-pending-state",
          schemaVersion: 1,
          plaintext: encodePendingHotpReservations(stale),
        },
      ],
      context,
    });
    await generationsStore.activate(await generationsStore.verify(staged, context), context);
    const fresh = pending({ reservationId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a97" });

    await expect(
      repository.savePendingHotpReservation(fresh, 0, 2_000, context),
    ).resolves.toBeUndefined();
    await expect(
      repository.lookupPendingHotpReservation(fresh.reservationId, 0, context),
    ).resolves.toEqual(fresh);
  });

  it("persists pending HOTP lifecycle metadata only inside authenticated encrypted generation metadata", async () => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey);
    const context = cryptoContext();
    const pending = {
      reservationId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a99",
      itemId,
      expectedRevision: 1,
      expectedCounter: 7,
      binding: { tabId: 4, frameId: 0, documentId: "document-a" },
      createdAt: 1_000,
      expiresAt: 31_000,
      sessionEpoch: 0,
      state: "pending" as const,
    };

    await repository.savePendingHotpReservation(pending, context);

    await expect(
      new VaultRepository(storage, wrappedKey).lookupPendingHotpReservation(
        pending.reservationId,
        0,
        context,
      ),
    ).resolves.toEqual(pending);
    expect(JSON.stringify(await storage.snapshot())).not.toContain(pending.reservationId);
    expect(JSON.stringify(await storage.snapshot())).not.toContain(pending.binding.documentId);
  });

  it("preserves pending HOTP lifecycle metadata across normal CRUD generations", async () => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey);
    const context = cryptoContext();
    const pending = {
      reservationId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a99",
      itemId,
      expectedRevision: 1,
      expectedCounter: 7,
      binding: { tabId: 4, frameId: 0, documentId: "document-a" },
      createdAt: 1_000,
      expiresAt: 31_000,
      sessionEpoch: 0,
      state: "pending" as const,
    };
    await repository.savePendingHotpReservation(pending, context);
    await repository.create(
      OtpItemSchema.parse({
        ...maximumEscapedItem(),
        id: "018f47a6-7d11-7c2f-8bd9-a1d37f147a25",
        favorite: false,
        archivedAt: undefined,
        deletedAt: undefined,
        counter: 7,
      }),
      context,
    );

    await expect(
      repository.lookupPendingHotpReservation(pending.reservationId, 0, context),
    ).resolves.toEqual(pending);
  });

  it("marks the candidate before activation and accepts only the authenticated activated root", async () => {
    const order: string[] = [];
    const coordinator: VaultRepositoryActivationCoordinator = {
      beforeActivate: () => Promise.resolve(void order.push("before")),
      afterActivate: () => Promise.resolve(void order.push("after")),
      activationFailed: () => Promise.resolve(void order.push("failed")),
    };
    const repository = new VaultRepository(
      new FakeStoragePort(),
      wrappedKey,
      undefined,
      coordinator,
    );

    await repository.create(item(), cryptoContext());

    expect(order).toEqual(["before", "after"]);
  });

  it("reports activation failure after marking the candidate", async () => {
    const order: string[] = [];
    const storage = new FakeStoragePort();
    const coordinator: VaultRepositoryActivationCoordinator = {
      beforeActivate: () => {
        order.push("before");
        storage.failNext("set", new Error("synthetic activation failure"));
        return Promise.resolve();
      },
      afterActivate: () => Promise.resolve(void order.push("after")),
      activationFailed: () => Promise.resolve(void order.push("failed")),
    };
    const repository = new VaultRepository(storage, wrappedKey, undefined, coordinator);

    await expect(repository.create(item(), cryptoContext())).rejects.toMatchObject({
      code: "STORAGE_FAILED",
    });

    expect(order).toEqual(["before", "failed"]);
  });

  it("re-encrypts and preserves every authenticated v3 metadata semantic across mutations and GC", async () => {
    const storage = new FakeStoragePort();
    const crypto = cryptoContext();
    const generationsStore = new GenerationStore(storage);
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
    const staged = await generationsStore.stage({
      expectedRoot: null,
      wrappedKey,
      records: [],
      journal: [],
      metadata,
      context: crypto,
    });
    await generationsStore.activate(await generationsStore.verify(staged, crypto), crypto);
    const repository = new VaultRepository(storage, wrappedKey);
    await repository.create(item(), crypto);
    await repository.update(item(), 1, (current) => ({ ...current, issuer: "Updated" }), crypto);
    await repository.tombstone(itemId, 2, crypto);
    const active = await generationsStore.readActive(crypto);
    expect(active?.metadata.map((entry) => entry.generationId)).toEqual([
      active?.root.activeGenerationId,
      active?.root.activeGenerationId,
      active?.root.activeGenerationId,
    ]);
    const semantics = await Promise.all(
      active!.metadata.map((entry) => generationsStore.decryptMetadata(entry, crypto)),
    );
    expect(active!.metadata.map((entry, index) => [entry.name, semantics[index]])).toEqual(
      metadata
        .map((entry) => [entry.name, entry.plaintext] as const)
        .sort(([left], [right]) => left.localeCompare(right)),
    );
    await repository.collectGarbage(crypto);
    const snapshot = await storage.snapshot();
    expect(
      Object.keys(snapshot).some((key) =>
        key.startsWith(generationKeys(staged.generationId).prefix),
      ),
    ).toBe(false);
  });

  it("encrypts CRUD records, enforces exact revisions, and journals immutable changes", async () => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey);
    const crypto = cryptoContext();

    const created = await repository.create(item(), crypto);
    expect(created.revision).toBe(1);
    expect(await repository.get(itemId, crypto)).toEqual(created);
    const firstSnapshot = await repository.listItems(crypto);
    const secondSnapshot = await repository.listItems(crypto);
    expect(firstSnapshot).toEqual([created]);
    expect(firstSnapshot).not.toBe(secondSnapshot);
    expect(firstSnapshot[0]).not.toBe(secondSnapshot[0]);
    expect(await repository.listMetadata(crypto)).toEqual([
      {
        id: itemId,
        kind: "otp",
        schemaVersion: 1,
        revision: 1,
        createdAt: timestamps[0],
        updatedAt: timestamps[0],
        favorite: false,
        tags: ["work"],
      },
    ]);

    const raw = await storage.snapshot();
    expect(JSON.stringify(raw)).not.toContain("JBSWY3DPEHPK3PXP");
    expect(JSON.stringify(raw)).not.toContain("private");

    await expect(repository.create(item(), crypto)).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
    });

    const updated = await repository.update(
      item(1),
      1,
      (current) => ({ ...current, issuer: "Updated" }),
      crypto,
    );
    expect(updated.revision).toBe(2);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).not.toBe(created.updatedAt);

    await expect(repository.update(updated, 1, (current) => current, crypto)).rejects.toMatchObject(
      { code: "REVISION_CONFLICT" },
    );

    const tombstone = await repository.tombstone(itemId, 2, crypto);
    expect(tombstone.revision).toBe(3);
    expect(await repository.get(itemId, crypto)).toBeNull();

    const changes = await repository.changes.listAfter(0, 10, crypto);
    expect(changes.map((entry) => [entry.sequence, entry.operation, entry.revision])).toEqual([
      [1, "create", 1],
      [2, "update", 2],
      [3, "delete", 3],
    ]);
    expect(JSON.stringify(await storage.snapshot())).not.toContain('"operation":"delete"');
  });

  it("preserves four-digit fractional UTC timestamps after encrypted repository restart", async () => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey);
    const base = cryptoContext();
    const precise = "2026-07-29T10:20:30.0000Z";
    const crypto: VaultCryptoContext = { ...base, clock: { now: () => precise } };
    const candidate = { ...item(), createdAt: precise, updatedAt: precise };

    await expect(repository.create(candidate, crypto)).resolves.toMatchObject({
      createdAt: precise,
    });
    await expect(
      new VaultRepository(storage, wrappedKey).get(itemId, crypto),
    ).resolves.toMatchObject({
      createdAt: precise,
    });
  });

  it("stores and reads the maximum adversarial schema-valid OTP item", async () => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey);
    const crypto = cryptoContext();
    const maximum = maximumEscapedItem();

    const expected = { ...maximum, deletedAt: undefined };
    await expect(repository.create(maximum, crypto)).resolves.toEqual(expected);
    await expect(new VaultRepository(storage, wrappedKey).get(itemId, crypto)).resolves.toEqual(
      expected,
    );
  });

  it("maps invalid repository candidates to a stable validation error", async () => {
    const invalid = { ...item(), note: "text\ud800" };
    await expect(
      new VaultRepository(new FakeStoragePort(), wrappedKey).create(invalid, cryptoContext()),
    ).rejects.toMatchObject({ code: "VAULT_INVALID", message: "VAULT_INVALID" });
  });

  it("rejects tampered ciphertext, AAD, and manifests with stable safe errors", async () => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey);
    const crypto = cryptoContext();
    await repository.create(item(), crypto);

    const root = (await storage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY] as {
      activeGenerationId: string;
    };
    const recordKey = generationKeys(root.activeGenerationId).record(itemId);
    const stored = (await storage.get([recordKey]))[recordKey] as Record<string, unknown>;
    await storage.set({ [recordKey]: { ...stored, revision: 2 } });

    await expect(repository.get(itemId, crypto)).rejects.toMatchObject({ code: "STORAGE_CORRUPT" });
  });

  it.each([
    ["replacement record", [1, 40, 41, 42]],
    ["new journal", [40, 1, 41, 42]],
    ["manifest authentication", [40, 41, 1, 42]],
    ["verified marker", [40, 41, 42, 1]],
  ] as const)(
    "rejects a %s nonce that collides with a retained active envelope",
    async (_name, nonces) => {
      const storage = new FakeStoragePort();
      const initialContext = cryptoContext();
      await new VaultRepository(storage, wrappedKey).create(item(), initialContext);

      await expect(
        new VaultRepository(storage, wrappedKey).update(
          item(),
          1,
          (current) => ({ ...current, issuer: "Collision" }),
          collisionContext(generations[1]!, nonces),
        ),
      ).rejects.toMatchObject({ code: "DUPLICATE_NONCE" });
      expect(
        (await new VaultRepository(storage, wrappedKey).get(itemId, initialContext))?.revision,
      ).toBe(1);
    },
  );

  it("allows copied unchanged envelopes while rejecting a nonce retained only by the previous generation", async () => {
    const storage = new FakeStoragePort();
    const initialContext = cryptoContext();
    const repository = new VaultRepository(storage, wrappedKey);
    await repository.create(item(), initialContext);
    await repository.update(
      item(),
      1,
      (current) => ({ ...current, issuer: "Second" }),
      initialContext,
    );

    await expect(
      new VaultRepository(storage, wrappedKey).update(
        item(2),
        2,
        (current) => ({ ...current, issuer: "Third" }),
        collisionContext(generations[2]!, [1, 50, 51, 52]),
      ),
    ).rejects.toMatchObject({ code: "DUPLICATE_NONCE" });
  });

  it("rejects a delete journal nonce that collides with the removed record", async () => {
    const storage = new FakeStoragePort();
    const initialContext = cryptoContext();
    await new VaultRepository(storage, wrappedKey).create(item(), initialContext);

    await expect(
      new VaultRepository(storage, wrappedKey).tombstone(
        itemId,
        1,
        collisionContext(generations[1]!, [1, 40, 41]),
      ),
    ).rejects.toMatchObject({ code: "DUPLICATE_NONCE" });
  });

  it("serializes concurrent mutations within one repository instance", async () => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey);
    const crypto = cryptoContext();
    await repository.create(item(), crypto);

    const results = await Promise.allSettled([
      repository.update(item(), 1, (current) => ({ ...current, issuer: "A" }), crypto),
      repository.update(item(), 1, (current) => ({ ...current, issuer: "B" }), crypto),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await repository.get(itemId, crypto))?.revision).toBe(2);
  });

  it("cleans known abandoned keys across pages while preserving malformed and future keys", async () => {
    const storage = new FakeStoragePort({}, { listPageLimit: 2 });
    const repository = new VaultRepository(storage, wrappedKey);
    const crypto = cryptoContext();
    await repository.create(item(), crypto);
    await repository.update(item(), 1, (current) => ({ ...current, issuer: "A" }), crypto);
    const abandonedRecord = generationKeys(generations[2]!).record(itemId);
    const abandonedManifest = generationKeys(generations[3]!).manifest;
    const malformedBefore = `${GENERATION_PREFIX}!malformed`;
    const unknownBetween = `${generationKeys(generations[2]!).prefix}future-format`;
    const malformedAfter = `${GENERATION_PREFIX}zzzz`;
    await storage.set({
      [abandonedRecord]: true,
      [abandonedManifest]: true,
      [malformedBefore]: true,
      [unknownBetween]: true,
      [malformedAfter]: true,
      unrelated: true,
    });

    storage.resetOperationCount();
    storage.failRemoveAt(1, "after", new Error("interrupted after remove"));
    await expect(
      new VaultRepository(storage, wrappedKey).collectGarbage(crypto),
    ).rejects.toMatchObject({ code: "STORAGE_FAILED" });
    storage.clearFailure();
    await new VaultRepository(storage, wrappedKey).collectGarbage(crypto);
    await new VaultRepository(storage, wrappedKey).collectGarbage(crypto);

    const snapshot = await storage.snapshot();
    expect(Object.keys(snapshot).some((key) => key.includes(generations[0]!))).toBe(true);
    expect(Object.keys(snapshot).some((key) => key.includes(generations[1]!))).toBe(true);
    expect(snapshot[abandonedRecord]).toBeUndefined();
    expect(snapshot[abandonedManifest]).toBeUndefined();
    expect(snapshot[malformedBefore]).toBe(true);
    expect(snapshot[unknownBetween]).toBe(true);
    expect(snapshot[malformedAfter]).toBe(true);
    expect(snapshot.unrelated).toBe(true);
  });

  it("imports a candidate batch in one generation with duplicate reclassification", async () => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey);
    const crypto = cryptoContext();
    const first = item();
    await repository.create(first, crypto);
    const rootBefore = (await storage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY] as {
      activeGenerationId: string;
    };

    const result = await repository.importOtpItems(
      [
        {
          issuer: first.issuer,
          label: first.label,
          secret: first.secret,
          otpType: first.otpType,
          algorithm: first.algorithm,
          digits: first.digits,
          period: first.period,
          favorite: first.favorite,
          tags: first.tags,
          note: first.note,
        },
        {
          issuer: "Second",
          label: "account",
          secret: "JBSWY3DPEHPK3PXQ",
          otpType: "totp",
          algorithm: "SHA1",
          digits: 6,
          period: 30,
          favorite: true,
          tags: ["imported"],
          note: "local",
        },
      ],
      ["duplicate", "accepted"],
      crypto,
    );

    expect(result).toMatchObject({ imported: 1, duplicate: 1, previewChanged: false });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      issuer: "Second",
      label: "account",
      revision: 1,
      favorite: true,
      tags: ["imported"],
      note: "local",
    });
    const rootAfter = (await storage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY] as {
      activeGenerationId: string;
    };
    expect(rootAfter.activeGenerationId).not.toBe(rootBefore.activeGenerationId);
    await expect(repository.listItems(crypto)).resolves.toHaveLength(2);
    await expect(repository.changes.listAfter(0, 10, crypto)).resolves.toMatchObject([
      { operation: "create" },
      { operation: "create" },
    ]);
  });

  it("uses accepted rather than submitted count for a mostly-duplicate maximum batch", async () => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey, {
      maxJournalEntries: 4_096,
      maxHotpReceipts: 1_024,
      maxGenerationEntries: 4,
    });
    const crypto = cryptoContext();
    const existing = item();
    await repository.create(existing, crypto);
    const duplicate = {
      issuer: existing.issuer,
      label: existing.label,
      secret: existing.secret,
      otpType: existing.otpType,
      algorithm: existing.algorithm,
      digits: existing.digits,
      period: existing.period,
      favorite: false,
      tags: [],
      note: "",
    };
    const candidates = [
      ...Array.from({ length: 999 }, () => duplicate),
      { ...duplicate, issuer: "New" },
    ];

    await expect(
      repository.importOtpItems(
        candidates,
        [...Array.from({ length: 999 }, () => "duplicate" as const), "accepted"],
        crypto,
      ),
    ).resolves.toMatchObject({ imported: 1, duplicate: 999, previewChanged: false });
    await expect(repository.listItems(crypto)).resolves.toHaveLength(2);
  });

  it("preflights accepted delta and all retained generation entry categories", () => {
    expect(() =>
      preflightOtpImportGenerationCapacity(
        { records: 9_998, journal: 0, receipts: 0, metadata: 0 },
        1,
        4_096,
      ),
    ).not.toThrow();
    expect(() =>
      preflightOtpImportGenerationCapacity(
        { records: 9_999, journal: 0, receipts: 0, metadata: 0 },
        1,
        4_096,
      ),
    ).toThrowError(expect.objectContaining({ code: "STORAGE_CAPACITY_EXCEEDED" }));
    expect(() =>
      preflightOtpImportGenerationCapacity(
        { records: 9_995, journal: 1, receipts: 1, metadata: 1 },
        1,
        4_096,
      ),
    ).not.toThrow();
    expect(() =>
      preflightOtpImportGenerationCapacity(
        { records: 9_996, journal: 1, receipts: 1, metadata: 1 },
        1,
        4_096,
      ),
    ).toThrowError(expect.objectContaining({ code: "STORAGE_CAPACITY_EXCEEDED" }));
    expect(() =>
      preflightOtpImportGenerationCapacity(
        { records: 9_998, journal: 4_096, receipts: 0, metadata: 0 },
        1,
        4_096,
      ),
    ).toThrowError(expect.objectContaining({ code: "STORAGE_CAPACITY_EXCEEDED" }));
  });

  it("classifies before capacity and performs no ID, time, or write when accepted delta is over", async () => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey, {
      maxJournalEntries: 4_096,
      maxHotpReceipts: 1_024,
      maxGenerationEntries: 5,
    });
    const base = cryptoContext();
    let ids = 0;
    let times = 0;
    const crypto: VaultCryptoContext = {
      ...base,
      ids: { next: () => (ids++, base.ids.next()) },
      clock: { now: () => (times++, base.clock.now()) },
    };
    await repository.create(item(), crypto);
    ids = 0;
    times = 0;
    const before = await storage.snapshot();
    const duplicate = {
      issuer: item().issuer,
      label: item().label,
      secret: item().secret,
      otpType: item().otpType,
      algorithm: item().algorithm,
      digits: item().digits,
      period: item().period,
      favorite: false,
      tags: [],
      note: "",
    };
    const fresh = (suffix: string) => ({ ...duplicate, issuer: `Fresh ${suffix}` });

    await expect(
      repository.importOtpItems(
        [...Array.from({ length: 998 }, () => duplicate), fresh("one"), fresh("two")],
        [...Array.from({ length: 998 }, () => "duplicate" as const), "accepted", "accepted"],
        crypto,
      ),
    ).rejects.toMatchObject({ code: "STORAGE_CAPACITY_EXCEEDED" });
    expect(ids).toBe(0);
    expect(times).toBe(0);
    expect(await storage.snapshot()).toEqual(before);
  });

  it("does not activate a generation when every unchanged preview row is duplicate", async () => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey);
    const crypto = cryptoContext();
    const existing = item();
    await repository.create(existing, crypto);
    const before = await storage.snapshot();

    const result = await repository.importOtpItems(
      [
        {
          issuer: existing.issuer,
          label: existing.label,
          secret: existing.secret,
          otpType: existing.otpType,
          algorithm: existing.algorithm,
          digits: existing.digits,
          period: existing.period,
          favorite: false,
          tags: [],
          note: "",
        },
      ],
      ["duplicate"],
      crypto,
    );

    expect(result).toMatchObject({ imported: 0, duplicate: 1, previewChanged: false });
    expect(await storage.snapshot()).toEqual(before);
  });

  it("does not persist when confirm-time duplicate classification changed", async () => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey);
    const crypto = cryptoContext();
    await repository.create(item(), crypto);
    const before = await storage.snapshot();

    const result = await repository.importOtpItems(
      [
        {
          issuer: item().issuer,
          label: item().label,
          secret: item().secret,
          otpType: item().otpType,
          algorithm: item().algorithm,
          digits: item().digits,
          period: item().period,
          favorite: false,
          tags: [],
          note: "",
        },
      ],
      ["accepted"],
      crypto,
    );

    expect(result).toMatchObject({ imported: 0, duplicate: 1, previewChanged: true });
    expect(await storage.snapshot()).toEqual(before);
  });

  it("reads current portable items and only authenticated bounded journal-derived tombstones", async () => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey);
    const context = cryptoContext();
    await repository.create(item(), context);
    await repository.tombstone(itemId, 1, context);

    const snapshot = await repository.readPortableState(context);

    expect(snapshot.items).toEqual([]);
    expect(snapshot.journal).toHaveLength(2);
    expect(snapshot.tombstones).toEqual([{ itemId, revision: 2, deletedAt: timestamps[3] }]);
  });

  it("previews portable settings and logical history without writes, then commits all effects in one generation", async () => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey);
    const context = cryptoContext();
    await repository.create(item(), context);
    const beforePreview = await storage.snapshot();
    const descriptor = {
      settings: { autoLockMinutes: 5 as const, lockOnScreenLock: false },
      history: {
        journal: [
          {
            sequence: 7,
            itemId: generations[3]!,
            kind: "otp" as const,
            schemaVersion: 1 as const,
            revision: 1,
            operation: "delete" as const,
            changedAt: timestamps[1]!,
          },
        ],
        tombstones: [{ itemId: generations[3]!, revision: 1, deletedAt: timestamps[1]! }],
      },
    };

    const preview = await repository.previewPortableImport([], descriptor, context);

    expect(preview).toMatchObject({
      statuses: [],
      settings: "replace",
      history: { journalAdded: 1, tombstonesAdded: 1 },
    });
    expect(await storage.snapshot()).toEqual(beforePreview);

    const writesBefore = storage.writes.length;
    const result = await repository.importPortableState([], descriptor, preview, context);

    expect(result).toMatchObject({ previewChanged: false, imported: 0 });
    expect(
      storage.writes.slice(writesBefore).filter((write) => write.keys.includes(ACTIVE_ROOT_KEY)),
    ).toHaveLength(1);
    await expect(repository.readPortableState(context)).resolves.toMatchObject({
      settings: { autoLockMinutes: 5, lockOnScreenLock: false },
      tombstones: [{ itemId: generations[3]!, revision: 1, deletedAt: timestamps[1]! }],
    });
  });

  it("rejects invalid portable history and deduplicates logical identities without forging sequences", async () => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey, {
      maxJournalEntries: 2,
      maxHotpReceipts: 1_024,
    });
    const context = cryptoContext();
    await repository.create(item(), context);
    const invalid = {
      settings: { autoLockMinutes: 15 as const, lockOnScreenLock: true },
      history: {
        journal: [
          {
            sequence: 2,
            itemId,
            kind: "otp" as const,
            schemaVersion: 1 as const,
            revision: 2,
            operation: "update" as const,
            changedAt: timestamps[1]!,
          },
          {
            sequence: 1,
            itemId,
            kind: "otp" as const,
            schemaVersion: 1 as const,
            revision: 3,
            operation: "delete" as const,
            changedAt: timestamps[2]!,
          },
        ],
        tombstones: [],
      },
    };
    const before = await storage.snapshot();
    await expect(repository.previewPortableImport([], invalid, context)).rejects.toMatchObject({
      code: "VAULT_INVALID",
    });
    expect(await storage.snapshot()).toEqual(before);

    const current = await repository.readPortableState(context);
    const duplicateHistory = {
      settings: { autoLockMinutes: 15 as const, lockOnScreenLock: true },
      history: { journal: current.journal, tombstones: [] },
    };
    const preview = await repository.previewPortableImport([], duplicateHistory, context);
    expect(preview.history).toEqual({ journalAdded: 0, tombstonesAdded: 0 });
  });

  it("leaves the old root fully readable when portable preactivation fails and retries once", async () => {
    const storage = new FakeStoragePort();
    let fail = true;
    const coordinator: VaultRepositoryActivationCoordinator = {
      beforeActivate: () => (fail ? Promise.reject(new Error("preactivation")) : Promise.resolve()),
      afterActivate: () => Promise.resolve(),
      activationFailed: () => Promise.resolve(),
    };
    const repository = new VaultRepository(storage, wrappedKey, undefined, coordinator);
    const context = cryptoContext();
    fail = false;
    await repository.create(item(), context);
    fail = true;
    const oldRoot = (await storage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY];
    const descriptor = {
      settings: { autoLockMinutes: 5 as const, lockOnScreenLock: false },
      history: { journal: [], tombstones: [] },
    };
    const preview = await repository.previewPortableImport([], descriptor, context);
    await expect(repository.importPortableState([], descriptor, preview, context)).rejects.toThrow(
      "preactivation",
    );
    expect((await storage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY]).toEqual(oldRoot);
    expect((await repository.readPortableState(context)).settings).toBeNull();

    fail = false;
    await expect(
      repository.importPortableState([], descriptor, preview, context),
    ).resolves.toMatchObject({ previewChanged: false });
    expect((await repository.readPortableState(context)).settings).toEqual(descriptor.settings);
  });

  it.each([
    ["stage", (write: { keys: readonly string[] }) => !write.keys.includes(ACTIVE_ROOT_KEY)],
    [
      "verify",
      (write: { keys: readonly string[] }) => write.keys.some((key) => key.endsWith(":verified")),
    ],
  ] as const)(
    "keeps the authenticated old root complete across a %s interruption and retries without duplicates",
    async (_phase, interruptedWrite) => {
      async function prepared() {
        const storage = new FakeStoragePort();
        const repository = new VaultRepository(storage, wrappedKey);
        const context = cryptoContext();
        await repository.create(item(), context);
        const descriptor = portableDescriptor();
        const candidate = portableCandidate();
        const preview = await repository.previewPortableImport([candidate], descriptor, context);
        return { storage, repository, context, descriptor, candidate, preview };
      }

      const probe = await prepared();
      const probeStart = probe.storage.writes.length;
      await probe.repository.importPortableState(
        [probe.candidate],
        probe.descriptor,
        probe.preview,
        probe.context,
      );
      const importWrites = probe.storage.writes.slice(probeStart);
      const writeIndex = importWrites.findIndex(interruptedWrite);
      expect(writeIndex).toBeGreaterThanOrEqual(0);

      const values = await prepared();
      const oldRoot = (await values.storage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY];
      values.storage.resetOperationCount();
      values.storage.failWriteAt(writeIndex + 1, "before", new Error("injected interruption"));

      await expect(
        values.repository.importPortableState(
          [values.candidate],
          values.descriptor,
          values.preview,
          values.context,
        ),
      ).rejects.toMatchObject({ code: "STORAGE_FAILED" });
      expect((await values.storage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY]).toEqual(oldRoot);
      await expect(values.repository.readPortableState(values.context)).resolves.toMatchObject({
        items: [{ id: itemId }],
        settings: null,
        journal: [{ itemId, operation: "create" }],
        tombstones: [],
      });

      await expect(
        values.repository.importPortableState(
          [values.candidate],
          values.descriptor,
          values.preview,
          values.context,
        ),
      ).resolves.toMatchObject({ previewChanged: false, imported: 1 });
      const state = await values.repository.readPortableState(values.context);
      expect(state.items).toHaveLength(2);
      expect(state.settings).toEqual(values.descriptor.settings);
      expect(state.tombstones).toEqual(values.descriptor.history.tombstones);
      expect(state.journal).toHaveLength(3);
      expect(
        new Set(
          state.journal.map((entry) =>
            canonicalJson({
              itemId: entry.itemId,
              revision: entry.revision,
              operation: entry.operation,
              changedAt: entry.changedAt,
              mutationId: entry.mutationId ?? null,
            }),
          ),
        ).size,
      ).toBe(state.journal.length);
    },
  );

  it("reclassifies portable backup rows inside the serialized mutation and never regresses HOTP", async () => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey);
    const context = cryptoContext();
    await repository.create(hotpItem(9), context);
    const incoming = { ...hotpItem(4), revision: 8, updatedAt: timestamps[1]! };

    const preview = await repository.previewPortableOtpItems([incoming], context);
    expect(preview.statuses).toEqual(["duplicate"]);
    const result = await repository.importPortableOtpItems([incoming], ["accepted"], context);

    expect(result).toMatchObject({ previewChanged: true, imported: 0, duplicate: 1, conflict: 0 });
    await expect(repository.get(itemId, context)).resolves.toMatchObject({ counter: 9 });
  });

  it("merges a higher HOTP counter by stable id in exactly one activated generation", async () => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey);
    const context = cryptoContext();
    await repository.create(hotpItem(4), context);
    const beforeRoot = (await storage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY];
    const incoming = { ...hotpItem(9), revision: 8, updatedAt: timestamps[1]! };
    const preview = await repository.previewPortableOtpItems([incoming], context);
    const writesBefore = storage.writes.length;

    const result = await repository.importPortableOtpItems(
      incoming ? [incoming] : [],
      preview.statuses,
      context,
    );

    expect(result).toMatchObject({ previewChanged: false, imported: 1, duplicate: 0, conflict: 0 });
    await expect(repository.get(itemId, context)).resolves.toMatchObject({ counter: 9 });
    expect((await storage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY]).not.toEqual(beforeRoot);
    expect(
      storage.writes.slice(writesBefore).filter((write) => write.keys.includes(ACTIVE_ROOT_KEY)),
    ).toHaveLength(1);
  });

  it("checks portable import capacity before staging and leaves the active generation unchanged", async () => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey, {
      maxJournalEntries: 4_096,
      maxHotpReceipts: 1_024,
      maxGenerationEntries: 3,
    });
    const context = cryptoContext();
    await repository.create(item(), context);
    const before = await storage.snapshot();
    const candidate = { ...item(), id: generations[3]!, label: "other" };

    await expect(
      repository.importPortableOtpItems([candidate], ["accepted"], context),
    ).rejects.toMatchObject({ code: "STORAGE_CAPACITY_EXCEEDED" });
    expect(await storage.snapshot()).toEqual(before);
  });

  it("fails safely when a list provider repeats its cursor", async () => {
    const storage = new FakeStoragePort({}, { listPageLimit: 1, repeatListCursor: true });
    const repository = new VaultRepository(storage, wrappedKey);
    const crypto = cryptoContext();
    await repository.create(item(), crypto);
    await storage.set({ [generationKeys(generations[2]!).manifest]: true });
    const before = await storage.snapshot();

    await expect(repository.collectGarbage(crypto)).rejects.toMatchObject({
      code: "STORAGE_FAILED",
    });
    expect(await storage.snapshot()).toEqual(before);
  });

  it("redacts list quota failures without removing abandoned keys", async () => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey);
    const crypto = cryptoContext();
    await repository.create(item(), crypto);
    await storage.set({ [generationKeys(generations[2]!).manifest]: true });
    const before = await storage.snapshot();
    storage.failNext("listKeys", new Error("QUOTA_BYTES raw provider detail"));

    await expect(repository.collectGarbage(crypto)).rejects.toMatchObject({
      code: "STORAGE_FAILED",
      message: "STORAGE_FAILED",
    });
    expect(await storage.snapshot()).toEqual(before);
  });

  it("does not remove any generation when the active generation is corrupt", async () => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey);
    const crypto = cryptoContext();
    await repository.create(item(), crypto);
    const root = (await storage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY] as {
      activeGenerationId: string;
    };
    const recordKey = generationKeys(root.activeGenerationId).record(itemId);
    await storage.set({ [generationKeys(generations[2]!).record(itemId)]: true });
    const record = (await storage.get([recordKey]))[recordKey] as Record<string, unknown>;
    await storage.set({ [recordKey]: { ...record, revision: 2 } });
    const before = await storage.snapshot();

    await expect(
      new VaultRepository(storage, wrappedKey).collectGarbage(crypto),
    ).rejects.toMatchObject({
      code: "STORAGE_CORRUPT",
    });
    expect(await storage.snapshot()).toEqual(before);
  });
});
