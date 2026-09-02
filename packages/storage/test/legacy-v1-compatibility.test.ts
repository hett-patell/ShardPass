import { encryptEnvelope } from "@shardpass/crypto/aead";
import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it } from "vitest";

import { FakeStoragePort } from "../../testing/src/fake-storage-port";
import type { StorageValues } from "../src/storage-port";
import {
  ACTIVE_ROOT_KEY,
  VaultRepository,
  canonicalJson,
  generationKeys,
  type VaultCryptoContext,
  type WrappedVaultKey,
} from "../src";

const itemId = "018f47a6-7d11-7c2f-8bd9-a1d37f147a20";
const legacyGeneration = "018f47a6-7d11-7c2f-8bd9-a1d37f147a21";
const upgradedGeneration = "018f47a6-7d11-7c2f-8bd9-a1d37f147a22";
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
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const hash = (value: unknown) => base64(sha256(new TextEncoder().encode(canonicalJson(value))));
const bytes = (value: unknown) => new TextEncoder().encode(canonicalJson(value));
function context(): VaultCryptoContext {
  let nonce = 20;
  return {
    dek: key,
    random: { randomBytes: (length) => new Uint8Array(length).fill(nonce++) },
    clock: { now: () => "2026-07-29T10:21:30.000Z" },
    ids: { next: () => upgradedGeneration },
  };
}

async function legacyV1Storage() {
  const keys = generationKeys(legacyGeneration);
  const item = {
    id: itemId,
    schemaVersion: 1,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    favorite: false,
    tags: [],
    kind: "otp",
    issuer: "Legacy",
    label: "account",
    secret: "MY",
    otpType: "hotp",
    algorithm: "SHA1",
    digits: 6,
    period: 0,
    counter: 0,
    note: "",
  };
  const recordMetadata = {
    format: "shardpass-encrypted-record",
    formatVersion: 1,
    itemId,
    kind: "otp",
    schemaVersion: 1,
    revision: 1,
  } as const;
  const recordEnvelope = await encryptEnvelope(key, bytes(item), recordMetadata, {
    randomBytes: (length) => new Uint8Array(length).fill(1),
  });
  const record = {
    ...recordMetadata,
    nonce: base64(recordEnvelope.nonce),
    ciphertext: base64(recordEnvelope.ciphertext),
    encoding: "base64",
  };
  const root = {
    format: "shardpass-vault",
    formatVersion: 1,
    activeGenerationId: legacyGeneration,
    wrappedKey,
  } as const;
  const unsigned = {
    format: "shardpass-generation-manifest",
    formatVersion: 1,
    root,
    generation: {
      format: "shardpass-vault-generation",
      formatVersion: 1,
      id: legacyGeneration,
      createdAt: now,
      recordCount: 1,
      journalCount: 0,
      entryCount: 1,
      manifestHashAlgorithm: "SHA256",
    },
    recordEntries: [{ key: keys.record(itemId), hash: hash(record) }],
    journalEntries: [],
  } as const;
  const manifestHash = hash(unsigned);
  const manifestAuth = await encryptEnvelope(
    key,
    Buffer.from(manifestHash, "base64"),
    new TextEncoder().encode(`shardpass:manifest:v1:${legacyGeneration}`),
    { randomBytes: (length) => new Uint8Array(length).fill(2) },
  );
  const manifest = {
    ...unsigned,
    manifestHash,
    authentication: {
      algorithm: "xchacha20-poly1305",
      nonce: base64(manifestAuth.nonce),
      ciphertext: base64(manifestAuth.ciphertext),
      encoding: "base64",
    },
  };
  const fullManifestHash = hash(manifest);
  const markerMetadata = {
    format: "shardpass-verified-generation",
    formatVersion: 1,
    generationId: legacyGeneration,
    manifestHash,
    manifestAuthenticationHash: fullManifestHash,
    verifiedAt: now,
    encoding: "base64",
  } as const;
  const markerAad = bytes({ domain: "shardpass:verified-marker:v1:", ...markerMetadata });
  const markerEnvelope = await encryptEnvelope(
    key,
    bytes({ manifestHash, manifestAuthenticationHash: fullManifestHash }),
    markerAad,
    { randomBytes: (length) => new Uint8Array(length).fill(3) },
  );
  const marker = {
    ...markerMetadata,
    nonce: base64(markerEnvelope.nonce),
    ciphertext: base64(markerEnvelope.ciphertext),
  };
  return new FakeStoragePort(
    JSON.parse(
      canonicalJson({
        [ACTIVE_ROOT_KEY]: root,
        [keys.record(itemId)]: record,
        [keys.manifest]: manifest,
        [keys.verified]: marker,
      }),
    ) as StorageValues,
  );
}

describe("legacy Task 4 generation v1 compatibility", () => {
  it("opens v1, upgrades transactionally on mutation, and rolls back to readable v1", async () => {
    const storage = await legacyV1Storage();
    const crypto = context();
    const repository = new VaultRepository(storage, wrappedKey);
    const legacy = await repository.get(itemId, crypto);
    expect(legacy).toMatchObject({ issuer: "Legacy", revision: 1 });

    await repository.update(legacy!, 1, (item) => ({ ...item, issuer: "V2" }), crypto);
    const upgradedRoot = (await storage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY] as {
      formatVersion: number;
      previousGenerationId: string;
    };
    expect(upgradedRoot).toMatchObject({
      formatVersion: 3,
      previousGenerationId: legacyGeneration,
    });
    await expect(repository.get(itemId, crypto)).resolves.toMatchObject({ issuer: "V2" });

    const rollbackRoot = await repository.rollback(crypto);
    expect(rollbackRoot.formatVersion).toBe(1);
    await expect(repository.get(itemId, crypto)).resolves.toMatchObject({ issuer: "Legacy" });
  });
});

describe("legacy item schema migration (Task 12)", () => {
  it("rewrites a legacy schemaVersion:1 record to the current version without changing content or revision", async () => {
    const storage = await legacyV1Storage();
    const crypto = context();
    const repository = new VaultRepository(storage, wrappedKey);

    const before = await repository.get(itemId, crypto);
    expect(before).toMatchObject({ schemaVersion: 2, revision: 1, issuer: "Legacy" });

    const migrated = await repository.migrateLegacyItemSchema(crypto);
    expect(migrated).toBe(1);

    const keys = generationKeys(
      ((await storage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY] as { activeGenerationId: string })
        .activeGenerationId,
    );
    const record = (await storage.get([keys.record(itemId)]))[keys.record(itemId)] as {
      schemaVersion: number;
    };
    expect(record.schemaVersion).toBe(2);

    const after = await repository.get(itemId, crypto);
    expect(after).toMatchObject({ schemaVersion: 2, revision: 1, issuer: "Legacy" });

    const activeGenerationId = ((await storage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY] as {
      activeGenerationId: string;
    }).activeGenerationId;
    const rerun = await repository.migrateLegacyItemSchema(crypto);
    expect(rerun).toBe(0);
    const unchangedGenerationId = ((await storage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY] as {
      activeGenerationId: string;
    }).activeGenerationId;
    expect(unchangedGenerationId).toBe(activeGenerationId);
  });
});
