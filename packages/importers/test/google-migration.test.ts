import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { IMPORT_LIMITS } from "../src";
import { decodeGoogleMigrationPayloads } from "../src/google-migration-decoder";
import { decodeGoogleMigrationPayloadsObservingCanonicalBytes } from "../src/google-migration-decoder.test-helper";
import { decodeGoogleMigrationUrisForTest as decodeGoogleMigrationUris } from "../src/google-migration-direct.test-helper";

// Literal protobuf vectors produced and cross-checked by an independent offline encoder.
// These tests intentionally do not import the generated schema or protobuf runtime.
const HEX = Object.freeze({
  totpSha1Six:
    "0a2c0a1431323334353637383930313233343536373839301205616c6963651a074578616d706c65200128013002100118012807",
  hotpZeroSha256Eight:
    "0a2e0a1431323334353637383930313233343536373839301207636f756e7465721a074578616d706c65200228023001100118012807",
  totpSha512Eight:
    "0a2c0a143132333435363738393031323334353637383930120565696768741a074578616d706c65200328023002100118012807",
  duplicateItems:
    "0a2c0a1431323334353637383930313233343536373839301205616c6963651a074578616d706c652001280130020a2c0a1431323334353637383930313233343536373839301205616c6963651a074578616d706c65200128013002100118012807",
  unknownAlgorithm:
    "0a2c0a1431323334353637383930313233343536373839301205616c6963651a074578616d706c65206328013002100118012807",
  md5Algorithm:
    "0a2c0a1431323334353637383930313233343536373839301205616c6963651a074578616d706c65200428013002100118012807",
  absentAlgorithm:
    "0a2a0a1431323334353637383930313233343536373839301205616c6963651a074578616d706c6528013002100118012807",
  unknownDigits:
    "0a2c0a1431323334353637383930313233343536373839301205616c6963651a074578616d706c65200128633002100118012807",
  absentDigits:
    "0a2a0a1431323334353637383930313233343536373839301205616c6963651a074578616d706c6520013002100118012807",
  unknownType:
    "0a2c0a1431323334353637383930313233343536373839301205616c6963651a074578616d706c65200128013063100118012807",
  absentType:
    "0a2a0a1431323334353637383930313233343536373839301205616c6963651a074578616d706c6520012801100118012807",
  unsafeCounter:
    "0a350a1431323334353637383930313233343536373839301205616c6963651a074578616d706c65200128013001388080808080808010100118012807",
  duplicatePayloadVersion:
    "0a2c0a1431323334353637383930313233343536373839301205616c6963651a074578616d706c652001280130021001100118012807",
  duplicatePayloadBatchSize:
    "0a2c0a1431323334353637383930313233343536373839301205616c6963651a074578616d706c652001280130021001180118012807",
  duplicatePayloadBatchIndex:
    "0a2c0a1431323334353637383930313233343536373839301205616c6963651a074578616d706c652001280130021001180120002807",
  duplicatePayloadBatchId:
    "0a2c0a1431323334353637383930313233343536373839301205616c6963651a074578616d706c652001280130021001180128072807",
  duplicateItemSecret:
    "0a2f0a1431323334353637383930313233343536373839301205616c6963651a074578616d706c652001280130020a0111100118012807",
  duplicateItemName:
    "0a2f0a1431323334353637383930313233343536373839301205616c6963651a074578616d706c65200128013002120178100118012807",
  duplicateItemIssuer:
    "0a2f0a1431323334353637383930313233343536373839301205616c6963651a074578616d706c652001280130021a0178100118012807",
  duplicateItemAlgorithm:
    "0a2e0a1431323334353637383930313233343536373839301205616c6963651a074578616d706c652001280130022001100118012807",
  duplicateItemDigits:
    "0a2e0a1431323334353637383930313233343536373839301205616c6963651a074578616d706c652001280130022801100118012807",
  duplicateItemType:
    "0a2e0a1431323334353637383930313233343536373839301205616c6963651a074578616d706c652001280130023002100118012807",
  duplicateItemCounter:
    "0a300a1431323334353637383930313233343536373839301205616c6963651a074578616d706c6520012801300238013802100118012807",
  reorderedPayload:
    "1001180128070a2c0a1431323334353637383930313233343536373839301205616c6963651a074578616d706c65200128013002",
  versionTwo:
    "0a2c0a1431323334353637383930313233343536373839301205616c6963651a074578616d706c65200128013002100218012807",
  batchZeroOfTwo:
    "0a2c0a143132333435363738393031323334353637383930120566697273741a074578616d706c6520012801300210011802282a",
  batchOneOfTwo:
    "0a2d0a14313233343536373839303132333435363738393012067365636f6e641a074578616d706c65200128013002100118022001282a",
  batchOneMixedId:
    "0a2d0a14313233343536373839303132333435363738393012067365636f6e641a074578616d706c65200128013002100118022001282b",
  batchSizeSeventeen:
    "0a2c0a1431323334353637383930313233343536373839301205616c6963651a074578616d706c6520012801300210011811282a",
  unknownPayloadField:
    "0a2c0a1431323334353637383930313233343536373839301205616c6963651a074578616d706c65200128013002100118012807980601",
  unknownItemField:
    "0a2f0a1431323334353637383930313233343536373839301205616c6963651a074578616d706c65200128013002980601100118012807",
  emptySecret: "0a160a001205616c6963651a074578616d706c65200128013002100118012807",
  badNameUtf8:
    "0a280a1431323334353637383930313233343536373839301201ff1a074578616d706c65200128013002100118012807",
  longName:
    "0a680a143132333435363738393031323334353637383930124161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161611a074578616d706c65200128013002100118012807",
});

function bytesFromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16));
}

function migrationUri(hex: string, options: { padded?: boolean } = {}): string {
  const standard = Buffer.from(bytesFromHex(hex)).toString("base64");
  const data = options.padded === false ? standard.replace(/=+$/u, "") : standard;
  return `otpauth-migration://offline?data=${encodeURIComponent(data)}`;
}

function expectFixedFailure(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("expected parser failure");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(code);
  }
}

describe("Google Authenticator migration import", () => {
  it("keeps the reviewed generated schema deterministic", async () => {
    const source = await readFile(
      new URL("../src/generated/google-authenticator-migration_pb.ts", import.meta.url),
    );
    expect(createHash("sha256").update(source).digest("hex")).toBe(
      "6cbac5937d67c844d7f734f93010184a83e884e44ee4fbbfd80162781f8281c1",
    );
  });

  it("converts literal TOTP and HOTP vectors without Steam inference", () => {
    const totp = decodeGoogleMigrationUris([migrationUri(HEX.totpSha1Six)]);
    const hotp = decodeGoogleMigrationUris([migrationUri(HEX.hotpZeroSha256Eight)]);
    const sha512 = decodeGoogleMigrationUris([migrationUri(HEX.totpSha512Eight)]);

    expect(totp).toEqual({
      format: "google-migration",
      candidates: [
        {
          sourceOrdinal: 1,
          issuer: "Example",
          label: "alice",
          secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
          otpType: "totp",
          algorithm: "SHA1",
          digits: 6,
          period: 30,
          favorite: false,
          tags: [],
          note: "",
        },
      ],
      rejected: [],
    });
    expect(hotp.candidates[0]).toMatchObject({
      otpType: "hotp",
      algorithm: "SHA256",
      digits: 8,
      period: 0,
      counter: 0,
    });
    expect(sha512.candidates[0]).toMatchObject({
      otpType: "totp",
      algorithm: "SHA512",
      digits: 8,
      period: 30,
    });
    expect(totp.candidates[0]?.otpType).not.toBe("steam");
  });

  it("keeps duplicate rows for later semantic classification", () => {
    const result = decodeGoogleMigrationUris([migrationUri(HEX.duplicateItems)]);
    expect(result.candidates).toHaveLength(2);
    expect(result.rejected).toEqual([]);
  });

  it("returns fixed rejected rows for unsupported or invalid item semantics", () => {
    const unsupported = [
      HEX.unknownAlgorithm,
      HEX.md5Algorithm,
      HEX.unknownDigits,
      HEX.unknownType,
      HEX.absentType,
      HEX.unsafeCounter,
    ];
    // proto3 omits default-valued fields: an absent algorithm or digit count is the
    // protocol's default (SHA1, six digits), not an unsupported value.
    expect(decodeGoogleMigrationUris([migrationUri(HEX.absentAlgorithm)])).toMatchObject({
      candidates: [expect.objectContaining({ algorithm: "SHA1" })],
      rejected: [],
    });
    expect(decodeGoogleMigrationUris([migrationUri(HEX.absentDigits)])).toMatchObject({
      candidates: [expect.objectContaining({ digits: 6 })],
      rejected: [],
    });
    for (const hex of unsupported) {
      expect(decodeGoogleMigrationUris([migrationUri(hex)])).toEqual({
        format: "google-migration",
        candidates: [],
        rejected: [{ ordinal: 1, reason: "IMPORT_UNSUPPORTED" }],
      });
    }
    expectFixedFailure(
      () => decodeGoogleMigrationUris([migrationUri(HEX.emptySecret)]),
      "IMPORT_MALFORMED",
    );
  });

  it("rejects malformed URI shape, alphabet, padding, and noncanonical pad bits", () => {
    const valid = migrationUri(HEX.totpSha1Six);
    for (const uri of [
      "otpauth-migration://online?data=AA%3D%3D",
      "otpauth-migration://offline/path?data=AA%3D%3D",
      "otpauth-migration://offline?data=AA%3D%3D&x=1",
      "otpauth-migration://offline?data=AA%",
      "otpauth-migration://offline?data=A!%3D%3D",
      "otpauth-migration://offline?data=A%3D%3D%3D",
      "otpauth-migration://offline?data=AB%3D%3D",
      `${valid}#fragment`,
      ` ${valid}`,
    ]) {
      expectFixedFailure(() => decodeGoogleMigrationUris([uri]), "IMPORT_MALFORMED");
    }
  });

  it("accepts canonical standard and URL-safe Base64 with optional canonical padding", () => {
    const standard = migrationUri(HEX.totpSha1Six);
    const unpadded = migrationUri(HEX.totpSha1Six, { padded: false });
    const urlSafe = standard.replaceAll("%2B", "-").replaceAll("%2F", "_");
    expect(decodeGoogleMigrationUris([standard]).candidates).toHaveLength(1);
    expect(decodeGoogleMigrationUris([unpadded]).candidates).toHaveLength(1);
    expect(decodeGoogleMigrationUris([urlSafe]).candidates).toHaveLength(1);
  });

  it("prechecks encoded and decoded limits before protobuf decoding", () => {
    const oversizedData = "A".repeat(Math.ceil((IMPORT_LIMITS.maxInputBytes + 1) / 3) * 4);
    expectFixedFailure(
      () => decodeGoogleMigrationUris([`otpauth-migration://offline?data=${oversizedData}`]),
      "IMPORT_LIMIT_EXCEEDED",
    );
  });

  it("rejects malformed, truncated, oversized-length, and varint-bomb protobuf", () => {
    for (const hex of ["0a", "0affffff7f", "80".repeat(12), "0a0180"]) {
      expectFixedFailure(() => decodeGoogleMigrationUris([migrationUri(hex)]), "IMPORT_MALFORMED");
    }
  });

  it("requires version one and rejects unknown preserved protobuf fields", () => {
    expectFixedFailure(
      () => decodeGoogleMigrationUris([migrationUri(HEX.versionTwo)]),
      "IMPORT_UNSUPPORTED",
    );
    for (const hex of [HEX.unknownPayloadField, HEX.unknownItemField]) {
      expectFixedFailure(() => decodeGoogleMigrationUris([migrationUri(hex)]), "IMPORT_MALFORMED");
    }
  });

  it("rejects noncanonical and duplicate singular protobuf fields", () => {
    for (const hex of [
      HEX.duplicatePayloadVersion,
      HEX.duplicatePayloadBatchSize,
      HEX.duplicatePayloadBatchIndex,
      HEX.duplicatePayloadBatchId,
      HEX.duplicateItemSecret,
      HEX.duplicateItemName,
      HEX.duplicateItemIssuer,
      HEX.duplicateItemAlgorithm,
      HEX.duplicateItemDigits,
      HEX.duplicateItemType,
      HEX.duplicateItemCounter,
      HEX.reorderedPayload,
    ]) {
      expectFixedFailure(() => decodeGoogleMigrationUris([migrationUri(hex)]), "IMPORT_MALFORMED");
    }
  });

  it.each([
    ["canonical success", HEX.totpSha1Six, false],
    ["noncanonical mismatch", HEX.reorderedPayload, true],
  ])("clears canonical secret bytes after %s", (_label, hex, rejects) => {
    const canonicalAllocations: Uint8Array[] = [];
    const clearedCanonicalAllocations: Uint8Array[] = [];
    const input = bytesFromHex(hex);
    const decode = () =>
      decodeGoogleMigrationPayloadsObservingCanonicalBytes([input], {
        allocated(bytes) {
          canonicalAllocations.push(bytes);
        },
        cleared(bytes) {
          expect(canonicalAllocations).toContain(bytes);
          expect(bytes.every((value) => value === 0)).toBe(true);
          clearedCanonicalAllocations.push(bytes);
          bytes.fill(0);
        },
      });

    if (rejects) expectFixedFailure(decode, "IMPORT_MALFORMED");
    else expect(decode().candidates).toHaveLength(1);

    expect(canonicalAllocations).toHaveLength(1);
    expect(clearedCanonicalAllocations).toEqual(canonicalAllocations);
    expect(canonicalAllocations[0]?.every((value) => value === 0)).toBe(true);
    expect(input.every((value) => value === 0)).toBe(true);
  });

  it("clears helper-owned canonical bytes when allocation observation throws", () => {
    const allocatedError = new Error("allocated observer failed");
    const canonicalAllocations: Uint8Array[] = [];
    const clearedCanonicalAllocations: Uint8Array[] = [];
    const clearedOwnedBytes: Uint8Array[] = [];
    const input = bytesFromHex(HEX.totpSha1Six);

    expect(() =>
      decodeGoogleMigrationPayloadsObservingCanonicalBytes(
        [input],
        {
          allocated(bytes) {
            canonicalAllocations.push(bytes);
            throw allocatedError;
          },
          cleared(bytes) {
            clearedCanonicalAllocations.push(bytes);
          },
        },
        (bytes) => {
          bytes.fill(0);
          clearedOwnedBytes.push(bytes);
        },
      ),
    ).toThrow(allocatedError);

    expect(canonicalAllocations).toHaveLength(1);
    expect(clearedCanonicalAllocations).toEqual(canonicalAllocations);
    expect(canonicalAllocations[0]?.every((value) => value === 0)).toBe(true);
    expect(clearedOwnedBytes).toContain(input);
    expect(clearedOwnedBytes.some((bytes) => bytes !== input)).toBe(true);
    expect(clearedOwnedBytes.every((bytes) => bytes.every((value) => value === 0))).toBe(true);
  });

  it("preserves the allocation observer error when cleared observation also throws", () => {
    const allocatedError = new Error("allocated observer failed");
    const clearedError = new Error("cleared observer failed");
    const canonicalAllocations: Uint8Array[] = [];
    const clearedCanonicalAllocations: Uint8Array[] = [];
    const input = bytesFromHex(HEX.totpSha1Six);

    expect(() =>
      decodeGoogleMigrationPayloadsObservingCanonicalBytes([input], {
        allocated(bytes) {
          canonicalAllocations.push(bytes);
          throw allocatedError;
        },
        cleared(bytes) {
          clearedCanonicalAllocations.push(bytes);
          throw clearedError;
        },
      }),
    ).toThrow(allocatedError);

    expect(canonicalAllocations).toHaveLength(1);
    expect(clearedCanonicalAllocations).toEqual(canonicalAllocations);
    expect(canonicalAllocations[0]?.every((value) => value === 0)).toBe(true);
    expect(input.every((value) => value === 0)).toBe(true);
  });

  it("clears decoded, cloned, and input secret buffers on every terminal path", () => {
    for (const hex of [
      HEX.totpSha1Six,
      HEX.unknownPayloadField,
      HEX.versionTwo,
      HEX.batchSizeSeventeen,
      HEX.unknownAlgorithm,
    ]) {
      const bytes = bytesFromHex(hex);
      const cleared: Uint8Array[] = [];
      try {
        decodeGoogleMigrationPayloads([bytes], (owned) => {
          owned.fill(0);
          cleared.push(owned);
        });
      } catch {
        // Fixed failure is asserted by behavior tests; this test observes cleanup only.
      }
      expect(bytes.every((value) => value === 0)).toBe(true);
      expect(cleared.length).toBeGreaterThan(0);
      expect(cleared.every((owned) => owned.every((value) => value === 0))).toBe(true);
    }
  });

  it("requires complete consistent batches in unambiguous index order", () => {
    const complete = decodeGoogleMigrationUris([
      migrationUri(HEX.batchZeroOfTwo),
      migrationUri(HEX.batchOneOfTwo),
    ]);
    expect(complete.candidates.map(({ label }) => label)).toEqual(["first", "second"]);

    for (const uris of [
      [migrationUri(HEX.batchZeroOfTwo)],
      [migrationUri(HEX.batchOneOfTwo), migrationUri(HEX.batchZeroOfTwo)],
      [migrationUri(HEX.batchZeroOfTwo), migrationUri(HEX.batchZeroOfTwo)],
      [migrationUri(HEX.batchZeroOfTwo), migrationUri(HEX.batchOneMixedId)],
      [migrationUri(HEX.totpSha1Six), migrationUri(HEX.totpSha1Six)],
    ]) {
      expectFixedFailure(() => decodeGoogleMigrationUris(uris), "IMPORT_MALFORMED");
    }
    expectFixedFailure(
      () => decodeGoogleMigrationUris([migrationUri(HEX.batchSizeSeventeen)]),
      "IMPORT_LIMIT_EXCEEDED",
    );
  });

  it("rejects more than sixteen supplied batches before reading entries", () => {
    const uris = Array.from({ length: IMPORT_LIMITS.maxMigrationBatches + 1 }, () =>
      migrationUri(HEX.totpSha1Six),
    );
    expectFixedFailure(() => decodeGoogleMigrationUris(uris), "IMPORT_LIMIT_EXCEEDED");
  });

  it("rejects 1,001 aggregate entries without truncation", () => {
    const repeatedItem = `0a2c${HEX.totpSha1Six.slice(4, 92)}`;
    const thousand = `${repeatedItem.repeat(IMPORT_LIMITS.maxEntries)}100118012807`;
    const thousandOne = `${repeatedItem.repeat(IMPORT_LIMITS.maxEntries + 1)}100118012807`;
    expect(decodeGoogleMigrationUris([migrationUri(thousand)]).candidates).toHaveLength(1_000);
    expectFixedFailure(
      () => decodeGoogleMigrationUris([migrationUri(thousandOne)]),
      "IMPORT_LIMIT_EXCEEDED",
    );
  });

  it("rejects malformed UTF-8 and over-bound scalar metadata without leaking details", () => {
    expectFixedFailure(
      () => decodeGoogleMigrationUris([migrationUri(HEX.badNameUtf8)]),
      "IMPORT_MALFORMED",
    );
    const long = decodeGoogleMigrationUris([migrationUri(HEX.longName)]);
    expect(long.candidates).toHaveLength(1);
    expect(long.candidates[0]?.label).toHaveLength(65);
  });
});
