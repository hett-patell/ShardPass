import type { OtpItem, VaultItem } from "@shardpass/domain";
import { describe, expect, it } from "vitest";

import { FakeStoragePort } from "../../testing/src/fake-storage-port";
import {
  ACTIVE_ROOT_KEY,
  VaultRepository,
  type VaultCryptoContext,
  type WrappedVaultKey,
} from "../src";

/** Narrows a decrypted vault item (or `null`/`undefined`) to an OTP item for assertions. */
function asOtp(item: VaultItem | null | undefined): OtpItem | undefined {
  return item != null && item.kind === "otp" ? item : undefined;
}

const itemId = "018f47a6-7d11-7c2f-8bd9-a1d37f147a20";
const generationIds = [
  "018f47a6-7d11-7c2f-8bd9-a1d37f147a21",
  "018f47a6-7d11-7c2f-8bd9-a1d37f147a22",
  "018f47a6-7d11-7c2f-8bd9-a1d37f147a23",
  "018f47a6-7d11-7c2f-8bd9-a1d37f147a24",
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

function context(nonceStart = 1): VaultCryptoContext {
  let generation = 0;
  let nonce = nonceStart;
  let tick = 0;
  return {
    dek: new Uint8Array(32).fill(7),
    random: {
      randomBytes(length) {
        const output = new Uint8Array(length).fill(nonce);
        nonce += 1;
        return output;
      },
    },
    clock: { now: () => `2026-07-29T10:2${tick++}:30.000Z` },
    ids: { next: () => generationIds[generation++]! },
  };
}

const binding = { tabId: 1, frameId: 0, documentId: "document-a" };
const reservationId = "018f47a6-7d11-7c2f-8bd9-a1d37f147a99";

function hotpItem() {
  return {
    ...initialItem(),
    otpType: "hotp" as const,
    period: 0,
    counter: 7,
  };
}

function initialItem() {
  return {
    id: itemId,
    schemaVersion: 2 as const,
    revision: 1,
    createdAt: "2026-07-29T10:20:30.000Z",
    updatedAt: "2026-07-29T10:20:30.000Z",
    favorite: false,
    tags: [],
    kind: "otp" as const,
    issuer: "Old",
    label: "user@example.test",
    secret: "JBSWY3DPEHPK3PXP",
    otpType: "totp" as const,
    algorithm: "SHA1" as const,
    digits: 6,
    period: 30,
    note: "",
  };
}

async function preparedHotpCommit() {
  const storage = new FakeStoragePort();
  const repository = new VaultRepository(storage, wrappedKey);
  const crypto = context();
  await repository.create(hotpItem(), crypto);
  await repository.savePendingHotpReservation(
    {
      reservationId,
      itemId,
      expectedRevision: 1,
      expectedCounter: 7,
      binding,
      createdAt: 1_000,
      expiresAt: 31_000,
      sessionEpoch: 0,
      state: "pending",
    },
    crypto,
  );
  return { storage, crypto, before: await storage.snapshot() };
}

async function preparedMutation() {
  const storage = new FakeStoragePort();
  const repository = new VaultRepository(storage, wrappedKey);
  const crypto = context();
  await repository.create(initialItem(), crypto);
  return { storage, repository, crypto, before: await storage.snapshot() };
}

describe("generation interruption safety", () => {
  it("reconciles every atomic HOTP generation write without a second increment", async () => {
    const probe = await preparedHotpCommit();
    probe.storage.resetOperationCount();
    const probeContext = context(50);
    probeContext.ids.next();
    probeContext.ids.next();
    await new VaultRepository(probe.storage, wrappedKey).commitPendingHotpReservation(
      reservationId,
      binding,
      0,
      2_000,
      probeContext,
    );
    const writes = probe.storage.writeCount;

    for (const phase of ["before", "after", "partial"] as const) {
      for (let failAt = 1; failAt <= writes; failAt += 1) {
        const prepared = await preparedHotpCommit();
        const storage = new FakeStoragePort(prepared.before);
        const crypto = context(50);
        crypto.ids.next();
        crypto.ids.next();
        storage.resetOperationCount();
        storage.failWriteAt(failAt, phase, new Error("injected"), 1);
        await expect(
          new VaultRepository(storage, wrappedKey).commitPendingHotpReservation(
            reservationId,
            binding,
            0,
            2_000,
            crypto,
          ),
        ).rejects.toMatchObject({ code: "STORAGE_FAILED" });
        storage.clearFailure();

        const restarted = new VaultRepository(storage, wrappedKey);
        const current = asOtp(await restarted.get(itemId, crypto));
        if (current?.counter === 8) {
          await expect(
            restarted.commitPendingHotpReservation(reservationId, binding, 0, 2_001, crypto),
          ).resolves.toEqual({ revision: 2, counter: 8 });
        } else {
          await expect(
            restarted.commitPendingHotpReservation(reservationId, binding, 0, 2_001, crypto),
          ).resolves.toEqual({ revision: 2, counter: 8 });
        }
        await expect(restarted.get(itemId, crypto)).resolves.toMatchObject({ counter: 8 });
      }
    }
  }, 30_000);

  it("keeps a complete old or new generation when every one-key write throws", async () => {
    const probe = await preparedMutation();
    probe.storage.resetOperationCount();
    await probe.repository.update(
      initialItem(),
      1,
      (current) => ({ ...current, issuer: "New" }),
      probe.crypto,
    );
    expect(probe.storage.writeCount).toBe(6);
    expect(probe.storage.writes.slice(-6).map((write) => write.keys[0]?.split(":").at(-1))).toEqual(
      [itemId, "0000000000000001", "0000000000000002", "manifest", "verified", "root"],
    );

    for (const phase of ["before", "after", "partial"] as const) {
      for (let failAt = 1; failAt <= 6; failAt += 1) {
        const { before } = await preparedMutation();
        const storage = new FakeStoragePort(before);
        const crypto = context(20);
        crypto.ids.next();
        storage.resetOperationCount();
        storage.failWriteAt(failAt, phase, new Error("injected"), 1);

        await expect(
          new VaultRepository(storage, wrappedKey).update(
            initialItem(),
            1,
            (current) => ({ ...current, issuer: "New" }),
            crypto,
          ),
        ).rejects.toMatchObject({ code: "STORAGE_FAILED" });
        storage.clearFailure();

        const restarted = new VaultRepository(storage, wrappedKey);
        const active = asOtp(await restarted.get(itemId, crypto));
        const changes = await restarted.listChangesAfter(0, 10, crypto);
        const root = (await storage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY] as {
          activeGenerationId: string;
        };
        if (failAt === 6 && phase !== "before") {
          expect([
            active?.issuer,
            active?.revision,
            changes.length,
            root.activeGenerationId,
          ]).toEqual(["New", 2, 2, generationIds[1]]);
        } else {
          expect([
            active?.issuer,
            active?.revision,
            changes.length,
            root.activeGenerationId,
          ]).toEqual(["Old", 1, 1, generationIds[0]]);
        }
      }
    }
  });

  it("surfaces quota/set failures without changing the active root", async () => {
    const { storage, repository, crypto } = await preparedMutation();
    const oldRoot = (await storage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY];
    storage.failNext("set", new Error("QUOTA_BYTES quota exceeded"));

    await expect(
      repository.update(initialItem(), 1, (current) => ({ ...current, issuer: "New" }), crypto),
    ).rejects.toMatchObject({ code: "STORAGE_FAILED" });
    storage.clearFailure();
    expect((await storage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY]).toEqual(oldRoot);
  });
});
