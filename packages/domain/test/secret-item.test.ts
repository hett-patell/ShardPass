import { describe, expect, it } from "vitest";

import { MAX_SECRET_METADATA_ENTRIES, SecretItemSchema } from "../src/secret-item";

const validSecret = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  kind: "secret" as const,
  schemaVersion: 2,
  revision: 1,
  createdAt: "2026-09-02T10:00:00Z",
  updatedAt: "2026-09-02T10:00:00Z",
  favorite: false,
  tags: [],
  name: "Deploy key",
  secretType: "ssh_key" as const,
  value: "-----BEGIN OPENSSH PRIVATE KEY-----",
  metadata: { environment: "production" },
  notes: "",
};

describe("SecretItemSchema", () => {
  it("accepts a valid secret item", () => {
    expect(() => SecretItemSchema.parse(validSecret)).not.toThrow();
  });

  it("rejects an empty name", () => {
    expect(() => SecretItemSchema.parse({ ...validSecret, name: "" })).toThrow();
  });

  it("rejects a name exceeding max length", () => {
    expect(() => SecretItemSchema.parse({ ...validSecret, name: "a".repeat(257) })).toThrow();
  });

  it("rejects an untrimmed name", () => {
    expect(() => SecretItemSchema.parse({ ...validSecret, name: " Deploy key " })).toThrow();
  });

  it.each(["api_key", "ssh_key", "token", "env", "other"] as const)(
    "accepts secretType %s",
    (secretType) => {
      expect(() => SecretItemSchema.parse({ ...validSecret, secretType })).not.toThrow();
    },
  );

  it("rejects an invalid secretType", () => {
    expect(() => SecretItemSchema.parse({ ...validSecret, secretType: "password" })).toThrow();
  });

  it("accepts an empty value", () => {
    expect(() => SecretItemSchema.parse({ ...validSecret, value: "" })).not.toThrow();
  });

  it("rejects a value exceeding max length", () => {
    expect(() => SecretItemSchema.parse({ ...validSecret, value: "a".repeat(65537) })).toThrow();
  });

  it("accepts an empty metadata record", () => {
    expect(() => SecretItemSchema.parse({ ...validSecret, metadata: {} })).not.toThrow();
  });

  it("accepts metadata at the maximum entry count", () => {
    const metadata = Object.fromEntries(
      Array.from({ length: MAX_SECRET_METADATA_ENTRIES }, (_, i) => [`key${i}`, `value${i}`]),
    );
    expect(() => SecretItemSchema.parse({ ...validSecret, metadata })).not.toThrow();
  });

  it("rejects metadata exceeding the maximum entry count", () => {
    const metadata = Object.fromEntries(
      Array.from({ length: MAX_SECRET_METADATA_ENTRIES + 1 }, (_, i) => [`key${i}`, `value${i}`]),
    );
    expect(() => SecretItemSchema.parse({ ...validSecret, metadata })).toThrow();
  });

  it("rejects a metadata key exceeding its 128-character bound", () => {
    expect(() =>
      SecretItemSchema.parse({ ...validSecret, metadata: { ["k".repeat(129)]: "v" } }),
    ).toThrow();
  });

  it("rejects a metadata value exceeding its 4096-character bound", () => {
    expect(() =>
      SecretItemSchema.parse({ ...validSecret, metadata: { key: "v".repeat(4097) } }),
    ).toThrow();
  });

  it("rejects wrong kind", () => {
    expect(() => SecretItemSchema.parse({ ...validSecret, kind: "note" })).toThrow();
  });

  it("rejects a stale schemaVersion", () => {
    expect(() => SecretItemSchema.parse({ ...validSecret, schemaVersion: 1 })).toThrow();
  });

  it("rejects unknown properties", () => {
    expect(() => SecretItemSchema.parse({ ...validSecret, unexpected: "nope" })).toThrow();
  });
});
