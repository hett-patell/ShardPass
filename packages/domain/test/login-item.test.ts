import { describe, expect, it } from "vitest";

import { LoginItemSchema, MAX_LOGIN_URLS } from "../src/login-item";

const validLogin = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  kind: "login" as const,
  schemaVersion: 2,
  revision: 1,
  createdAt: "2026-09-02T10:00:00Z",
  updatedAt: "2026-09-02T10:00:00Z",
  favorite: false,
  tags: [],
  name: "GitHub",
  username: "user@example.com",
  password: "hunter2",
  urls: ["github.com"],
  notes: "",
};

describe("LoginItemSchema", () => {
  it("accepts a valid login item", () => {
    expect(() => LoginItemSchema.parse(validLogin)).not.toThrow();
  });

  it("rejects missing name", () => {
    expect(() => LoginItemSchema.parse({ ...validLogin, name: "" })).toThrow();
  });

  it("rejects name exceeding max length", () => {
    expect(() => LoginItemSchema.parse({ ...validLogin, name: "a".repeat(257) })).toThrow();
  });

  it("rejects an untrimmed name", () => {
    expect(() => LoginItemSchema.parse({ ...validLogin, name: " GitHub " })).toThrow();
  });

  it("accepts empty username and password", () => {
    expect(() =>
      LoginItemSchema.parse({ ...validLogin, username: "", password: "" }),
    ).not.toThrow();
  });

  it("rejects a password exceeding max length", () => {
    expect(() => LoginItemSchema.parse({ ...validLogin, password: "a".repeat(4097) })).toThrow();
  });

  it("rejects too many URLs", () => {
    const urls = Array.from({ length: MAX_LOGIN_URLS + 1 }, (_, i) => `site${i}.com`);
    expect(() => LoginItemSchema.parse({ ...validLogin, urls })).toThrow();
  });

  it("accepts the maximum number of URLs", () => {
    const urls = Array.from({ length: MAX_LOGIN_URLS }, (_, i) => `site${i}.com`);
    expect(() => LoginItemSchema.parse({ ...validLogin, urls })).not.toThrow();
  });

  it("rejects an empty-string URL entry", () => {
    expect(() => LoginItemSchema.parse({ ...validLogin, urls: [""] })).toThrow();
  });

  it("accepts an empty urls array", () => {
    expect(() => LoginItemSchema.parse({ ...validLogin, urls: [] })).not.toThrow();
  });

  it("accepts optional linkedOtpId", () => {
    const withOtp = { ...validLogin, linkedOtpId: "550e8400-e29b-41d4-a716-446655440001" };
    expect(() => LoginItemSchema.parse(withOtp)).not.toThrow();
  });

  it("rejects a malformed linkedOtpId", () => {
    expect(() => LoginItemSchema.parse({ ...validLogin, linkedOtpId: "not-a-uuid" })).toThrow();
  });

  it("accepts optional folderId", () => {
    const withFolder = { ...validLogin, folderId: "550e8400-e29b-41d4-a716-446655440002" };
    expect(() => LoginItemSchema.parse(withFolder)).not.toThrow();
  });

  it("rejects wrong kind", () => {
    expect(() => LoginItemSchema.parse({ ...validLogin, kind: "otp" })).toThrow();
  });

  it("rejects a stale schemaVersion", () => {
    expect(() => LoginItemSchema.parse({ ...validLogin, schemaVersion: 1 })).toThrow();
  });

  it("rejects unknown properties", () => {
    expect(() => LoginItemSchema.parse({ ...validLogin, unexpected: "nope" })).toThrow();
  });
});

describe("login item v2 extensions", () => {
  const base = {
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
    password: "s3cret",
    urls: ["https://example.test", "https://sso.example.test/login"],
    notes: "",
  };

  it("still accepts a login without any of the new fields", () => {
    expect(LoginItemSchema.safeParse(base).success).toBe(true);
  });

  it("accepts per-URL match modes, custom fields, inline TOTP, and password history", () => {
    const parsed = LoginItemSchema.safeParse({
      ...base,
      urlMatches: ["domain", "exact"],
      totp: "otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example",
      customFields: [
        { name: "Security question", type: "text", value: "first pet" },
        { name: "PIN", type: "hidden", value: "1234" },
        { name: "Remember me", type: "boolean", value: "true" },
        { name: "user_email", type: "linked", value: "", linkedTo: "username" },
      ],
      passwordHistory: [{ password: "old-one", changedAt: "2026-08-01T00:00:00.000Z" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("requires linkedTo on a linked field and forbids it elsewhere", () => {
    expect(
      LoginItemSchema.safeParse({
        ...base,
        customFields: [{ name: "x", type: "linked", value: "" }],
      }).success,
    ).toBe(false);
    expect(
      LoginItemSchema.safeParse({
        ...base,
        customFields: [{ name: "x", type: "text", value: "v", linkedTo: "password" }],
      }).success,
    ).toBe(false);
  });

  it("bounds custom fields and password history", () => {
    const fields = Array.from({ length: 33 }, (_, index) => ({
      name: `f${index}`,
      type: "text",
      value: "",
    }));
    expect(LoginItemSchema.safeParse({ ...base, customFields: fields }).success).toBe(false);
    const history = Array.from({ length: 11 }, () => ({
      password: "p",
      changedAt: "2026-08-01T00:00:00.000Z",
    }));
    expect(LoginItemSchema.safeParse({ ...base, passwordHistory: history }).success).toBe(false);
  });

  it("rejects an unknown match mode", () => {
    expect(LoginItemSchema.safeParse({ ...base, urlMatches: ["regex"] }).success).toBe(false);
  });
});
