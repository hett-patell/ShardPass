import type { OtpItem } from "@shardpass/domain";
import { HotpReservationService } from "@shardpass/otp";
import {
  StorageError,
  VaultRepository,
  type VaultCryptoContext,
  type WrappedVaultKey,
} from "@shardpass/storage";
import { describe, expect, it, vi } from "vitest";

import { FakeStoragePort } from "../../testing/src/fake-storage-port";
import { createRepositoryHotpCommitter } from "../src";

const itemId = "018f47a6-7d11-7c2f-8bd9-a1d37f147a20";
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
  let generation = 1;
  let nonce = 1;
  let tick = 0;
  return {
    dek: new Uint8Array(32).fill(7),
    random: { randomBytes: (length) => new Uint8Array(length).fill(nonce++) },
    clock: { now: () => `2026-07-29T10:${String(tick++).padStart(2, "0")}:30.000Z` },
    ids: {
      next: () => `018f47a6-7d11-7c2f-8bd9-${String(generation++).padStart(12, "0")}`,
    },
  };
}
function item(): OtpItem {
  return {
    id: itemId,
    schemaVersion: 2,
    revision: 1,
    createdAt: "2026-07-29T10:00:30.000Z",
    updatedAt: "2026-07-29T10:00:30.000Z",
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
const binding = { tabId: 1, frameId: 0, documentId: "document" };

async function setup() {
  const storage = new FakeStoragePort();
  const crypto = context();
  const repository = new VaultRepository(storage, wrappedKey);
  const createdItem = await repository.create(item(), crypto);
  if (createdItem.kind !== "otp") throw new Error("expected an OTP item");
  const created = createdItem;
  const committer = createRepositoryHotpCommitter(repository, () => crypto);
  let id = 90;
  const service = new HotpReservationService({
    committer,
    clock: { now: () => 1_000 },
    random: {
      uuid: () => `018f47a6-7d11-7c2f-8bd9-${String(id++).padStart(12, "0")}`,
    },
  });
  return { storage, crypto, repository, created, committer, service };
}

describe("repository HOTP committer", () => {
  it("maps a stale precondition to a definitely-not-committed reservation", async () => {
    const { repository, crypto, service, created } = await setup();
    const reservation = await service.reserveHotp(created, binding);
    await repository.update(created, 1, (current) => ({ ...current, note: "changed" }), crypto);
    await expect(
      service.commitHotpReservation(reservation.reservationId, binding),
    ).rejects.toMatchObject({ code: "OTP_RESERVATION_STALE" });
  });

  it("reconciles an applied-root-then-throw as committed without incrementing twice", async () => {
    const { storage, repository, crypto, service, created } = await setup();
    const reservation = await service.reserveHotp(created, binding);
    storage.failWriteAt(storage.writeCount + 7, "after", new Error("response lost"));
    await expect(
      service.commitHotpReservation(reservation.reservationId, binding),
    ).resolves.toEqual({ revision: 2, counter: 1 });
    await expect(repository.get(itemId, crypto)).resolves.toMatchObject({ counter: 1 });
  });

  it("maps a before-root failure with unchanged item to not-committed and retries same ID", async () => {
    const { storage, repository, crypto, service, created } = await setup();
    const reservation = await service.reserveHotp(created, binding);
    storage.failWriteAt(storage.writeCount + 7, "before", new Error("not activated"));
    await expect(
      service.commitHotpReservation(reservation.reservationId, binding),
    ).rejects.toMatchObject({ code: "OTP_RESERVATION_STALE" });
    await expect(
      service.commitHotpReservation(reservation.reservationId, binding),
    ).resolves.toEqual({ revision: 2, counter: 1 });
    await expect(repository.get(itemId, crypto)).resolves.toMatchObject({ counter: 1 });
  });

  it("maps unreadable reconciliation state to unknown and permits idempotent retry", async () => {
    const { storage, repository, committer, service, created } = await setup();
    const reservation = await service.reserveHotp(created, binding);
    const originalCommit = repository.commitHotpReservation.bind(repository);
    vi.spyOn(repository, "commitHotpReservation").mockImplementation(async (...arguments_) => {
      try {
        return await originalCommit(...arguments_);
      } catch (error) {
        storage.failNext("get", new Error("unreadable"));
        throw error;
      }
    });
    const commit = vi.spyOn(committer, "commit");
    storage.failWriteAt(storage.writeCount + 7, "before", new Error("not activated"));
    await expect(
      service.commitHotpReservation(reservation.reservationId, binding),
    ).rejects.toMatchObject({ code: "OTP_RESERVATION_UNCERTAIN" });
    await expect(
      service.commitHotpReservation(reservation.reservationId, binding),
    ).resolves.toEqual({ revision: 2, counter: 1 });
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it("reconciles through a context-free session bridge without exposing repository crypto", async () => {
    const receipt = { revision: 2, counter: 1 };
    const bridge = {
      commitHotpReservation: vi.fn().mockRejectedValue(new StorageError("STORAGE_FAILED")),
      lookupHotpReservationReceipt: vi.fn().mockResolvedValue(receipt),
      get: vi.fn(),
    };
    const committer = createRepositoryHotpCommitter(bridge);

    await expect(
      committer.commit({
        itemId,
        expectedRevision: 1,
        expectedCounter: 0,
        reservationId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a99",
      }),
    ).resolves.toEqual(receipt);
    expect(Object.keys(bridge).sort()).toEqual([
      "commitHotpReservation",
      "get",
      "lookupHotpReservationReceipt",
    ]);
  });

  it("uses one repository crypto context across commit reconciliation", async () => {
    const repository = {
      commitHotpReservation: vi.fn().mockRejectedValue(new StorageError("STORAGE_FAILED")),
      lookupHotpReservationReceipt: vi.fn().mockResolvedValue({ revision: 2, counter: 1 }),
      get: vi.fn(),
    } as unknown as VaultRepository;
    const contextProvider = vi.fn(() => context());
    const committer = createRepositoryHotpCommitter(repository, contextProvider);

    await expect(
      committer.commit({
        itemId,
        expectedRevision: 1,
        expectedCounter: 0,
        reservationId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a99",
      }),
    ).resolves.toEqual({ revision: 2, counter: 1 });
    expect(contextProvider).toHaveBeenCalledTimes(1);
  });

  it("does not blindly classify an unrelated repository error", async () => {
    const repository = {
      commitHotpReservation: vi.fn().mockRejectedValue(new StorageError("STORAGE_CORRUPT")),
      lookupHotpReservationReceipt: vi.fn().mockRejectedValue(new StorageError("STORAGE_CORRUPT")),
      get: vi.fn().mockRejectedValue(new StorageError("STORAGE_CORRUPT")),
    } as unknown as VaultRepository;
    const committer = createRepositoryHotpCommitter(repository, () => context());
    await expect(
      committer.commit({
        itemId,
        expectedRevision: 1,
        expectedCounter: 0,
        reservationId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a99",
      }),
    ).rejects.toMatchObject({ outcome: "unknown-outcome" });
  });
});
