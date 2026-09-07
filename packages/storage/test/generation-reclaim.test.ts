import { createDeterministicRandomSource, encryptEnvelope } from "@shardpass/crypto";
import { describe, expect, it, vi } from "vitest";

import { FakeStoragePort } from "../../testing/src/fake-storage-port";
import {
  ACTIVE_ROOT_KEY,
  GENERATION_PREFIX,
  GenerationStore,
  STORAGE_BATCH_KEYS,
  canonicalJson,
  generationKeys,
  type VaultCryptoContext,
  type VaultRoot,
  type WrappedVaultKey,
} from "../src";

const generations = [1, 2, 3, 4, 5, 6].map(
  (index) => `018f47a6-7d11-7c2f-8bd9-a1d37f1470${index.toString().padStart(2, "0")}`,
);
const key = new Uint8Array(32).fill(7);
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

function context(now = "2026-07-29T10:20:30.000Z"): VaultCryptoContext {
  let idIndex = 0;
  let nonce = 0;
  return {
    dek: key,
    random: {
      randomBytes(length) {
        nonce += 1;
        const output = new Uint8Array(length);
        output[0] = nonce & 255;
        output[1] = nonce >> 8;
        output.fill(1, 2);
        return output;
      },
    },
    clock: { now: () => now },
    ids: { next: () => generations[idIndex++]! },
  };
}

async function encryptedRecord(index: number) {
  const itemId = `018f47a6-7d11-7c2f-8bd9-${index.toString(16).padStart(12, "0")}`;
  const metadata = {
    format: "shardpass-encrypted-record" as const,
    formatVersion: 1 as const,
    itemId,
    kind: "otp" as const,
    schemaVersion: 2 as const,
    revision: 1,
  };
  const item = {
    id: itemId,
    schemaVersion: 2,
    revision: 1,
    createdAt: "2026-07-29T10:20:30.000Z",
    updatedAt: "2026-07-29T10:20:30.000Z",
    favorite: false,
    tags: [],
    kind: "otp",
    issuer: "Example",
    label: `user${index}@example.test`,
    secret: "JBSWY3DPEHPK3PXP",
    otpType: "totp",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    note: "",
  };
  const seed = new Uint8Array(24).fill(9);
  seed[0] = index & 255;
  seed[1] = index >> 8;
  const envelope = await encryptEnvelope(
    key,
    new TextEncoder().encode(canonicalJson(item)),
    metadata,
    createDeterministicRandomSource(seed),
  );
  return {
    ...metadata,
    nonce: Buffer.from(envelope.nonce).toString("base64"),
    ciphertext: Buffer.from(envelope.ciphertext).toString("base64"),
    encoding: "base64" as const,
  };
}

async function activateNext(
  store: GenerationStore,
  crypto: VaultCryptoContext,
  expectedRoot: VaultRoot | null,
  recordCount: number,
): Promise<VaultRoot> {
  const records = [];
  for (let index = 0; index < recordCount; index += 1) records.push(await encryptedRecord(index));
  const staged = await store.stage({
    expectedRoot,
    wrappedKey,
    records,
    journal: [],
    context: crypto,
  });
  return store.activate(await store.verify(staged, crypto), crypto);
}

function keysOf(snapshot: Readonly<Record<string, unknown>>, generationId: string): string[] {
  return Object.keys(snapshot).filter((candidate) =>
    candidate.startsWith(generationKeys(generationId).prefix),
  );
}

