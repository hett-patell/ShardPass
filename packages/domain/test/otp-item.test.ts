import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ItemMetadataSchema,
  OtpItemSchema,
  VaultItemSchema,
  type ItemMetadata,
  type OtpItem,
  type VaultItem,
} from "../src";

const id = "018f47a6-7d11-7c2f-8bd9-a1d37f147a22";
const createdAt = "2026-07-29T10:20:30.000Z";

function validMetadata(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id,
    schemaVersion: 1,
    revision: 1,
    createdAt,
    updatedAt: "2026-07-29T10:21:30Z",
    favorite: false,
    tags: ["personal", "email"],
    ...overrides,
  };
}

function validOtpItem(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    ...validMetadata(),
    kind: "otp",
    issuer: "Synthetic Service",
    label: "fixture@example.invalid",
    secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    otpType: "totp",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    note: "Synthetic fixture mapping",
    ...overrides,
  };
}

describe("item metadata", () => {
  it("accepts immutable UUID metadata with positive revisions and exact UTC timestamps", () => {
    const metadata = ItemMetadataSchema.parse({
      id,
      schemaVersion: 1,
      revision: 1,
      createdAt,
      updatedAt: "2026-07-29T10:21:30Z",
      favorite: true,
      archivedAt: "2026-07-29T10:22:30.123Z",
      deletedAt: "2026-07-29T10:23:30Z",
      tags: ["personal", "email"],
    });

    expect(metadata.id).toBe(id);
    expect(metadata.revision).toBe(1);
  });

  it.each([
    { id: "synthetic-account-default" },
    { id: "018f47a6-7d11-7c2f-8bd9-a1d37f147a2z" },
    { schemaVersion: 0 },
    { schemaVersion: 2 },
    { revision: 0 },
    { revision: -1 },
    { revision: 1.5 },
    { revision: Number.MAX_SAFE_INTEGER + 1 },
    { createdAt: "2026-07-29T10:20:30+01:00" },
    { createdAt: "2026-07-29T10:20:30" },
    { createdAt: "2026-07-29" },
    { updatedAt: "2026-07-29T10:20:30.000z" },
    { tags: ["duplicate", "duplicate"] },
    { tags: ["Case", "case"] },
    { tags: [" padded"] },
    { tags: ["x".repeat(257)] },
    { tags: Array.from({ length: 65 }, (_, index) => `tag-${index}`) },
    { unknown: true },
  ])("rejects invalid or noncanonical metadata: %j", (override) => {
    expect(() => ItemMetadataSchema.parse(validMetadata(override))).toThrow();
  });

  it("accepts prior UTC fractional precision through the 1024-character safety bound", () => {
    const fourDigits = "2026-07-29T10:20:30.0000Z";
    const maximum = `2026-07-29T10:20:30.${"1".repeat(1003)}Z`;
    const tooLong = `2026-07-29T10:20:30.${"1".repeat(1004)}Z`;

    expect(fourDigits).toHaveLength(25);
    expect(maximum).toHaveLength(1024);
    expect(tooLong).toHaveLength(1025);
    expect(ItemMetadataSchema.parse(validMetadata({ updatedAt: fourDigits })).updatedAt).toBe(
      fourDigits,
    );
    expect(ItemMetadataSchema.parse(validMetadata({ updatedAt: maximum })).updatedAt).toBe(maximum);
    expect(() => ItemMetadataSchema.parse(validMetadata({ updatedAt: tooLong }))).toThrow();
  });

  it.each(["\ud800", "\udfff"])("rejects an unpaired surrogate in a tag: %j", (surrogate) => {
    expect(() => ItemMetadataSchema.parse(validMetadata({ tags: [`tag${surrogate}`] }))).toThrow();
  });

  it("accepts an ordinary astral Unicode scalar in a tag", () => {
    expect(ItemMetadataSchema.parse(validMetadata({ tags: ["tag😀"] })).tags).toEqual(["tag😀"]);
  });

  it("infers the shared metadata contract from the runtime schema", () => {
    expectTypeOf<ItemMetadata>().toMatchTypeOf<{
      id: string;
      schemaVersion: 1;
      revision: number;
      createdAt: string;
      updatedAt: string;
      favorite: boolean;
      tags: string[];
    }>();
  });
});

