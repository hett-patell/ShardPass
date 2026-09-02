import { describe, expect, it } from "vitest";

import { decodeCanonicalBase32, generateHotp } from "../src";

const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const expected = [
  "755224",
  "287082",
  "359152",
  "969429",
  "338314",
  "254676",
  "287922",
  "162583",
  "399871",
  "520489",
];

describe("RFC 4226 HOTP", () => {
  it("matches every Appendix D counter", async () => {
    for (const [counter, code] of expected.entries()) {
      await expect(generateHotp(secret, counter, 6, "SHA1")).resolves.toBe(code);
    }
  });

  it("uses an exact unsigned eight-byte counter through MAX_SAFE_INTEGER", async () => {
    await expect(generateHotp(secret, Number.MAX_SAFE_INTEGER, 10, "SHA512")).resolves.toMatch(
      /^\d{10}$/u,
    );
    await expect(
      generateHotp(secret, Number.MAX_SAFE_INTEGER + 1, 6, "SHA1"),
    ).rejects.toMatchObject({
      code: "OTP_INVALID_COUNTER",
    });
  });

  it.each([
    ["MY", "66"],
    ["MZXQ", "666f"],
    ["MZXW6", "666f6f"],
    ["MZXW6YQ", "666f6f62"],
    ["MZXW6YTB", "666f6f6261"],
  ])("decodes canonical complete-byte Base32 %s", (encoded, hex) => {
    expect(Buffer.from(decodeCanonicalBase32(encoded)).toString("hex")).toBe(hex);
  });

  it.each(["my", "MY======", "MZ", "A", "ABCD 2345"])(
    "rejects noncanonical Base32 without normalizing: %s",
    (encoded) => {
      expect(() => decodeCanonicalBase32(encoded)).toThrowError(
        expect.objectContaining({ code: "OTP_INVALID_SECRET" }),
      );
    },
  );
});
