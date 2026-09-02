import { createDeterministicRandomSource, encryptEnvelope } from "@shardpass/crypto";
import { describe, expect, it } from "vitest";

import { FakeStoragePort } from "../../testing/src/fake-storage-port";
import {
  ACTIVE_ROOT_KEY,
  GenerationStore,
  StorageError,
  canonicalJson,
  generationKeys,
  type VaultCryptoContext,
  type WrappedVaultKey,
} from "../src";

const generation1 = "018f47a6-7d11-7c2f-8bd9-a1d37f147a21";
const generation2 = "018f47a6-7d11-7c2f-8bd9-a1d37f147a22";
const itemId = "018f47a6-7d11-7c2f-8bd9-a1d37f147a20";
const now = "2026-07-29T10:20:30.000Z";
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

function context(ids = [generation1, generation2]): VaultCryptoContext {
  let idIndex = 0;
  let nonceByte = 1;
  return {
    dek: key,
    random: {
      randomBytes(length) {
        const output = new Uint8Array(length).fill(nonceByte);
        nonceByte += 1;
        return output;
      },
    },
    clock: { now: () => now },
    ids: { next: () => ids[idIndex++] ?? generation2 },
  };
}

async function encryptedRecord() {
  const metadata = {
    format: "shardpass-encrypted-record" as const,
    formatVersion: 1 as const,
    itemId,
    kind: "otp" as const,
    schemaVersion: 1 as const,
    revision: 1,
  };
  const item = {
    id: itemId,
    schemaVersion: 1,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    favorite: false,
    tags: [],
    kind: "otp",
    issuer: "Example",
    label: "user@example.test",
    secret: "JBSWY3DPEHPK3PXP",
    otpType: "totp",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    note: "",
  };
  const envelope = await encryptEnvelope(
    key,
    new TextEncoder().encode(canonicalJson(item)),
    metadata,
    createDeterministicRandomSource(new Uint8Array(24).fill(9)),
  );
  return {
    ...metadata,
    nonce: Buffer.from(envelope.nonce).toString("base64"),
    ciphertext: Buffer.from(envelope.ciphertext).toString("base64"),
    encoding: "base64" as const,
  };
}

