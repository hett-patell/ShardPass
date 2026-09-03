import { describe, expect, it } from "vitest";

import { importBitwardenJson } from "../src";

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    encrypted: false,
    folders: [],
    items: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        type: 1,
        name: "GitHub",
        notes: "personal account",
        favorite: true,
        login: {
          username: "user@example.com",
          password: "hunter2",
          uris: [{ match: null, uri: "https://github.com" }],
        },
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        type: 2,
        name: "Recovery codes",
        notes: "1234-5678\n8765-4321",
        favorite: false,
        secureNote: { type: 0 },
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        type: 3,
        name: "Personal Visa",
        notes: "",
        favorite: false,
        card: {
          cardholderName: "John Doe",
          brand: "Visa",
          number: "4111111111111111",
          expMonth: "12",
          expYear: "2030",
          code: "123",
        },
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        type: 4,
        name: "Home identity",
        notes: "",
        favorite: false,
        identity: {
          firstName: "John",
          lastName: "Doe",
          address1: "123 Main St",
          address2: "Apt 4",
          city: "Springfield",
          state: "IL",
          postalCode: "62701",
          country: "US",
          email: "john@example.com",
          phone: "555-1234",
        },
      },
    ],
    ...overrides,
  };
}

describe("importBitwardenJson", () => {
  it("imports login, note, card, and identity items", () => {
    const result = importBitwardenJson(JSON.stringify(fixture()));
    expect(result.warnings).toHaveLength(0);
    expect(result.items).toHaveLength(4);

    const [login, note, card, identity] = result.items;

    expect(login!.kind).toBe("login");
    if (login!.kind !== "login") throw new Error("expected login");
    expect(login!.name).toBe("GitHub");
    expect(login!.username).toBe("user@example.com");
    expect(login!.password).toBe("hunter2");
    expect(login!.urls).toEqual(["https://github.com"]);
    expect(login!.favorite).toBe(true);

    expect(note!.kind).toBe("note");
    if (note!.kind !== "note") throw new Error("expected note");
    expect(note!.name).toBe("Recovery codes");
    expect(note!.content).toBe("1234-5678\n8765-4321");

    expect(card!.kind).toBe("card");
    if (card!.kind !== "card") throw new Error("expected card");
    expect(card!.cardholderName).toBe("John Doe");
    expect(card!.number).toBe("4111111111111111");
    expect(card!.expMonth).toBe("12");
    expect(card!.expYear).toBe("2030");
    expect(card!.cvv).toBe("123");

    expect(identity!.kind).toBe("identity");
    if (identity!.kind !== "identity") throw new Error("expected identity");
    expect(identity!.firstName).toBe("John");
    expect(identity!.lastName).toBe("Doe");
    // address2 is its own field now rather than folded into street.
    expect(identity!.street).toBe("123 Main St");
    expect(identity!.address2).toBe("Apt 4");
    expect(identity!.city).toBe("Springfield");
    expect(identity!.email).toBe("john@example.com");
  });

  it("returns a warning instead of throwing for invalid JSON", () => {
    const result = importBitwardenJson("not json");
    expect(result.items).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
  });

  it("returns a warning instead of throwing when the items array is missing", () => {
    const result = importBitwardenJson(JSON.stringify({ encrypted: false }));
    expect(result.items).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
  });

  it("skips unsupported item types with a warning", () => {
    const result = importBitwardenJson(
      JSON.stringify(
        fixture({
          items: [{ id: "1", type: 99, name: "Unknown", notes: "" }],
        }),
      ),
    );
    expect(result.items).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Unknown");
  });

  it("skips non-object entries with a warning", () => {
    const result = importBitwardenJson(JSON.stringify({ items: ["not an object"] }));
    expect(result.items).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
  });
});