describe("generation reclamation", () => {
  it("deletes a superseded generation by its manifest without listing storage, manifest last", async () => {
    const storage = new FakeStoragePort();
    const store = new GenerationStore(storage);
    const crypto = context();
    const first = await activateNext(store, crypto, null, 3);
    const second = await activateNext(store, crypto, first, 3);
    expect(keysOf(await storage.snapshot(), generations[0]!)).toHaveLength(3 + 2);

    const listKeys = vi.spyOn(storage, "listKeys");
    const removalsBefore = storage.removals.length;
    await activateNext(store, crypto, second, 3);

    expect(listKeys).not.toHaveBeenCalled();
    const removed = storage.removals.slice(removalsBefore).flatMap((removal) => removal.keys);
    expect(removed).toHaveLength(5);
    expect(removed.at(-1)).toBe(generationKeys(generations[0]!).manifest);
    const snapshot = await storage.snapshot();
    expect(keysOf(snapshot, generations[0]!)).toEqual([]);
    expect(keysOf(snapshot, generations[1]!)).toHaveLength(5);
    expect(keysOf(snapshot, generations[2]!)).toHaveLength(5);
  });

  it("falls back to listing when the superseded manifest is missing or unreadable", async () => {
    for (const damage of ["missing", "unreadable"] as const) {
      const storage = new FakeStoragePort({}, { listPageLimit: 2 });
      const store = new GenerationStore(storage);
      const crypto = context();
      const first = await activateNext(store, crypto, null, 3);
      const second = await activateNext(store, crypto, first, 3);
      const manifestKey = generationKeys(generations[0]!).manifest;
      if (damage === "missing") await storage.remove([manifestKey]);
      else await storage.set({ [manifestKey]: { not: "a manifest" } });

      const listKeys = vi.spyOn(storage, "listKeys");
      await activateNext(store, crypto, second, 3);

      expect(listKeys).toHaveBeenCalled();
      const snapshot = await storage.snapshot();
      expect(keysOf(snapshot, generations[0]!)).toEqual([]);
      expect(keysOf(snapshot, generations[1]!)).toHaveLength(5);
      expect(keysOf(snapshot, generations[2]!)).toHaveLength(5);
      expect((snapshot[ACTIVE_ROOT_KEY] as VaultRoot).activeGenerationId).toBe(generations[2]);
    }
  });

  it("stages records in batches and everything else one key at a time, manifest last", async () => {
    const storage = new FakeStoragePort();
    const store = new GenerationStore(storage);
    const crypto = context();
    const records = [];
    for (let index = 0; index < STORAGE_BATCH_KEYS + 1; index += 1)
      records.push(await encryptedRecord(index));

    const staged = await store.stage({
      expectedRoot: null,
      wrappedKey,
      records,
      journal: [],
      metadata: [
        { name: "lock-settings", schemaVersion: 1, plaintext: new TextEncoder().encode("{}") },
      ],
      context: crypto,
    });

    const keys = generationKeys(generations[0]!);
    expect(storage.writes.map((write) => write.keys.length)).toEqual([STORAGE_BATCH_KEYS, 1, 1, 1]);
    const written = storage.writes.flatMap((write) => write.keys);
    expect(written.slice(0, STORAGE_BATCH_KEYS + 1)).toEqual(
      staged.manifest.recordEntries.map((entry) => entry.key),
    );
    expect(written.slice(STORAGE_BATCH_KEYS + 1)).toEqual([
      keys.metadata("lock-settings"),
      keys.manifest,
    ]);
    const verified = await store.verify(staged, crypto);
    await expect(
      store.readStaged(verified, crypto).then((contents) => contents.records.length),
    ).resolves.toBe(STORAGE_BATCH_KEYS + 1);
  });

  it("leaves no record behind when one record fails authentication before staging writes", async () => {
    const storage = new FakeStoragePort();
    const store = new GenerationStore(storage);
    const good = await encryptedRecord(1);
    const bad = {
      ...(await encryptedRecord(2)),
      ciphertext: Buffer.alloc(64, 5).toString("base64"),
    };

    await expect(
      store.stage({
        expectedRoot: null,
        wrappedKey,
        records: [good, bad],
        journal: [],
        context: context(),
      }),
    ).rejects.toMatchObject({ code: "STORAGE_CORRUPT" });
    expect(storage.writes).toEqual([]);
  });

  describe("collectOrphans", () => {
    async function vaultWithOrphans() {
      const storage = new FakeStoragePort({}, { listPageLimit: 2 });
      const store = new GenerationStore(storage);
      const crypto = context("2026-07-29T10:00:00.000Z");
      const first = await activateNext(store, crypto, null, 1);
      const root = await activateNext(store, crypto, first, 1);
      // A verified generation that never activated, created later than the active one.
      const late = context("2026-07-29T11:00:00.000Z");
      late.ids.next();
      late.ids.next();
      const stagedLate = await store.stage({
        expectedRoot: root,
        wrappedKey,
        records: [await encryptedRecord(1)],
        journal: [],
        context: late,
      });
      await store.verify(stagedLate, late);
      // A partial staging with no manifest at all.
      const partial = generations[3]!;
      await storage.set({
        [generationKeys(partial).record(`018f47a6-7d11-7c2f-8bd9-${"1".padStart(12, "0")}`)]: {
          partial: true,
        },
      });
      // Keys the sweep must never touch: malformed and future-format.
      const untouched = {
        [`${GENERATION_PREFIX}!malformed`]: true,
        [`${generationKeys(generations[4]!).prefix}future-format`]: true,
        unrelated: true,
      };
      await storage.set(untouched);
      return { storage, store, root, orphanVerified: generations[2]!, partial, untouched };
    }

    it("removes only generations outside the active pair, honouring exclusions and age", async () => {
      const { storage, store, root, orphanVerified, partial, untouched } = await vaultWithOrphans();

      // Younger than the cut-off: the verified orphan is kept, the manifest-less partial goes.
      await expect(
        store.collectOrphans(root, { olderThan: "2026-07-29T10:30:00.000Z" }),
      ).resolves.toBe(1);
      let snapshot = await storage.snapshot();
      expect(keysOf(snapshot, partial)).toEqual([]);
      expect(keysOf(snapshot, orphanVerified)).toHaveLength(3);

      // Excluded: still kept even when old enough.
      await expect(
        store.collectOrphans(root, {
          olderThan: "2026-07-29T12:00:00.000Z",
          exclude: new Set([orphanVerified]),
        }),
      ).resolves.toBe(0);
      expect(keysOf(await storage.snapshot(), orphanVerified)).toHaveLength(3);

      // Old enough and not excluded: reclaimed, manifest last.
      const removalsBefore = storage.removals.length;
      await expect(
        store.collectOrphans(root, { olderThan: "2026-07-29T12:00:00.000Z" }),
      ).resolves.toBe(1);
      const removed = storage.removals.slice(removalsBefore).flatMap((removal) => removal.keys);
      expect(removed.at(-1)).toBe(generationKeys(orphanVerified).manifest);
      snapshot = await storage.snapshot();
      expect(keysOf(snapshot, orphanVerified)).toEqual([]);
      expect(keysOf(snapshot, root.activeGenerationId)).toHaveLength(3);
      expect(keysOf(snapshot, root.previousGenerationId!)).toHaveLength(3);
      for (const [candidate, value] of Object.entries(untouched))
        expect(snapshot[candidate]).toBe(value);
      await expect(store.readActive({ dek: key })).resolves.toMatchObject({ root });
    });

    it("is bounded per call and finishes on the next", async () => {
      const { storage, store, root, orphanVerified, partial } = await vaultWithOrphans();

      await expect(store.collectOrphans(root, { limit: 1 })).resolves.toBe(1);
      const afterFirst = await storage.snapshot();
      expect(
        [orphanVerified, partial].filter((id) => keysOf(afterFirst, id).length > 0),
      ).toHaveLength(1);
      await expect(store.collectOrphans(root, { limit: 1 })).resolves.toBe(1);
      await expect(store.collectOrphans(root, { limit: 1 })).resolves.toBe(0);
      const snapshot = await storage.snapshot();
      expect(keysOf(snapshot, orphanVerified)).toEqual([]);
      expect(keysOf(snapshot, partial)).toEqual([]);
      expect(keysOf(snapshot, root.activeGenerationId)).toHaveLength(3);
    });

    it("rejects an unparseable age cut-off", async () => {
      const { store, root } = await vaultWithOrphans();
      await expect(store.collectOrphans(root, { olderThan: "yesterday" })).rejects.toMatchObject({
        code: "STORAGE_FAILED",
      });
    });
  });
});
