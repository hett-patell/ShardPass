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
    expect(() =>
      LoginItemSchema.parse({ ...validLogin, linkedOtpId: "not-a-uuid" }),
    ).toThrow();
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
    expect(() =>
      LoginItemSchema.parse({ ...validLogin, unexpected: "nope" }),
    ).toThrow();
  });
});
