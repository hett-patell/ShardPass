import { describe, expect, it } from "vitest";

import { VaultItemSchema } from "../src/otp-item";

const baseMetadata = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  schemaVersion: 2 as const,
  revision: 1,
  createdAt: "2026-09-02T10:00:00Z",
  updatedAt: "2026-09-02T10:00:00Z",
  favorite: false,
  tags: [],
};

const fixtures = {
  otp: {
    ...baseMetadata,
    kind: "otp" as const,
    issuer: "Synthetic",
    label: "fixture@example.invalid",
    secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    otpType: "totp" as const,
    algorithm: "SHA1" as const,
    digits: 6,
    period: 30,
    note: "",
  },
  login: {
    ...baseMetadata,
    kind: "login" as const,
    name: "GitHub",
    username: "user@example.com",
    password: "hunter2",
    urls: ["github.com"],
    notes: "",
  },
  note: {
    ...baseMetadata,
    kind: "note" as const,
    name: "Wifi password",
    content: "the secret note contents",
  },
  card: {
    ...baseMetadata,
    kind: "card" as const,
    name: "Personal Visa",
    cardholderName: "Jane Doe",
    number: "4111111111111111",
    expMonth: "09",
    expYear: "2030",
    cvv: "123",
    pin: "",
    notes: "",
  },
  identity: {
    ...baseMetadata,
    kind: "identity" as const,
    name: "Home identity",
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    phone: "",
    street: "",
    city: "",
    state: "",
    zip: "",
    country: "",
    notes: "",
  },
  secret: {
    ...baseMetadata,
    kind: "secret" as const,
    name: "Deploy key",
    secretType: "ssh_key" as const,
    value: "-----BEGIN OPENSSH PRIVATE KEY-----",
    metadata: {},
    notes: "",
  },
};

describe("VaultItemSchema discriminated union", () => {
  it.each(Object.entries(fixtures))("parses a %s item by kind", (kind, item) => {
    const result = VaultItemSchema.parse(item);
    expect(result.kind).toBe(kind);
  });

  it("rejects unknown kind", () => {
    const unknown = { ...baseMetadata, kind: "unknown" };
    expect(() => VaultItemSchema.parse(unknown)).toThrow();
  });

  it("rejects a login-kind object shaped like an otp item", () => {
    expect(() => VaultItemSchema.parse({ ...fixtures.otp, kind: "login" })).toThrow();
  });
});
