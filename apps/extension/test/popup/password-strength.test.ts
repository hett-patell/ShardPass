import { describe, expect, it } from "vitest";

import { passwordStrength } from "../../src/vault-access/password-strength";

describe("passwordStrength", () => {
  it("rates a short or repetitive password as weak and a few unrelated words as strong", () => {
    expect(passwordStrength("").label).toBe("Too weak");
    expect(passwordStrength("password").level).toBeLessThan(2);
    expect(passwordStrength("aaaaaaaaaaaaaaaaaaaa").level).toBeLessThan(2);
    expect(passwordStrength("Tr0ub4dor&3").level).toBeGreaterThanOrEqual(2);
    expect(passwordStrength("correct horse battery staple").label).toBe("Strong");
  });
});
