import type { OtpItem, VaultItem } from "@shardpass/domain";
import { describe, expect, it } from "vitest";

import { FakeStoragePort } from "../../testing/src/fake-storage-port";
import {
  ACTIVE_ROOT_KEY,
  GENERATION_PREFIX,
  MAX_GENERATION_ENTRIES,
  MAX_STORAGE_VALUE_BYTES,
  GenerationStore,
  VaultRepository,
  hotpReceiptHash,
  canonicalJson,
  generationKeys,
  type VaultCryptoContext,
  type WrappedVaultKey,
} from "../src";

/** Narrows a decrypted vault item (or `null`/`undefined`) to an OTP item for assertions. */
function asOtp(item: VaultItem | null | undefined): OtpItem | undefined {
  return item != null && item.kind === "otp" ? item : undefined;
}

/** Reads back the item as an OTP item; every item this suite stores is OTP. */
async function getOtp(
  repository: VaultRepository,
  id: string,
  crypto: VaultCryptoContext,
): Promise<OtpItem> {
  const found = await repository.get(id, crypto);
  if (found === null || found.kind !== "otp") throw new Error("expected an OTP item");
  return found;
}

const itemId = "018f47a6-7d11-7c2f-8bd9-a1d37f147a20";
const generations = [
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
        return new Uint8Array(length).fill(nonce++);
      },
    },
    clock: { now: () => `2026-07-29T11:${String(tick++).padStart(2, "0")}:00.000Z` },
    ids: { next: () => generations[generation++]! },
  };
}

