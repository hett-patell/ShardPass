import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createEnteSodiumAdapter,
  type EnteSodiumAdapter,
} from "../../src/background/ente/sodium-adapter";
import { encryptEnteOtpEntity, parseEnteOtpEntity } from "../../src/background/ente/otp-adapter";

let sodium: EnteSodiumAdapter;
beforeAll(async () => {
  sodium = await createEnteSodiumAdapter();
});
afterAll(() => sodium.dispose());

const projections = [
  {
    version: 1,
    kind: "otp",
    otpType: "totp",
    issuer: "Issuer",
    label: "alice",
    secretBase32: "JBSWY3DPEHPK3PXP",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  },
  {
    version: 1,
    kind: "otp",
    otpType: "hotp",
    issuer: "Issuer",
    label: "counter",
    secretBase32: "JBSWY3DPEHPK3PXP",
    algorithm: "SHA256",
    digits: 8,
    counter: 7,
  },
  {
    version: 1,
    kind: "otp",
    otpType: "steam",
    issuer: "Steam",
    label: "player",
    secretBase32: "JBSWY3DPEHPK3PXP",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  },
] as const;

describe("OTP-only Ente entity adapter", () => {
  it.each(projections)("round-trips canonical $otpType entities", (projection) => {
    const key = sodium.randomBytes(32);
    const frame = encryptEnteOtpEntity(projection, key, sodium);
    const parsed = parseEnteOtpEntity({ version: 1, ...frame }, key, sodium);
    expect(parsed).toEqual(projection);
  });

  it("rejects non-OTP, unknown fields, and noncanonical plaintext", () => {
    const key = sodium.randomBytes(32);
    const plaintext = new TextEncoder().encode(
      JSON.stringify({ version: 1, kind: "login", password: "canary" }),
    );
    const frame = sodium.encryptAuthEntity(plaintext, key);
    plaintext.fill(0);
    expect(() => parseEnteOtpEntity({ version: 1, ...frame }, key, sodium)).toThrowError(
      expect.objectContaining({ code: "ENTE_INVALID" }),
    );
  });
});
