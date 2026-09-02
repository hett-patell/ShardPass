import { AEAD_TAG_BYTES } from "@shardpass/crypto";
import {
  MAX_ITEM_TAGS,
  MAX_ITEM_TAG_LENGTH,
  MAX_ITEM_TIMESTAMP_LENGTH,
  MAX_OTP_ISSUER_LENGTH,
  MAX_OTP_LABEL_LENGTH,
  MAX_OTP_NOTE_LENGTH,
  MAX_OTP_SECRET_LENGTH,
  OtpItemSchema,
  VAULT_ITEM_KINDS,
} from "@shardpass/domain";
import { describe, expect, expectTypeOf, it } from "vitest";

import { FakeStoragePort } from "../../testing/src/fake-storage-port";
import { storageSet } from "../src/storage-port";
import {
  ENCRYPTED_RECORD_ASSOCIATED_DATA_FIELDS,
  MAX_ENCRYPTED_RECORD_BYTES,
  MAX_STORAGE_VALUE_BYTES,
  EncryptedRecordSchema,
  VaultGenerationSchema,
  canonicalJson,
  generationEntryCount,
  VaultRootSchema,
  type EncryptedRecord,
  type VaultGeneration,
  type VaultRoot,
} from "../src";

const activeGenerationId = "018f47a6-7d11-7c2f-8bd9-a1d37f147a22";
const previousGenerationId = "018f47a6-7d11-7c2f-8bd9-a1d37f147a21";
const itemId = "018f47a6-7d11-7c2f-8bd9-a1d37f147a20";
const createdAt = "2026-07-29T10:20:30.000Z";
const base64 = (byte: number, length: number): string =>
  Buffer.alloc(length, byte).toString("base64");

function validRoot(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    format: "shardpass-vault",
    formatVersion: 3,
    activeGenerationId,
    previousGenerationId,
    wrappedKey: {
      formatVersion: 1,
      kdf: {
        algorithm: "argon2id",
        salt: base64(1, 16),
        memoryKiB: 65_536,
        iterations: 3,
        parallelism: 1,
      },
      wrapping: {
        algorithm: "xchacha20-poly1305",
        nonce: base64(2, 24),
        ciphertext: base64(3, 48),
        encoding: "base64",
      },
    },
    ...overrides,
  };
}

function validGeneration(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    format: "shardpass-vault-generation",
    formatVersion: 3,
    id: activeGenerationId,
    createdAt,
    recordCount: 1,
    journalCount: 0,
    receiptCount: 0,
    metadataCount: 0,
    receiptStartSequence: 1,
    nextReceiptSequence: 1,
    journalStartSequence: 1,
    nextJournalSequence: 1,
    entryCount: 1,
    manifestHashAlgorithm: "SHA256",
    ...overrides,
  };
}

function validRecord(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    format: "shardpass-encrypted-record",
    formatVersion: 1,
    itemId,
    kind: "otp",
    schemaVersion: 1,
    revision: 1,
    nonce: base64(5, 24),
    ciphertext: base64(6, 48),
    encoding: "base64",
    ...overrides,
  };
}