describe("OTP item", () => {
  it("maps every confirmed legacy OTP fixture shape into the strict item schema", () => {
    const mappings = [
      validOtpItem(),
      validOtpItem({ algorithm: "SHA256", digits: 8, period: 45 }),
      validOtpItem({ algorithm: "SHA512" }),
      validOtpItem({ otpType: "hotp", counter: 0, period: 0 }),
      validOtpItem({ otpType: "hotp", counter: 7, period: 0 }),
      validOtpItem({ otpType: "steam", algorithm: "SHA1", digits: 5, period: 30 }),
      validOtpItem({
        issuer: "I".repeat(256),
        label: "L".repeat(256),
        secret: "A".repeat(1024),
        note: "N".repeat(256),
        tags: ["T".repeat(256)],
      }),
    ];

    for (const mapping of mappings) {
      expect(OtpItemSchema.parse(mapping)).toEqual(mapping);
    }
  });

  it.each([
    { kind: "login" },
    { kind: "unknown" },
    { schemaVersion: 2 },
    { issuer: "I".repeat(257) },
    { label: "" },
    { label: "L".repeat(257) },
    { secret: "" },
    { secret: "A".repeat(1025) },
    { secret: "abcd2345" },
    { secret: "ABCD0189" },
    { secret: "ABCD=EFG" },
    { secret: "ABCD-EFG" },
    { secret: "ABCD EFG" },
    { otpType: "counter" },
    { algorithm: "MD5" },
    { digits: 4 },
    { digits: 11 },
    { digits: 6.5 },
    { period: -1 },
    { period: 301 },
    { note: "N".repeat(4097) },
    { secretHint: "not allowed" },
  ])("rejects invalid OTP fields and unknown properties: %j", (override) => {
    expect(() => OtpItemSchema.parse(validOtpItem(override))).toThrow();
  });

  it.each(["issuer", "label", "note"] as const)(
    "rejects unpaired high and low surrogates in %s",
    (field) => {
      expect(() => OtpItemSchema.parse(validOtpItem({ [field]: `text\ud800` }))).toThrow();
      expect(() => OtpItemSchema.parse(validOtpItem({ [field]: `text\udfff` }))).toThrow();
    },
  );

  it.each(["issuer", "label", "note"] as const)("accepts valid surrogate pairs in %s", (field) => {
    expect(OtpItemSchema.parse(validOtpItem({ [field]: "text😀" }))[field]).toBe("text😀");
  });

  it.each([
    ["MY", 2],
    ["MZXQ", 4],
    ["MZXW6", 5],
    ["MZXW6YQ", 7],
    ["MZXW6YTB", 0],
  ])("accepts canonical unpadded Base32 terminal residue %i: %s", (secret, residue) => {
    expect(secret.length % 8).toBe(residue);
    expect(OtpItemSchema.parse(validOtpItem({ secret })).secret).toBe(secret);
  });

  it.each(["A", "AAA", "AAAAAA", "MZ", "MZXR", "MZXW7", "MZXW6YR"])(
    "rejects impossible lengths and nonzero Base32 terminal pad bits: %s",
    (secret) => {
      expect(() => OtpItemSchema.parse(validOtpItem({ secret }))).toThrow();
    },
  );

  it("requires HOTP counter and forbids counter on time-based OTPs", () => {
    expect(() => OtpItemSchema.parse(validOtpItem({ otpType: "hotp", period: 0 }))).toThrow();
    expect(() => OtpItemSchema.parse(validOtpItem({ counter: 0 }))).toThrow();
    expect(() =>
      OtpItemSchema.parse(validOtpItem({ otpType: "steam", digits: 5, counter: 0 })),
    ).toThrow();
    expect(
      OtpItemSchema.parse(validOtpItem({ otpType: "hotp", period: 0, counter: 0 })).counter,
    ).toBe(0);
    expect(() =>
      OtpItemSchema.parse(
        validOtpItem({ otpType: "hotp", period: 0, counter: Number.MAX_SAFE_INTEGER + 1 }),
      ),
    ).toThrow();
  });

  it("enforces type-specific period, digit, and algorithm compatibility", () => {
    expect(() => OtpItemSchema.parse(validOtpItem({ period: 0 }))).toThrow();
    expect(() =>
      OtpItemSchema.parse(validOtpItem({ otpType: "hotp", counter: 0, period: 30 })),
    ).toThrow();
    expect(() =>
      OtpItemSchema.parse(validOtpItem({ otpType: "steam", digits: 6, period: 30 })),
    ).toThrow();
    expect(() =>
      OtpItemSchema.parse(
        validOtpItem({ otpType: "steam", algorithm: "SHA256", digits: 5, period: 30 }),
      ),
    ).toThrow();
    expect(() =>
      OtpItemSchema.parse(validOtpItem({ otpType: "steam", digits: 5, period: 45 })),
    ).toThrow();
    expect(() => OtpItemSchema.parse(validOtpItem({ digits: 5 }))).toThrow();
    expect(OtpItemSchema.parse(validOtpItem({ digits: 10 })).digits).toBe(10);
  });

  it("keeps the Project 1 vault union OTP-only and rejects unknown item kinds", () => {
    expect(VaultItemSchema.parse(validOtpItem()).kind).toBe("otp");
    expect(() => VaultItemSchema.parse(validOtpItem({ kind: "login" }))).toThrow();
    expect(() => VaultItemSchema.parse(validOtpItem({ kind: "note" }))).toThrow();
  });

  it("infers public item types from strict runtime schemas", () => {
    const item = OtpItemSchema.parse(validOtpItem());
    expectTypeOf(item).toEqualTypeOf<OtpItem>();
    expectTypeOf(item).toMatchTypeOf<VaultItem>();
  });
});
