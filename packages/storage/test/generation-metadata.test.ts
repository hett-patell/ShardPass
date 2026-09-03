import { createDeterministicRandomSource } from "@shardpass/crypto";
import { describe, expect, it } from "vitest";

import { FakeStoragePort } from "../../testing/src/fake-storage-port";
import {
  ACTIVE_ROOT_KEY,
  GENERATION_METADATA_NAMES,
  GenerationStore,
  MAX_GENERATION_METADATA_PLAINTEXT_BYTES,
  canonicalJson,
  generationKeys,
  metadataAssociatedData,
  type StorageValue,
  type VaultCryptoContext,
  type WrappedVaultKey,
} from "../src";

const generation1 = "018f47a6-7d11-7c2f-8bd9-a1d37f147a31";
const generation2 = "018f47a6-7d11-7c2f-8bd9-a1d37f147a32";
const key = new Uint8Array(32).fill(7);
const wrappedKey: WrappedVaultKey = {
  formatVersion: 1,
  kdf: {
    algorithm: "argon2id",
    salt: Buffer.alloc(16, 1).toString("base64"),
    memoryKiB: 8192,
    iterations: 1,
    parallelism: 1,
  },
  wrapping: {
    algorithm: "xchacha20-poly1305",
    nonce: Buffer.alloc(24, 2).toString("base64"),
    ciphertext: Buffer.alloc(48, 3).toString("base64"),
    encoding: "base64",
  },
};
function context(ids = [generation1, generation2]): VaultCryptoContext {
  let id = 0;
  return {
    dek: key,
    random: createDeterministicRandomSource(
      Uint8Array.from({ length: 4096 }, (_, index) => index % 251),
    ),
    clock: { now: () => "2026-08-03T12:00:00.000Z" },
    ids: { next: () => ids[id++]! },
  };
}
const bytes = (value: unknown) => new TextEncoder().encode(canonicalJson(value));

async function stagedMetadata() {
  const storage = new FakeStoragePort();
  const store = new GenerationStore(storage);
  const crypto = context();
  const staged = await store.stage({
    expectedRoot: null,
    wrappedKey,
    records: [],
    journal: [],
    metadata: [
      {
        name: "migration-descriptor",
        schemaVersion: 1,
        plaintext: bytes({ transaction: "synthetic" }),
      },
      {
        name: "lock-settings",
        schemaVersion: 1,
        plaintext: bytes({ autoLockMinutes: 7, lockOnScreenLock: false }),
      },
      {
        name: "ente-otp-state",
        schemaVersion: 1,
        plaintext: bytes({ entityMap: {}, pending: [] }),
      },
    ],
    context: crypto,
  });
  return { storage, store, crypto, staged };
}

