import { describe, expect, it } from "vitest";

import { importSafariCsv } from "../src/safari";

describe("importSafariCsv", () => {
  it("imports the six-column export with one-time codes and notes", () => {
    const csv =
      "Title,URL,Username,Password,Notes,OTPAuth\n" +
      'example.com (alice),https://example.com,alice,pw-1,"multi\nline",otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example\n';
    const result = importSafariCsv(csv);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      kind: "login",
      name: "example.com (alice)",
      username: "alice",
      password: "pw-1",
      urls: ["https://example.com"],
      notes: "multi\nline",
      totp: "otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example",
    });
    expect(result.warnings).toEqual([]);
  });

  it("reads the older four-column export too", () => {
    const result = importSafariCsv("Title,Url,Username,Password\nA,https://a.example,alice,pw\n");
    expect(result.items[0]).toMatchObject({
      name: "A",
      urls: ["https://a.example"],
      password: "pw",
    });
  });
});
