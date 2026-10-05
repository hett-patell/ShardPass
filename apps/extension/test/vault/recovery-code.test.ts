import { describe, expect, it } from "vitest";

import {
  formatRecoveryCode,
  generateRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_LENGTH,
} from "../../src/vault-access/recovery-code";

describe("recovery codes", () => {
  it("are 24 Base32 letters carrying every random bit, and differ each time", () => {
    const allOnes = generateRecoveryCode((bytes) => bytes.fill(0xff));
    expect(allOnes).toBe("7".repeat(RECOVERY_CODE_LENGTH));
    expect(generateRecoveryCode((bytes) => bytes.fill(0))).toBe("A".repeat(RECOVERY_CODE_LENGTH));
    const first = generateRecoveryCode();
    expect(first).toMatch(/^[A-Z2-7]{24}$/u);
    expect(generateRecoveryCode()).not.toBe(first);
  });

  it("show in six groups of four and read back however they were written", () => {
    const code = "ABCDEFGHIJKLMNOPQRSTUVWX";
    expect(formatRecoveryCode(code)).toBe("ABCD-EFGH-IJKL-MNOP-QRST-UVWX");
    expect(normalizeRecoveryCode("abcd efgh ijkl mnop qrst uvwx")).toBe(code);
    expect(normalizeRecoveryCode("ABCD-EFGH-1JKL-MN0P-QRST-UVWX")).toBe(code);
    expect(normalizeRecoveryCode("ABCD-EFGH")).toBeNull();
    expect(normalizeRecoveryCode("ABCD-EFGH-IJKL-MNOP-QRST-UVW9")).toBeNull();
  });
});
