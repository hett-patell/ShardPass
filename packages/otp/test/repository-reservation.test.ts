import type { OtpItem } from "@shardpass/domain";
import {
  GenerationStore,
  VaultRepository,
  type VaultCryptoContext,
  type WrappedVaultKey,
} from "@shardpass/storage";
import { describe, expect, it } from "vitest";

import { encryptHotpReceipt } from "../../storage/src/hotp-receipt";
import { FakeStoragePort } from "../../testing/src/fake-storage-port";

const itemId = "018f47a6-7d11-7c2f-8bd9-a1d37f147a20";
const reservationId = "018f47a6-7d11-7c2f-8bd9-a1d37f147a99";
const timestamps = [
  "2026-07-29T10:20:30.000Z",
  "2026-07-29T10:21:30.000Z",
  "2026-07-29T10:22:30.000Z",
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
function context(): VaultCryptoContext {
  let generation = 0;
  let timestamp = 0;
  let nonce = 1;
  return {
    dek: new Uint8Array(32).fill(7),
    random: {
      randomBytes: (length) => {
        const value = nonce++;
        return Uint8Array.from({ length }, (_, index) => (value >>> ((index % 6) * 8)) & 0xff);
      },
    },
    clock: { now: () => timestamps[Math.min(timestamp++, timestamps.length - 1)]! },
    ids: {
      next: () => `018f47a6-7d11-7c2f-8bd9-${String(100 + generation++).padStart(12, "0")}`,
    },
  };
}
function item(): OtpItem {
  return {
    id: itemId,
    schemaVersion: 1,
    revision: 1,
    createdAt: timestamps[0]!,
    updatedAt: timestamps[0]!,
    favorite: false,
    tags: [],
    kind: "otp",
    issuer: "RFC",
    label: "counter",
    secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    otpType: "hotp",
    algorithm: "SHA1",
    digits: 6,
    period: 0,
    counter: 0,
    note: "",
  };
}
const request = {
  itemId,
  expectedRevision: 1,
  expectedCounter: 0,
  reservationId,
};

describe("VaultRepository HOTP reservation idempotency", () => {
  it("increments the exact revision/counter and records the opaque mutation id", async () => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey);
    const crypto = context();
    await repository.create(item(), crypto);

    await expect(repository.commitHotpReservation(request, crypto)).resolves.toEqual({
      revision: 2,
      counter: 1,
    });
    await expect(repository.get(itemId, crypto)).resolves.toMatchObject({
      revision: 2,
      counter: 1,
    });
    const changes = await repository.listChangesAfter(0, 10, crypto);
    expect(changes.at(-1)).toMatchObject({ mutationId: reservationId, revision: 2 });
  });

  it("returns the same result after repository restart without another increment", async () => {
    const storage = new FakeStoragePort();
    const crypto = context();
    const repository = new VaultRepository(storage, wrappedKey);
    await repository.create(item(), crypto);
    const first = await repository.commitHotpReservation(request, crypto);
    const writes = storage.writes.length;

    const restarted = new VaultRepository(storage, wrappedKey);
    await expect(restarted.commitHotpReservation(request, crypto)).resolves.toEqual(first);
    expect(storage.writes).toHaveLength(writes);
    await expect(restarted.get(itemId, crypto)).resolves.toMatchObject({ counter: 1 });
  });

  it("replays the fully bound receipt after later edits, increments, restart, and deletion", async () => {
    const storage = new FakeStoragePort();
    const crypto = context();
    const repository = new VaultRepository(storage, wrappedKey);
    await repository.create(item(), crypto);
    const original = await repository.commitHotpReservation(request, crypto);
    const current = (await repository.get(itemId, crypto))!;
    await repository.update(current, 2, (value) => ({ ...value, note: "later edit" }), crypto);
    await repository.commitHotpReservation(
      {
        itemId,
        expectedRevision: 3,
        expectedCounter: 1,
        reservationId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a98",
      },
      crypto,
    );
    await repository.tombstone(itemId, 4, crypto);
    const writes = storage.writes.length;

    const restarted = new VaultRepository(storage, wrappedKey);
    await expect(restarted.commitHotpReservation(request, crypto)).resolves.toEqual(original);
    expect(storage.writes).toHaveLength(writes);
    await expect(restarted.get(itemId, crypto)).resolves.toBeNull();
  });

  it.each([
    { itemId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a29" },
    { expectedRevision: 2 },
    { expectedCounter: 1 },
  ])("rejects reuse of one reservation ID with changed bound fields: %j", async (override) => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey);
    const crypto = context();
    await repository.create(item(), crypto);
    await repository.commitHotpReservation(request, crypto);
    const writes = storage.writes.length;
    await expect(
      repository.commitHotpReservation({ ...request, ...override }, crypto),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(storage.writes).toHaveLength(writes);
  });

  it("never evicts live receipts at capacity and rejects before counter mutation", async () => {
    const storage = new FakeStoragePort();
    const crypto = context();
    const repository = new VaultRepository(storage, wrappedKey, {
      maxJournalEntries: 6,
      maxHotpReceipts: 4,
    });
    await repository.create(item(), crypto);
    let firstRequest = request;
    for (let index = 0; index < 4; index += 1) {
      const current = (await repository.get(itemId, crypto))!;
      const nextRequest = {
        itemId,
        expectedRevision: current.revision,
        expectedCounter: current.counter!,
        reservationId: `018f47a6-7d11-7c2f-8bd9-${String(10_000 + index).padStart(12, "0")}`,
      };
      if (index === 0) firstRequest = nextRequest;
      await repository.commitHotpReservation(nextRequest, crypto);
    }
    const current = (await repository.get(itemId, crypto))!;
    const writes = storage.writes.length;

    await expect(
      repository.commitHotpReservation(
        {
          itemId,
          expectedRevision: current.revision,
          expectedCounter: current.counter!,
          reservationId: "018f47a6-7d11-7c2f-8bd9-a1d37f149999",
        },
        crypto,
      ),
    ).rejects.toMatchObject({ code: "STORAGE_CAPACITY_EXCEEDED" });
    expect(storage.writes).toHaveLength(writes);
    await expect(repository.get(itemId, crypto)).resolves.toMatchObject({
      revision: current.revision,
      counter: current.counter,
    });
    await expect(
      new VaultRepository(storage, wrappedKey).lookupHotpReservationReceipt(firstRequest, crypto),
    ).resolves.toEqual({ revision: 2, counter: 1 });
  }, 60_000);

  it("keeps all 1024 live receipts and rejects the 1025th before activation", async () => {
    const storage = new FakeStoragePort();
    const crypto = context();
    const repository = new VaultRepository(storage, wrappedKey);
    await repository.create(item(), crypto);
    const current = (await repository.get(itemId, crypto))!;
    const generations = new GenerationStore(storage);
    const active = (await generations.readActive(crypto))!;
    const receipts = await Promise.all(
      Array.from({ length: 1024 }, (_, index) =>
        encryptHotpReceipt(
          {
            receiptVersion: 1,
            kind: "hotp-counter-commit",
            reservationId: `018f47a6-7d11-7c2f-8bd9-${String(10_000 + index).padStart(12, "0")}`,
            itemId,
            expectedRevision: index + 1,
            expectedCounter: index,
            binding: { tabId: 1, frameId: 0, documentId: "document" },
            sessionEpoch: 0,
            resultRevision: index + 2,
            resultCounter: index + 1,
            receiptSequence: index + 1,
            committedAt: Date.parse(timestamps[0]!),
            expiresAt: Date.parse(timestamps[0]!) + 300_000,
          },
          crypto.dek,
          crypto.random,
        ),
      ),
    );
    const staged = await generations.stage({
      expectedRoot: active.root,
      wrappedKey,
      records: active.records,
      journal: active.journal,
      receipts,
      context: crypto,
    });
    await generations.activate(await generations.verify(staged, crypto), crypto);
    const writes = storage.writes.length;

    await expect(
      repository.commitHotpReservation(
        {
          itemId,
          expectedRevision: current.revision,
          expectedCounter: current.counter!,
          reservationId: "018f47a6-7d11-7c2f-8bd9-a1d37f149999",
        },
        crypto,
      ),
    ).rejects.toMatchObject({ code: "STORAGE_CAPACITY_EXCEEDED" });
    expect(storage.writes).toHaveLength(writes);
    await expect(repository.get(itemId, crypto)).resolves.toMatchObject({ counter: 0 });
  }, 30_000);

  it("does not replay an expired receipt without requiring unrelated volume", async () => {
    const storage = new FakeStoragePort();
    const crypto = context();
    const repository = new VaultRepository(storage, wrappedKey);
    await repository.create(item(), crypto);
    await repository.commitHotpReservation(request, crypto);
    crypto.clock.now = () => "2026-07-29T10:30:30.000Z";

    await expect(
      new VaultRepository(storage, wrappedKey).lookupHotpReservationReceipt(request, crypto),
    ).resolves.toBeNull();
  });

  it("prunes expired receipts deterministically and permits a new commit", async () => {
    const storage = new FakeStoragePort();
    const crypto = context();
    const repository = new VaultRepository(storage, wrappedKey, {
      maxJournalEntries: 4,
      maxHotpReceipts: 2,
    });
    await repository.create(item(), crypto);
    const committed: (typeof request)[] = [];
    for (let index = 0; index < 2; index += 1) {
      const current = (await repository.get(itemId, crypto))!;
      const nextRequest = {
        itemId,
        expectedRevision: current.revision,
        expectedCounter: current.counter!,
        reservationId: `018f47a6-7d11-7c2f-8bd9-${String(90 + index).padStart(12, "0")}`,
      };
      committed.push(nextRequest);
      await repository.commitHotpReservation(nextRequest, crypto);
    }
    crypto.clock.now = () => "2026-07-29T10:30:30.000Z";
    const current = (await repository.get(itemId, crypto))!;
    await repository.commitHotpReservation(
      {
        itemId,
        expectedRevision: current.revision,
        expectedCounter: current.counter!,
        reservationId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a98",
      },
      crypto,
    );

    await expect(
      repository.lookupHotpReservationReceipt(committed[0]!, crypto),
    ).resolves.toBeNull();
    await expect(repository.get(itemId, crypto)).resolves.toMatchObject({ counter: 3 });
  });

  it("compacts journal and receipts with monotonic cursor metadata", async () => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey, {
      maxJournalEntries: 2,
      maxHotpReceipts: 2,
    });
    const crypto = context();
    await repository.create(item(), crypto);
    for (let index = 0; index < 3; index += 1) {
      if (index === 2) crypto.clock.now = () => "2026-07-29T10:30:30.000Z";
      const current = (await repository.get(itemId, crypto))!;
      await repository.commitHotpReservation(
        {
          itemId,
          expectedRevision: current.revision,
          expectedCounter: current.counter!,
          reservationId: `018f47a6-7d11-7c2f-8bd9-${String(90 + index).padStart(12, "0")}`,
        },
        crypto,
      );
    }
    await expect(repository.listChangesAfter(0, 10, crypto)).rejects.toMatchObject({
      code: "JOURNAL_CURSOR_EXPIRED",
    });
    const latest = await repository.listChangesAfter(2, 10, crypto);
    expect(latest.map((entry) => entry.sequence)).toEqual([3, 4]);
    await expect(repository.lookupHotpReservationReceipt(request, crypto)).resolves.toBeNull();
  });

  it("rejects a stale second reservation without incrementing", async () => {
    const storage = new FakeStoragePort();
    const repository = new VaultRepository(storage, wrappedKey);
    const crypto = context();
    await repository.create(item(), crypto);
    await repository.commitHotpReservation(request, crypto);
    await expect(
      repository.commitHotpReservation(
        { ...request, reservationId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a98" },
        crypto,
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(repository.get(itemId, crypto)).resolves.toMatchObject({ counter: 1 });
  });
});
