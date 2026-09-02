import { describe, expect, it } from "vitest";

import { MAX_OTP_AUTH_URI_LENGTH, formatOtpAuthUri, parseOtpAuthUri } from "../src";

const base = {
  id: "018f47a6-7d11-7c2f-8bd9-a1d37f147a20",
  revision: 4,
  createdAt: "2026-07-29T10:20:30.000Z",
  updatedAt: "2026-07-29T10:20:30.000Z",
} as const;

describe("otpauth URI adapter", () => {
  it("normalizes external secret formatting and gives query issuer precedence", () => {
    const item = parseOtpAuthUri(
      "otpauth://totp/Legacy%20Issuer%3Aalice%40example.invalid?secret=gez%20dgnbv-gy3tqojq%3D%3D%3D%3D&issuer=Query%20Issuer&algorithm=sha256&digits=8&period=45",
      base,
    );
    expect(item).toMatchObject({
      issuer: "Query Issuer",
      label: "alice@example.invalid",
      secret: "GEZD GNBV".replace(" ", "") + "GY3TQOJQ",
      otpType: "totp",
      algorithm: "SHA256",
      digits: 8,
      period: 45,
    });
  });

  it("supports steam authority and the legacy totp Steam label form", () => {
    const direct = parseOtpAuthUri(
      "otpauth://steam/synthetic?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
      base,
    );
    const legacy = parseOtpAuthUri(
      "otpauth://totp/Steam:synthetic?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Steam",
      base,
    );
    expect(direct.otpType).toBe("steam");
    expect(legacy.otpType).toBe("steam");
  });

  it.each([
    ["Issuer:Division", "account:primary"],
    ["Percent%Issuer", "label%value"],
    ["Astral😀", "account🧪"],
    ["Cafe\u0301", "e\u0301:combining"],
  ])("round-trips issuer and label edge characters: %s / %s", (issuer, label) => {
    const item = parseOtpAuthUri(
      `otpauth://totp/${encodeURIComponent(`${issuer}:${label}`)}?secret=MY&issuer=${encodeURIComponent(issuer)}`,
      base,
    );
    expect(item).toMatchObject({ issuer, label });
    expect(parseOtpAuthUri(formatOtpAuthUri(item), base)).toEqual(item);
  });

  it.each(["totp", "hotp", "steam"] as const)(
    "round-trips every representable production type: %s",
    (type) => {
      const uri =
        type === "hotp"
          ? "otpauth://hotp/Issuer%3Aaccount?secret=MY&issuer=Issuer&counter=7"
          : `otpauth://${type}/Issuer%3Aaccount?secret=MY&issuer=Issuer`;
      const item = parseOtpAuthUri(uri, base);
      expect(parseOtpAuthUri(formatOtpAuthUri(item), base)).toEqual(item);
    },
  );

  it("requires a HOTP counter and emits deterministic query order and encoding", () => {
    const parsed = parseOtpAuthUri(
      "otpauth://hotp/Acme%20Co%3Aaccount%2Btag%40example.invalid?counter=7&digits=6&secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&algorithm=SHA1&issuer=Acme%20Co",
      base,
    );
    expect(formatOtpAuthUri(parsed)).toBe(
      "otpauth://hotp/Acme%20Co%3Aaccount%2Btag%40example.invalid?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Acme%20Co&algorithm=SHA1&digits=6&counter=7",
    );
    expect(parseOtpAuthUri(formatOtpAuthUri(parsed), base)).toEqual(parsed);
  });

  it.each([
    "otpauth://totp/?secret=MY",
    "otpauth://totp/label",
    "otpauth://hotp/label?secret=MY",
    "otpauth://totp/label?secret=MY&secret=MY",
    "otpauth://totp/label?secret=MY#fragment",
    "otpauth://user@totp/label?secret=MY",
    "otpauth://unknown/label?secret=MY",
    "otpauth://totp/%E0%A4%A?secret=MY",
    "otpauth://totp/label?secret=MY&x-critical=true",
  ])("rejects malformed, duplicate, unsupported, or critical input without details: %s", (uri) => {
    expect(() => parseOtpAuthUri(uri, base)).toThrowError(
      expect.objectContaining({ code: "OTP_INVALID_URI", message: "OTP_INVALID_URI" }),
    );
  });

  it("ignores bounded unknown noncritical fields", () => {
    expect(
      parseOtpAuthUri("otpauth://totp/label?secret=MY&image=https%3A%2F%2Fexample.invalid", base)
        .label,
    ).toBe("label");
  });

  it("accepts exactly the maximum URI length and rejects one character more", () => {
    const prefix = "otpauth://totp/label?secret=MY&image=";
    const exact = prefix + "a".repeat(MAX_OTP_AUTH_URI_LENGTH - prefix.length);
    expect(exact).toHaveLength(MAX_OTP_AUTH_URI_LENGTH);
    expect(parseOtpAuthUri(exact, base).label).toBe("label");
    expect(() => parseOtpAuthUri(`${exact}a`, base)).toThrowError(
      expect.objectContaining({ code: "OTP_INVALID_URI" }),
    );
  });

  it.each(["label:part", "label:part:two"])(
    "rejects an empty-issuer item whose label contains a colon: %s",
    (label) => {
      const parsed = parseOtpAuthUri("otpauth://totp/label?secret=MY", base);
      expect(() => formatOtpAuthUri({ ...parsed, issuer: "", label })).toThrowError(
        expect.objectContaining({ code: "OTP_URI_UNREPRESENTABLE" }),
      );
    },
  );

  it("round-trips an empty issuer when the label has no colon", () => {
    const parsed = parseOtpAuthUri("otpauth://totp/label?secret=MY", base);
    expect(parseOtpAuthUri(formatOtpAuthUri(parsed), base)).toEqual(parsed);
  });

  it("rejects a valid item whose deterministic URI exceeds the public limit", () => {
    const parsed = parseOtpAuthUri("otpauth://totp/label?secret=MY", base);
    const oversized = {
      ...parsed,
      issuer: "😀".repeat(128),
      label: "🧪".repeat(128),
      secret: "A".repeat(1024),
    };
    expect(() => formatOtpAuthUri(oversized)).toThrowError(
      expect.objectContaining({
        code: "OTP_URI_UNREPRESENTABLE",
        message: "OTP_URI_UNREPRESENTABLE",
      }),
    );
  });
});