describe("GenerationStore", () => {
  it("stages, verifies, then activates one immutable generation", async () => {
    const storage = new FakeStoragePort();
    const store = new GenerationStore(storage);
    const crypto = context();
    const record = await encryptedRecord();

    const staged = await store.stage({
      expectedRoot: null,
      wrappedKey,
      records: [record],
      journal: [],
      context: crypto,
    });

    expect(await storage.get([ACTIVE_ROOT_KEY])).toEqual({});
    expect(storage.writes.at(-1)?.keys).toEqual([generationKeys(generation1).manifest]);
    expect(staged.manifest.root).toEqual(staged.root);

    const verified = await store.verify(staged, crypto);
    expect(storage.writes.at(-1)?.keys).toEqual([generationKeys(generation1).verified]);

    const root = await store.activate(verified, crypto);
    expect(root.activeGenerationId).toBe(generation1);
    expect(storage.writes.at(-1)?.keys).toEqual([ACTIVE_ROOT_KEY]);
    expect(await store.readActive(crypto)).toMatchObject({ root, records: [record], journal: [] });
  });

  it("rejects duplicate nonces within a generation", async () => {
    const storage = new FakeStoragePort();
    const store = new GenerationStore(storage);
    const record = await encryptedRecord();
    const duplicate = { ...record, itemId: generation2 };

    await expect(
      store.stage({
        expectedRoot: null,
        wrappedKey,
        records: [record, duplicate],
        journal: [],
        context: context(),
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_NONCE" });
    expect(await storage.get([ACTIVE_ROOT_KEY])).toEqual({});
  });

  it("fails closed on corrupt root and rolls back only to a verified previous generation", async () => {
    const storage = new FakeStoragePort({ [ACTIVE_ROOT_KEY]: { bad: true } });
    const store = new GenerationStore(storage);
    await expect(store.readActive(context())).rejects.toMatchObject({ code: "STORAGE_CORRUPT" });

    await expect(store.rollback(context())).rejects.toBeInstanceOf(StorageError);
  });

  it("rejects a verified marker whose manifest hash does not match", async () => {
    const storage = new FakeStoragePort();
    const store = new GenerationStore(storage);
    const crypto = context();
    const staged = await store.stage({
      expectedRoot: null,
      wrappedKey,
      records: [await encryptedRecord()],
      journal: [],
      context: crypto,
    });
    const verified = await store.verify(staged, crypto);
    await storage.set({
      [generationKeys(generation1).verified]: {
        format: "shardpass-verified-generation",
        formatVersion: 1,
        generationId: generation1,
        manifestHash: Buffer.alloc(32, 99).toString("base64"),
        verifiedAt: now,
        nonce: Buffer.alloc(24, 8).toString("base64"),
        ciphertext: Buffer.alloc(48, 8).toString("base64"),
        encoding: "base64",
      },
    });
    await expect(store.activate(verified, crypto)).rejects.toMatchObject({
      code: "STORAGE_CORRUPT",
    });
    expect(await storage.get([ACTIVE_ROOT_KEY])).toEqual({});
  });

  it("rejects activation when another owner changed the expected root", async () => {
    const storage = new FakeStoragePort();
    const firstStore = new GenerationStore(storage);
    const secondStore = new GenerationStore(storage);
    const firstContext = context([generation1]);
    const secondContext = context([generation2]);
    const record = await encryptedRecord();
    const first = await firstStore.verify(
      await firstStore.stage({
        expectedRoot: null,
        wrappedKey,
        records: [record],
        journal: [],
        context: firstContext,
      }),
      firstContext,
    );
    const second = await secondStore.verify(
      await secondStore.stage({
        expectedRoot: null,
        wrappedKey,
        records: [record],
        journal: [],
        context: secondContext,
      }),
      secondContext,
    );

    await firstStore.activate(first, firstContext);
    await expect(secondStore.activate(second, secondContext)).rejects.toMatchObject({
      code: "EXTERNAL_ROOT_CHANGED",
    });
  });

  it("rejects authenticated but noncanonical plaintext JSON", async () => {
    const metadata = {
      format: "shardpass-encrypted-record" as const,
      formatVersion: 1 as const,
      itemId,
      kind: "otp" as const,
      schemaVersion: 1 as const,
      revision: 1,
    };
    const canonical = canonicalJson({
      id: itemId,
      schemaVersion: 1,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      favorite: false,
      tags: [],
      kind: "otp",
      issuer: "Example",
      label: "user@example.test",
      secret: "JBSWY3DPEHPK3PXP",
      otpType: "totp",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      note: "",
    });
    const envelope = await encryptEnvelope(
      key,
      new TextEncoder().encode(`${canonical} `),
      metadata,
      createDeterministicRandomSource(new Uint8Array(24).fill(10)),
    );
    const record = {
      ...metadata,
      nonce: Buffer.from(envelope.nonce).toString("base64"),
      ciphertext: Buffer.from(envelope.ciphertext).toString("base64"),
      encoding: "base64" as const,
    };

    await expect(
      new GenerationStore(new FakeStoragePort()).stage({
        expectedRoot: null,
        wrappedKey,
        records: [record],
        journal: [],
        context: context(),
      }),
    ).rejects.toMatchObject({ code: "STORAGE_CORRUPT" });
  });

  it("detects missing and tampered staged data during verification", async () => {
    const storage = new FakeStoragePort();
    const store = new GenerationStore(storage);
    const crypto = context();
    const staged = await store.stage({
      expectedRoot: null,
      wrappedKey,
      records: [await encryptedRecord()],
      journal: [],
      context: crypto,
    });
    await storage.remove([generationKeys(generation1).record(itemId)]);
    await expect(store.verify(staged, crypto)).rejects.toMatchObject({ code: "STORAGE_CORRUPT" });
  });
});
