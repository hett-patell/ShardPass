import type { OtpItem } from "@shardpass/domain";
import { describe, expect, it } from "vitest";

import { generateOtp } from "../src";

const vectors = [
  [59, "94287082", "46119246", "90693936"],
  [1_111_111_109, "07081804", "68084774", "25091201"],
  [1_111_111_111, "14050471", "67062674", "99943326"],
  [1_234_567_890, "89005924", "91819424", "93441116"],
  [2_000_000_000, "69279037", "90698825", "38618901"],
  [20_000_000_000, "65353130", "77737706", "47863826"],
] as const;
const secrets = {
  SHA1: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
  SHA256: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA",
  SHA512:
    "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA",
} as const;

function item(algorithm: keyof typeof secrets): OtpItem {
  return {
    id: "018f47a6-7d11-7c2f-8bd9-a1d37f147a20",
    schemaVersion: 1,
    revision: 1,
    createdAt: "2026-07-29T10:20:30.000Z",
    updatedAt: "2026-07-29T10:20:30.000Z",
    favorite: false,
    tags: [],
    kind: "otp",
    issuer: "RFC",
    label: "vector",
    secret: secrets[algorithm],
    otpType: "totp",
    algorithm,
    digits: 8,
    period: 30,
    note: "",
  };
}

describe("RFC 6238 TOTP", () => {
  it.each([
    ["SHA1", 1],
    ["SHA256", 2],
    ["SHA512", 3],
  ] as const)("matches every Appendix B %s timestamp", async (algorithm, codeIndex) => {
    for (const vector of vectors) {
      const result = await generateOtp(item(algorithm), vector[0] * 1000);
      expect(result.code).toBe(vector[codeIndex]);
      expect(result.counter).toBe(Math.floor(vector[0] / 30));
    }
  });

  it("reports exact rollover boundaries", async () => {
    const before = await generateOtp(item("SHA1"), 59_999);
    const boundary = await generateOtp(item("SHA1"), 60_000);
    expect(before).toMatchObject({ counter: 1, remaining: 1, expiresAt: 60_000 });
    expect(boundary).toMatchObject({ counter: 2, remaining: 30, expiresAt: 90_000 });
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid time %s", async (nowMs) => {
    await expect(generateOtp(item("SHA1"), nowMs)).rejects.toMatchObject({
      code: "OTP_INVALID_TIME",
    });
  });
});
