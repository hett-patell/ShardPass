import { describe, expect, test } from "vitest";
import { createHmac } from "node:crypto";
import { Secret } from "otpauth";
import { generateCode, progress, secondsRemaining } from "@/lib/totp";
import type { Account } from "@/types";

function acct(partial: Partial<Account>): Account {
  return {
    id: "test",
    issuer: "Example",
    label: "user@example.com",
    secret: "JBSWY3DPEHPK3PXP",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    tags: [],
    createdAt: 0,
    ...partial,
  };
}

describe("secondsRemaining / progress", () => {
  test("returns finite values for period 0 (HOTP accounts)", () => {
    expect(Number.isFinite(secondsRemaining(0))).toBe(true);
    expect(Number.isFinite(progress(0))).toBe(true);
  });

  test("normal period still counts down", () => {
    // At t=59s into the epoch a 30s period has 1s remaining.
    expect(secondsRemaining(30, 59_000)).toBe(1);
  });
});

describe("generateCode", () => {
  test("matches RFC 6238 SHA1 test vector", () => {
    // Secret is base32 of "12345678901234567890" (RFC 6238 appendix B).
    const a = acct({ secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", digits: 8 });
    expect(generateCode(a, 59_000)).toBe("94287082");
  });

  test("steam accounts use Steam's 5-char alphanumeric encoding", () => {
    const ts = 1_700_000_000_000;
    const secret = "JBSWY3DPEHPK3PXP";
    const a = acct({ type: "steam", secret, digits: 5 });

    // Independent reference implementation built on node:crypto.
    const key = Buffer.from(Secret.fromBase32(secret).bytes);
    const counterBuf = Buffer.alloc(8);
    counterBuf.writeBigUInt64BE(BigInt(Math.floor(ts / 1000 / 30)));
    const mac = createHmac("sha1", key).update(counterBuf).digest();
    const off = mac[19]! & 0xf;
    let bin =
      ((mac[off]! & 0x7f) << 24) |
      (mac[off + 1]! << 16) |
      (mac[off + 2]! << 8) |
      mac[off + 3]!;
    const ALPHABET = "23456789BCDFGHJKMNPQRTVWXY";
    let expected = "";
    for (let i = 0; i < 5; i++) {
      expected += ALPHABET[bin % 26];
      bin = Math.floor(bin / 26);
    }

    expect(generateCode(a, ts)).toBe(expected);
    expect(generateCode(a, ts)).toMatch(/^[23456789BCDFGHJKMNPQRTVWXY]{5}$/);
  });
});
