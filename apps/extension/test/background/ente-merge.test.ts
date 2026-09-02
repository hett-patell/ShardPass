import { describe, expect, it } from "vitest";

import { mergeEnteOtp } from "../../src/background/ente/merge";

const otp = (label: string) =>
  ({
    version: 1,
    kind: "otp",
    otpType: "totp",
    issuer: "Issuer",
    label,
    secretBase32: "JBSWY3DPEHPK3PXP",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  }) as const;

describe("explicit Ente three-way merge", () => {
  it.each([
    [otp("base"), otp("base"), otp("remote"), "take-remote"],
    [otp("base"), otp("local"), otp("base"), "push-local"],
    [otp("base"), otp("same"), otp("same"), "converged"],
    [otp("base"), otp("local"), otp("remote"), "conflict"],
    [otp("base"), null, otp("remote"), "conflict"],
    [otp("base"), otp("local"), null, "conflict"],
    [otp("base"), null, null, "delete"],
  ] as const)("classifies B/L/R without timestamps", (base, local, remote, expected) => {
    expect(mergeEnteOtp({ base, local, remote }).action).toBe(expected);
  });

  it("never silently defaults divergent HOTP counters", () => {
    const base = { ...otp("counter"), otpType: "hotp", counter: 1 } as const;
    expect(
      mergeEnteOtp({ base, local: { ...base, counter: 2 }, remote: { ...base, counter: 3 } })
        .action,
    ).toBe("conflict");
  });
});
