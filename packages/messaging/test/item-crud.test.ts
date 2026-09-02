import { describe, expect, it } from "vitest";

import {
  ItemCreateRequestSchema,
  ItemCrudRequestSchema,
  ItemDeleteRequestSchema,
  ItemGetRequestSchema,
  ItemQueryRequestSchema,
  ItemUpdateRequestSchema,
} from "../src/item-crud";

const itemId = "01234567-89ab-4def-8123-456789abcdef";
const folderId = "89abcdef-0123-4456-8789-0123456789ab";

const requests = [
  { version: 1, kind: "item.query" },
  {
    version: 1,
    kind: "item.query",
    itemKind: "login",
    folderId,
    search: "gmail",
    favoritesOnly: true,
  },
  { version: 1, kind: "item.get", itemId },
  { version: 1, kind: "item.create", item: { name: "example" } },
  { version: 1, kind: "item.update", itemId, expectedRevision: 1, fields: { name: "renamed" } },
  { version: 1, kind: "item.delete", itemId },
] as const;

describe("item CRUD messaging", () => {
  it("accepts every request variant and rejects unknown fields", () => {
    for (const request of requests) {
      expect(ItemCrudRequestSchema.safeParse(request).success).toBe(true);
      expect(ItemCrudRequestSchema.safeParse({ ...request, extra: "nope" }).success).toBe(false);
    }
  });

  it("accepts every valid VAULT_ITEM_KINDS value for item.query and rejects unknown kinds", () => {
    for (const itemKind of ["otp", "login", "note", "card", "identity", "secret"])
      expect(ItemQueryRequestSchema.safeParse({ ...requests[0], itemKind }).success).toBe(true);
    expect(ItemQueryRequestSchema.safeParse({ ...requests[0], itemKind: "bogus" }).success).toBe(
      false,
    );
    expect(
      ItemQueryRequestSchema.safeParse({ ...requests[0], folderId: "not-a-uuid" }).success,
    ).toBe(false);
    expect(
      ItemQueryRequestSchema.safeParse({ ...requests[0], search: "x".repeat(257) }).success,
    ).toBe(false);
  });

  it("rejects malformed item.get, item.update, and item.delete requests", () => {
    expect(ItemGetRequestSchema.safeParse({ ...requests[2], itemId: "bad" }).success).toBe(false);
    expect(ItemUpdateRequestSchema.safeParse({ ...requests[4], expectedRevision: 0 }).success).toBe(
      false,
    );
    expect(
      ItemUpdateRequestSchema.safeParse({ ...requests[4], expectedRevision: -1 }).success,
    ).toBe(false);
    expect(ItemDeleteRequestSchema.safeParse({ kind: "item.delete" }).success).toBe(false);
  });

  it("accepts arbitrary item payloads for create (validated at the domain layer)", () => {
    expect(ItemCreateRequestSchema.safeParse({ ...requests[3], item: "raw-string" }).success).toBe(
      true,
    );
    expect(ItemCreateRequestSchema.safeParse({ ...requests[3], item: null }).success).toBe(true);
  });
});
