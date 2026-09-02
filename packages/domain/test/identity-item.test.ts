import { describe, expect, it } from "vitest";

import { IdentityItemSchema } from "../src/identity-item";

const validIdentity = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  kind: "identity" as const,
  schemaVersion: 2,
  revision: 1,
  createdAt: "2026-09-02T10:00:00Z",
  updatedAt: "2026-09-02T10:00:00Z",
  favorite: false,
  tags: [],
  name: "Home identity",
  firstName: "Jane",
  lastName: "Doe",
  email: "jane@example.com",
  phone: "555-0100",
  street: "1 Infinite Loop",
  city: "Cupertino",
  state: "CA",
  zip: "95014",
  country: "USA",
  notes: "",
};

describe("IdentityItemSchema", () => {
  it("accepts a valid identity item", () => {
    expect(() => IdentityItemSchema.parse(validIdentity)).not.toThrow();
  });

  it("rejects an empty name", () => {
    expect(() => IdentityItemSchema.parse({ ...validIdentity, name: "" })).toThrow();
  });

  it("rejects a name exceeding max length", () => {
    expect(() => IdentityItemSchema.parse({ ...validIdentity, name: "a".repeat(257) })).toThrow();
  });

  it("rejects an untrimmed name", () => {
    expect(() => IdentityItemSchema.parse({ ...validIdentity, name: " Jane " })).toThrow();
  });

  it("accepts all identity fields empty except name", () => {
    expect(() =>
      IdentityItemSchema.parse({
        ...validIdentity,
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        street: "",
        city: "",
        state: "",
        zip: "",
        country: "",
        notes: "",
      }),
    ).not.toThrow();
  });

  it("rejects a street exceeding its 512-character bound", () => {
    expect(() => IdentityItemSchema.parse({ ...validIdentity, street: "a".repeat(513) })).toThrow();
  });

  it("rejects an email exceeding its 256-character bound", () => {
    expect(() => IdentityItemSchema.parse({ ...validIdentity, email: "a".repeat(257) })).toThrow();
  });

  it("rejects notes exceeding max length", () => {
    expect(() =>
      IdentityItemSchema.parse({ ...validIdentity, notes: "a".repeat(8193) }),
    ).toThrow();
  });

  it("rejects wrong kind", () => {
    expect(() => IdentityItemSchema.parse({ ...validIdentity, kind: "card" })).toThrow();
  });

  it("rejects a stale schemaVersion", () => {
    expect(() => IdentityItemSchema.parse({ ...validIdentity, schemaVersion: 1 })).toThrow();
  });

  it("rejects unknown properties", () => {
    expect(() => IdentityItemSchema.parse({ ...validIdentity, unexpected: "nope" })).toThrow();
  });
});
