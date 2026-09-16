import type { LoginItem } from "@shardpass/domain";
import { generateOtp } from "@shardpass/otp";
import { describe, expect, it } from "vitest";

import { inlineTotpItem } from "../../src/vault/components/detail/useInlineTotp";

const login = (totp?: string): LoginItem => ({
  id: "018f47a6-7d11-7c2f-8bd9-a1d37f147a20",
  schemaVersion: 2,
  revision: 1,
  createdAt: "2026-08-10T12:00:00.000Z",
  updatedAt: "2026-08-10T12:00:00.000Z",
  favorite: false,
  tags: [],
  kind: "login",
  name: "Example",
  username: "alice",
  password: "p",
  urls: [],
  notes: "",
  ...(totp === undefined ? {} : { totp }),
});

describe("inlineTotpItem", () => {
  it("returns null when the login has no inline secret", () => {
    expect(inlineTotpItem(login())).toBeNull();
  });

  it("accepts a full otpauth URI", () => {
    const item = inlineTotpItem(
      login(
        "otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example&digits=8&period=60",
      ),
    );
    expect(item).toMatchObject({ kind: "otp", secret: "JBSWY3DPEHPK3PXP", digits: 8, period: 60 });
  });

  it("wraps a bare Base32 secret with standard TOTP defaults", () => {
    const item = inlineTotpItem(login("jbswy3dpehpk3pxp"));
    expect(item).toMatchObject({
      kind: "otp",
      secret: "JBSWY3DPEHPK3PXP",
      otpType: "totp",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });
  });

  it("produces something the generator accepts", async () => {
    // RFC 6238 Appendix B secret ("12345678901234567890" as Base32), t=59s, SHA1, 6 digits.
    const item = inlineTotpItem(login("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"));
    expect(item).not.toBeNull();
    const generated = await generateOtp(item!, 59_000);
    expect(generated.code).toBe("287082");
  });

  it("returns null for a secret that is neither Base32 nor a URI", () => {
    expect(inlineTotpItem(login("not a secret!"))).toBeNull();
  });

  it("reads Bitwarden's steam://SECRET form as a Steam Guard code", () => {
    const item = inlineTotpItem(login("steam://JBSWY3DPEHPK3PXP"));
    expect(item).toMatchObject({ otpType: "steam", issuer: "Steam", digits: 5 });
  });
});