describe("authenticated generation v3 metadata", () => {
  it("has an independent canonical AAD vector containing every envelope identity field", () => {
    const aad = metadataAssociatedData({
      format: "shardpass-encrypted-generation-metadata",
      formatVersion: 3,
      generationId: generation1,
      name: "lock-settings",
      schemaVersion: 1,
    });
    expect(new TextDecoder().decode(aad)).toBe(
      '{"domain":"shardpass:generation-metadata:v3","format":"shardpass-encrypted-generation-metadata","formatVersion":3,"generationId":"018f47a6-7d11-7c2f-8bd9-a1d37f147a31","name":"lock-settings","schemaVersion":1}',
    );
  });

  it("defines the four authenticated semantic metadata names and canonical entry count", async () => {
    expect(GENERATION_METADATA_NAMES).toEqual([
      "migration-descriptor",
      "lock-settings",
      "ente-otp-state",
      "hotp-pending-state",
      "folders",
    ]);
    const { storage, store, crypto, staged } = await stagedMetadata();
    expect(staged.manifest.formatVersion).toBe(3);
    expect(staged.manifest.generation).toMatchObject({
      formatVersion: 3,
      metadataCount: 3,
      entryCount: 3,
    });
    if (staged.manifest.formatVersion !== 3) throw new Error("expected v3 manifest");
    expect(staged.manifest.metadataEntries.map((entry) => entry.key)).toEqual(
      [...staged.manifest.metadataEntries.map((entry) => entry.key)].sort(),
    );
    const verified = await store.verify(staged, crypto);
    const contents = await store.readStaged(verified, crypto);
    await expect(store.decryptMetadata(contents.metadata[1]!, crypto)).resolves.toEqual(
      bytes({ autoLockMinutes: 7, lockOnScreenLock: false }),
    );
    expect(JSON.stringify(await storage.snapshot())).not.toContain("autoLockMinutes");
  });

  it("rejects duplicate names, bounded plaintext overflow, and metadata nonce collision", async () => {
    const store = new GenerationStore(new FakeStoragePort());
    const base = { expectedRoot: null, wrappedKey, records: [], journal: [], context: context() };
    await expect(
      store.stage({
        ...base,
        metadata: [
          { name: "lock-settings", schemaVersion: 1, plaintext: bytes({ value: 1 }) },
          { name: "lock-settings", schemaVersion: 1, plaintext: bytes({ value: 2 }) },
        ],
      }),
    ).rejects.toMatchObject({ code: "STORAGE_CORRUPT" });
    await expect(
      store.stage({
        ...base,
        context: context(),
        metadata: [
          {
            name: "lock-settings",
            schemaVersion: 1,
            plaintext: new Uint8Array(MAX_GENERATION_METADATA_PLAINTEXT_BYTES + 1),
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "STORAGE_CAPACITY_EXCEEDED" });

    const repeated = { randomBytes: (length: number) => new Uint8Array(length).fill(9) };
    await expect(
      store.stage({
        ...base,
        context: { ...context(), random: repeated },
        metadata: [
          { name: "lock-settings", schemaVersion: 1, plaintext: bytes({ value: 1 }) },
          { name: "ente-otp-state", schemaVersion: 1, plaintext: bytes({ value: 2 }) },
        ],
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_NONCE" });
  });

  it("fails closed for metadata name, generation, key/hash/count/ciphertext tampering", async () => {
    for (const tamper of [
      "format",
      "format-version",
      "name",
      "generation",
      "key",
      "hash",
      "count",
      "ciphertext",
    ] as const) {
      const { storage, crypto, staged } = await stagedMetadata();
      const keys = generationKeys(generation1);
      const snapshot = structuredClone(await storage.snapshot()) as Record<string, StorageValue>;
      const manifest = structuredClone(snapshot[keys.manifest]) as {
        metadataEntries: { key: string; hash: string }[];
        generation: { metadataCount: number };
      };
      const metadataKey = manifest.metadataEntries[0]!.key;
      const envelope = snapshot[metadataKey] as Record<string, StorageValue>;
      if (tamper === "format") envelope.format = "shardpass-encrypted-record";
      if (tamper === "format-version") envelope.formatVersion = 2;
      if (tamper === "name") envelope.name = "lock-settings";
      if (tamper === "generation") envelope.generationId = generation2;
      if (tamper === "key")
        manifest.metadataEntries[0]!.key = `${keys.prefix}metadata:lock-settings`;
      if (tamper === "hash")
        manifest.metadataEntries[0]!.hash = Buffer.alloc(32, 4).toString("base64");
      if (tamper === "count") manifest.generation.metadataCount = 2;
      if (tamper === "ciphertext") envelope.ciphertext = Buffer.alloc(32, 5).toString("base64");
      snapshot[keys.manifest] = manifest;
      const changed = new FakeStoragePort(snapshot);
      await expect(new GenerationStore(changed).readStaged(staged, crypto)).rejects.toMatchObject({
        code: "STORAGE_CORRUPT",
      });
    }
  });

  it("garbage-collects interrupted metadata writes without changing the active generation", async () => {
    const { storage, store, crypto, staged } = await stagedMetadata();
    await store.activate(await store.verify(staged, crypto), crypto);
    const root = (await storage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY];
    storage.failNext("set", new Error("synthetic interruption"));
    await expect(
      store.stage({
        expectedRoot: staged.root,
        wrappedKey,
        records: [],
        journal: [],
        metadata: [
          {
            name: "lock-settings",
            schemaVersion: 1,
            plaintext: bytes({ autoLockMinutes: 9, lockOnScreenLock: true }),
          },
        ],
        context: crypto,
      }),
    ).rejects.toMatchObject({ code: "STORAGE_FAILED" });
    storage.clearFailure();
    expect((await storage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY]).toEqual(root);
    await store.collect(crypto);
    expect(
      (await storage.snapshot())[generationKeys(generation2).metadata("lock-settings")],
    ).toBeUndefined();
  });
});