describe("vault root", () => {
  it("accepts a versioned active root and bounded wrapped-key descriptor", () => {
    expect(VaultRootSchema.parse(validRoot())).toEqual(validRoot());
  });

  it.each([
    { format: "vault" },
    { formatVersion: 4 },
    { activeGenerationId: "generation-1" },
    { activeGenerationId: previousGenerationId },
    { previousGenerationId: null },
    { wrappedKey: { ...(validRoot().wrappedKey as object), unknown: true } },
    {
      wrappedKey: {
        ...(validRoot().wrappedKey as object),
        kdf: {
          ...((validRoot().wrappedKey as Record<string, unknown>).kdf as object),
          algorithm: "pbkdf2",
        },
      },
    },
    {
      wrappedKey: {
        ...(validRoot().wrappedKey as object),
        kdf: {
          ...((validRoot().wrappedKey as Record<string, unknown>).kdf as object),
          memoryKiB: 0,
        },
      },
    },
    {
      wrappedKey: {
        ...(validRoot().wrappedKey as object),
        kdf: {
          ...((validRoot().wrappedKey as Record<string, unknown>).kdf as object),
          memoryKiB: 1_048_577,
        },
      },
    },
    {
      wrappedKey: {
        ...(validRoot().wrappedKey as object),
        kdf: {
          ...((validRoot().wrappedKey as Record<string, unknown>).kdf as object),
          iterations: 11,
        },
      },
    },
    {
      wrappedKey: {
        ...(validRoot().wrappedKey as object),
        kdf: {
          ...((validRoot().wrappedKey as Record<string, unknown>).kdf as object),
          parallelism: 17,
        },
      },
    },
    {
      wrappedKey: {
        ...(validRoot().wrappedKey as object),
        wrapping: {
          ...((validRoot().wrappedKey as Record<string, unknown>).wrapping as object),
          algorithm: "aes-gcm",
        },
      },
    },
    { unknown: true },
  ])("rejects invalid root metadata and descriptor values: %j", (override) => {
    expect(() => VaultRootSchema.parse(validRoot(override))).toThrow();
  });

  it("enforces canonical Base64 and exact committed salt/nonce lengths", () => {
    const root = validRoot();
    const wrappedKey = root.wrappedKey as Record<string, Record<string, unknown>>;

    for (const salt of ["AQ", "AR==", base64(1, 15), base64(1, 17)]) {
      expect(() =>
        VaultRootSchema.parse({
          ...root,
          wrappedKey: { ...wrappedKey, kdf: { ...wrappedKey.kdf, salt } },
        }),
      ).toThrow();
    }
    for (const nonce of [base64(2, 23), base64(2, 25)]) {
      expect(() =>
        VaultRootSchema.parse({
          ...root,
          wrappedKey: { ...wrappedKey, wrapping: { ...wrappedKey.wrapping, nonce } },
        }),
      ).toThrow();
    }
  });

  it("accepts exact Argon2 descriptor boundaries and rejects unsafe browser combinations", () => {
    const root = validRoot();
    const wrappedKey = root.wrappedKey as Record<string, Record<string, unknown>>;
    const parseKdf = (kdf: Record<string, unknown>) =>
      VaultRootSchema.parse({ ...root, wrappedKey: { ...wrappedKey, kdf } });

    expect(
      parseKdf({ ...wrappedKey.kdf, memoryKiB: 8_192, iterations: 1, parallelism: 1 }),
    ).toBeDefined();
    expect(
      parseKdf({ ...wrappedKey.kdf, memoryKiB: 131_072, iterations: 10, parallelism: 4 }),
    ).toBeDefined();

    expect(() => parseKdf({ ...wrappedKey.kdf, memoryKiB: 8_191 })).toThrow();
    expect(() => parseKdf({ ...wrappedKey.kdf, memoryKiB: 131_073 })).toThrow();
    expect(() => parseKdf({ ...wrappedKey.kdf, parallelism: 5 })).toThrow();
    expect(() => parseKdf({ ...wrappedKey.kdf, memoryKiB: 24, parallelism: 4 })).toThrow();
  });

  it("rejects nonzero Base64 pad bits in one- and two-byte wrapped terminal groups", () => {
    const root = validRoot();
    const wrappedKey = root.wrappedKey as Record<string, Record<string, unknown>>;
    const salt = String(wrappedKey.kdf?.salt);
    const wrappedCiphertext = base64(3, 17);

    expect(() =>
      VaultRootSchema.parse({
        ...root,
        wrappedKey: {
          ...wrappedKey,
          kdf: { ...wrappedKey.kdf, salt: `${salt.slice(0, -3)}R==` },
        },
      }),
    ).toThrow();
    expect(() =>
      VaultRootSchema.parse({
        ...root,
        wrappedKey: {
          ...wrappedKey,
          wrapping: {
            ...wrappedKey.wrapping,
            ciphertext: `${wrappedCiphertext.slice(0, -2)}N=`,
          },
        },
      }),
    ).toThrow();
  });
});

