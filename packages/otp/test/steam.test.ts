import type { OtpItem } from "@shardpass/domain";
import { describe, expect, it } from "vitest";

import { generateOtp } from "../src";

const steamItem: OtpItem = {
  id: "018f47a6-7d11-7c2f-8bd9-a1d37f147a20",
  schemaVersion: 2,
  revision: 1,
  createdAt: "2026-07-29T10:20:30.000Z",
  updatedAt: "2026-07-29T10:20:30.000Z",
  favorite: false,
  tags: [],
  kind: "otp",
  issuer: "Steam",
  label: "synthetic",
  secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
  otpType: "steam",
  algorithm: "SHA1",
  digits: 5,
  period: 30,
  note: "",
};

describe("Steam static-inference compatibility", () => {
  it("matches the honestly labeled unverified static-inference fixture", async () => {
    await expect(generateOtp(steamItem, 1_700_000_000_000)).resolves.toMatchObject({
      code: "R87JJ",
      counter: 56_666_666,
    });
  });

  it("uses only the Steam alphabet and always emits five characters", async () => {
    const result = await generateOtp(steamItem, 0);
    expect(result.code).toMatch(/^[23456789BCDFGHJKMNPQRTVWXY]{5}$/u);
  });
});