function item() {
  return {
    id: itemId,
    schemaVersion: 2 as const,
    revision: 1,
    createdAt: "2026-07-29T11:00:00.000Z",
    updatedAt: "2026-07-29T11:00:00.000Z",
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

describe("Task 4 round 1 format corrections", () => {
  it("rolls back by activating the exact fully verified previous manifest root", async () => {
    const storage = new FakeStoragePort();
    const crypto = context();
    const repository = new VaultRepository(storage, wrappedKey);
    await repository.create(item(), crypto);
    const oldRoot = (await storage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY];
    await repository.update(item(), 1, (current) => ({ ...current, issuer: "New" }), crypto);

    const rolledBack = await repository.rollback(crypto);
    expect(rolledBack).toEqual(oldRoot);

    const restarted = new VaultRepository(storage, wrappedKey);
    expect(asOtp(await restarted.get(itemId, crypto))?.issuer).toBe("Old");
    expect(
      (await restarted.listChangesAfter(0, 10, crypto)).map((entry) => entry.operation),
    ).toEqual(["create"]);
  });

  it("loads persisted journal entries directly after repository restart", async () => {
    const storage = new FakeStoragePort();
    const crypto = context();
    const repository = new VaultRepository(storage, wrappedKey);
    await repository.create(item(), crypto);
    await repository.update(item(), 1, (current) => ({ ...current, issuer: "New" }), crypto);

    const restarted = new VaultRepository(storage, wrappedKey);
    expect(
      (await restarted.listChangesAfter(0, 10, crypto)).map((entry) => entry.operation),
    ).toEqual(["create", "update"]);
  });

  it("authenticates the complete manifest and marker", async () => {
    const storage = new FakeStoragePort();
    const crypto = context();
    const repository = new VaultRepository(storage, wrappedKey);
    await repository.create(item(), crypto);
    const root = (await storage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY] as {
      activeGenerationId: string;
    };
    const keys = generationKeys(root.activeGenerationId);
    const marker = (await storage.get([keys.verified]))[keys.verified] as Record<string, unknown>;
    expect(marker.nonce).toBeTypeOf("string");
    expect(marker.ciphertext).toBeTypeOf("string");

    const manifest = (await storage.get([keys.manifest]))[keys.manifest] as Record<string, unknown>;
    const generation = manifest.generation as Record<string, unknown>;
    await storage.set({
      [keys.manifest]: {
        ...manifest,
        generation: { ...generation, createdAt: "2026-07-29T12:00:00.000Z" },
      },
    });
    await expect(
      new VaultRepository(storage, wrappedKey).get(itemId, crypto),
    ).rejects.toMatchObject({
      code: "STORAGE_CORRUPT",
    });
  });

  it("rejects a validly shaped marker when any authenticated metadata changes", async () => {
    const storage = new FakeStoragePort();
    const crypto = context();
    await new VaultRepository(storage, wrappedKey).create(item(), crypto);
    const root = (await storage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY] as {
      activeGenerationId: string;
    };
    const markerKey = generationKeys(root.activeGenerationId).verified;
    const marker = (await storage.get([markerKey]))[markerKey] as Record<string, unknown>;
    await storage.set({ [markerKey]: { ...marker, verifiedAt: "2026-07-29T12:00:00.000Z" } });

    await expect(
      new VaultRepository(storage, wrappedKey).get(itemId, crypto),
    ).rejects.toMatchObject({
      code: "STORAGE_CORRUPT",
    });
  });

  it("keeps the maximum manifest below the single-value bound", () => {
    expect(MAX_GENERATION_ENTRIES).toBe(10_000);
    const hash = Buffer.alloc(32).toString("base64");
    const entries = Array.from({ length: MAX_GENERATION_ENTRIES }, (_, index) => ({
      key: `${GENERATION_PREFIX}${generations[0]}:journal:${String(index + 1).padStart(16, "0")}`,
      hash,
    }));
    const estimate = canonicalJson({ recordEntries: [], journalEntries: entries });
    expect(new TextEncoder().encode(estimate).byteLength).toBeLessThan(MAX_STORAGE_VALUE_BYTES);
  });

  it("rejects a combined record and journal generation above the shared capacity", async () => {
    const crypto = context();
    const entries = Array.from({ length: MAX_GENERATION_ENTRIES + 1 }, (_, index) => ({
      format: "shardpass-encrypted-journal" as const,
      formatVersion: 1 as const,
      itemId,
      kind: "otp" as const,
      schemaVersion: 1 as const,
      revision: 1,
      sequence: index + 1,
      nonce: Buffer.alloc(24, (index % 254) + 1).toString("base64"),
      ciphertext: Buffer.alloc(16, 1).toString("base64"),
      encoding: "base64" as const,
    }));

    await expect(
      new GenerationStore(new FakeStoragePort()).stage({
        expectedRoot: null,
        wrappedKey,
        records: [],
        journal: entries,
        context: crypto,
      }),
    ).rejects.toMatchObject({ code: "STORAGE_CAPACITY_EXCEEDED" });
  });

  it("retains receipts by authenticated sequence rather than hash sort order", async () => {
    const storage = new FakeStoragePort();
    const crypto = context();
    const repository = new VaultRepository(storage, wrappedKey, {
      maxJournalEntries: 8,
      maxHotpReceipts: 2,
    });
    await repository.create({ ...item(), otpType: "hotp", period: 0, counter: 0 }, crypto);
    const ids = [
      "018f47a6-7d11-7c2f-8bd9-a1d37f147a91",
      "018f47a6-7d11-7c2f-8bd9-a1d37f147a92",
      "018f47a6-7d11-7c2f-8bd9-a1d37f147a93",
    ];
    const hashes = ids.map(hotpReceiptHash);
    const newest = hashes.indexOf([...hashes].sort()[0]!);
    const orderedIds = [ids[(newest + 1) % 3]!, ids[(newest + 2) % 3]!, ids[newest]!];
    for (const reservationId of orderedIds) {
      const current = await getOtp(repository, itemId, crypto);
      await repository.commitHotpReservation(
        {
          itemId,
          expectedRevision: current.revision,
          expectedCounter: current.counter!,
          reservationId,
        },
        crypto,
      );
    }
    await expect(
      repository.lookupHotpReservationReceipt(
        {
          itemId,
          expectedRevision: 1,
          expectedCounter: 0,
          reservationId: orderedIds[0]!,
        },
        crypto,
      ),
    ).resolves.toBeNull();
    await expect(
      repository.lookupHotpReservationReceipt(
        {
          itemId,
          expectedRevision: 3,
          expectedCounter: 2,
          reservationId: orderedIds[2]!,
        },
        crypto,
      ),
    ).resolves.toEqual({ revision: 4, counter: 3 });
    const root = (await storage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY] as {
      activeGenerationId: string;
    };
    const manifest = (await storage.get([generationKeys(root.activeGenerationId).manifest]))[
      generationKeys(root.activeGenerationId).manifest
    ] as { generation: Record<string, unknown> };
    expect(manifest.generation).toMatchObject({
      receiptStartSequence: 2,
      nextReceiptSequence: 4,
    });
  });

  it("authenticates receipt manifest count, key, hash, and ciphertext", async () => {
    const storage = new FakeStoragePort();
    const crypto = context();
    const repository = new VaultRepository(storage, wrappedKey);
    await repository.create(
      {
        ...item(),
        otpType: "hotp",
        period: 0,
        counter: 0,
      },
      crypto,
    );
    await repository.commitHotpReservation(
      {
        itemId,
        expectedRevision: 1,
        expectedCounter: 0,
        reservationId: "018f47a6-7d11-7c2f-8bd9-a1d37f147a99",
      },
      crypto,
    );
    const root = (await storage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY] as {
      activeGenerationId: string;
    };
    const keys = generationKeys(root.activeGenerationId);
    const manifest = (await storage.get([keys.manifest]))[keys.manifest] as {
      receiptEntries: { key: string; hash: string }[];
    };
    expect(manifest.receiptEntries).toHaveLength(1);
    const receiptKey = manifest.receiptEntries[0]!.key;
    const receipt = (await storage.get([receiptKey]))[receiptKey] as Record<string, unknown>;
    await storage.set({
      [receiptKey]: { ...receipt, ciphertext: Buffer.alloc(32, 9).toString("base64") },
    });
    await expect(
      new VaultRepository(storage, wrappedKey).get(itemId, crypto),
    ).rejects.toMatchObject({
      code: "STORAGE_CORRUPT",
    });
  });

  it("pages generation keys in deterministic exclusive-cursor order", async () => {
    const keys = ["a", "c", "b", "d"].map((suffix) => `${GENERATION_PREFIX}${suffix}`);
    const storage = new FakeStoragePort(Object.fromEntries(keys.map((key) => [key, true])));

    expect(await storage.listKeys(GENERATION_PREFIX, undefined, 2)).toEqual({
      keys: [keys[0], keys[2]],
      nextCursor: keys[2],
      complete: false,
    });
    expect(await storage.listKeys(GENERATION_PREFIX, keys[2], 2)).toEqual({
      keys: [keys[1], keys[3]],
      complete: true,
    });
  });
});
