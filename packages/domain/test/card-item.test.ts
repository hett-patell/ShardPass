import { describe, expect, it } from "vitest";

import { CardItemSchema } from "../src/card-item";

const validCard = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  kind: "card" as const,
  schemaVersion: 2,
  revision: 1,
  createdAt: "2026-09-02T10:00:00Z",
  updatedAt: "2026-09-02T10:00:00Z",
  favorite: false,
  tags: [],
  name: "Personal Visa",
  cardholderName: "Jane Doe",
  number: "4111111111111111",
  expMonth: "09",
  expYear: "2030",
  cvv: "123",
  pin: "",
  notes: "",
};

describe("CardItemSchema", () => {
  it("accepts a valid card item", () => {
    expect(() => CardItemSchema.parse(validCard)).not.toThrow();
  });

  it("rejects an empty name", () => {
    expect(() => CardItemSchema.parse({ ...validCard, name: "" })).toThrow();
  });

  it("rejects a name exceeding max length", () => {
    expect(() => CardItemSchema.parse({ ...validCard, name: "a".repeat(257) })).toThrow();
  });

  it("rejects an untrimmed name", () => {
    expect(() => CardItemSchema.parse({ ...validCard, name: " Visa " })).toThrow();
  });

  it("accepts all card fields empty except name", () => {
    expect(() =>
      CardItemSchema.parse({
        ...validCard,
        cardholderName: "",
        number: "",
        expMonth: "",
        expYear: "",
        cvv: "",
        pin: "",
        notes: "",
      }),
    ).not.toThrow();
  });

  it("rejects expMonth exceeding its 2-character bound", () => {
    expect(() => CardItemSchema.parse({ ...validCard, expMonth: "123" })).toThrow();
  });

  it("rejects expYear exceeding its 4-character bound", () => {
    expect(() => CardItemSchema.parse({ ...validCard, expYear: "20300" })).toThrow();
  });

  it("rejects cvv exceeding its 8-character bound", () => {
    expect(() => CardItemSchema.parse({ ...validCard, cvv: "123456789" })).toThrow();
  });

  it("rejects pin exceeding its 16-character bound", () => {
    expect(() => CardItemSchema.parse({ ...validCard, pin: "1".repeat(17) })).toThrow();
  });

  it("rejects a card number exceeding max length", () => {
    expect(() => CardItemSchema.parse({ ...validCard, number: "1".repeat(33) })).toThrow();
  });

  it("rejects wrong kind", () => {
    expect(() => CardItemSchema.parse({ ...validCard, kind: "identity" })).toThrow();
  });

  it("rejects a stale schemaVersion", () => {
    expect(() => CardItemSchema.parse({ ...validCard, schemaVersion: 1 })).toThrow();
  });

  it("rejects unknown properties", () => {
    expect(() => CardItemSchema.parse({ ...validCard, unexpected: "nope" })).toThrow();
  });
});