describe("vault generation", () => {
  it("publishes one exact entry capacity model including metadata and retained classes", () => {
    expect(generationEntryCount({ records: 9_995, journal: 1, receipts: 1, metadata: 3 })).toBe(
      10_000,
    );
    expect(() =>
      generationEntryCount({ records: 9_996, journal: 1, receipts: 1, metadata: 3 }),
    ).toThrowError(expect.objectContaining({ code: "STORAGE_CAPACITY_EXCEEDED" }));
    expect(() =>
      generationEntryCount({ records: 10_000, journal: 0, receipts: 0, metadata: 1 }),
    ).toThrowError(expect.objectContaining({ code: "STORAGE_CAPACITY_EXCEEDED" }));
  });

  it("accepts immutable generation metadata with a SHA-256 manifest digest", () => {
    expect(VaultGenerationSchema.parse(validGeneration())).toEqual(validGeneration());
    expect(VaultGenerationSchema.parse(validGeneration({ recordCount: 0 })).recordCount).toBe(0);
  });

  it.each([
    { format: "generation" },
    { formatVersion: 4 },
    { id: "generation-1" },
    { createdAt: "2026-07-29T10:20:30+01:00" },
    { recordCount: -1 },
    { recordCount: 1.5 },
    { recordCount: 10_001 },
    { journalCount: -1 },
    { entryCount: 10_001 },
    { manifestHash: base64(4, 32) },
    { manifestHashAlgorithm: "SHA512" },
    { records: [] },
  ])("rejects invalid or unexpectedly expanded generation metadata: %j", (override) => {
    expect(() => VaultGenerationSchema.parse(validGeneration(override))).toThrow();
  });
});

describe("encrypted record", () => {
  it("accepts only the clear metadata committed to authenticated associated data", () => {
    expect(EncryptedRecordSchema.parse(validRecord())).toEqual(validRecord());
    expect(ENCRYPTED_RECORD_ASSOCIATED_DATA_FIELDS).toEqual([
      "format",
      "formatVersion",
      "itemId",
      "kind",
      "schemaVersion",
      "revision",
    ]);
  });

  it.each(VAULT_ITEM_KINDS.map((kind) => [kind] as const))(
    "accepts every vault item kind: %s",
    (kind) => {
      expect(EncryptedRecordSchema.parse(validRecord({ kind }))).toEqual(validRecord({ kind }));
    },
  );

  it("accepts the current item schema version alongside the legacy OTP-only version", () => {
    expect(EncryptedRecordSchema.parse(validRecord({ schemaVersion: 2 }))).toEqual(
      validRecord({ schemaVersion: 2 }),
    );
  });

  it.each([
    { format: "record" },
    { formatVersion: 2 },
    { itemId: "synthetic-account-default" },
    { kind: "unknown" },
    { schemaVersion: 0 },
    { schemaVersion: 3 },
    { revision: 0 },
    { revision: -1 },
    { revision: 1.5 },
    { revision: Number.MAX_SAFE_INTEGER + 1 },
    { nonce: base64(5, 23) },
    { nonce: base64(5, 25) },
    { ciphertext: "AQ" },
    { ciphertext: base64(6, 16 * 1024 * 1024 + 1) },
    { encoding: "base64url" },
    { issuer: "must remain encrypted" },
    { favorite: true },
  ])("rejects unsupported, malformed, or overexposed record data: %j", (override) => {
    expect(() => EncryptedRecordSchema.parse(validRecord(override))).toThrow();
  });

  it("fits adversarial schema-valid canonical JSON plus AEAD tag under the proven ceiling", () => {
    const worstEscapingText = (length: number, prefix = "") =>
      `${prefix}${"\u0001".repeat(length - prefix.length)}`;
    const maximumTimestamp = `2026-07-29T10:20:30.${"1".repeat(MAX_ITEM_TIMESTAMP_LENGTH - 21)}Z`;
    expect(maximumTimestamp).toHaveLength(MAX_ITEM_TIMESTAMP_LENGTH);
    const maximumItem = OtpItemSchema.parse({
      id: itemId,
      schemaVersion: 2,
      revision: Number.MAX_SAFE_INTEGER,
      createdAt: maximumTimestamp,
      updatedAt: maximumTimestamp,
      favorite: true,
      archivedAt: maximumTimestamp,
      deletedAt: maximumTimestamp,
      tags: Array.from({ length: MAX_ITEM_TAGS }, (_, index) =>
        worstEscapingText(MAX_ITEM_TAG_LENGTH, String(index).padStart(2, "0")),
      ),
      kind: "otp",
      issuer: worstEscapingText(MAX_OTP_ISSUER_LENGTH),
      label: worstEscapingText(MAX_OTP_LABEL_LENGTH),
      secret: "A".repeat(MAX_OTP_SECRET_LENGTH),
      otpType: "hotp",
      algorithm: "SHA512",
      digits: 10,
      period: 0,
      counter: Number.MAX_SAFE_INTEGER,
      note: worstEscapingText(MAX_OTP_NOTE_LENGTH),
    });
    const canonicalBytes = new TextEncoder().encode(canonicalJson(maximumItem)).byteLength;
    expect(canonicalBytes).toBe(130_947);
    expect(canonicalBytes + AEAD_TAG_BYTES).toBe(130_963);
    expect(canonicalBytes + AEAD_TAG_BYTES).toBeLessThanOrEqual(MAX_ENCRYPTED_RECORD_BYTES);
  });

  it("serializes quote, backslash, control, and astral Unicode adversaries canonically", () => {
    const encoded = canonicalJson({ text: '\\"\u0001😀' });
    expect(encoded).toBe(JSON.stringify({ text: '\\"\u0001😀' }));
    expect(new TextEncoder().encode(encoded).byteLength).toBe(25);
  });

  it("fits the maximum decoded ciphertext inside a full serialized storage envelope", async () => {
    expect(MAX_ENCRYPTED_RECORD_BYTES).toBe(256 * 1024);
    const record = EncryptedRecordSchema.parse(
      validRecord({ ciphertext: base64(6, MAX_ENCRYPTED_RECORD_BYTES) }),
    );
    const encodedBytes = new TextEncoder().encode(JSON.stringify(record)).byteLength;
    expect(encodedBytes).toBeLessThan(MAX_STORAGE_VALUE_BYTES);
    await expect(storageSet(new FakeStoragePort(), { record })).resolves.toBeUndefined();
    expect(() =>
      EncryptedRecordSchema.parse(
        validRecord({ ciphertext: base64(6, MAX_ENCRYPTED_RECORD_BYTES + 1) }),
      ),
    ).toThrow();
  });

  it("rejects nonzero Base64 pad bits in record ciphertext terminal groups", () => {
    const oneByteTerminal = base64(6, 16);
    const twoByteTerminal = base64(6, 17);

    expect(() =>
      EncryptedRecordSchema.parse(
        validRecord({ ciphertext: `${oneByteTerminal.slice(0, -3)}h==` }),
      ),
    ).toThrow();
    expect(() =>
      EncryptedRecordSchema.parse(validRecord({ ciphertext: `${twoByteTerminal.slice(0, -2)}Z=` })),
    ).toThrow();
  });

  it("infers every public storage type from its strict runtime schema", () => {
    expectTypeOf(VaultRootSchema.parse(validRoot())).toEqualTypeOf<VaultRoot>();
    expectTypeOf(VaultGenerationSchema.parse(validGeneration())).toEqualTypeOf<VaultGeneration>();
    expectTypeOf(EncryptedRecordSchema.parse(validRecord())).toEqualTypeOf<EncryptedRecord>();
  });
});
