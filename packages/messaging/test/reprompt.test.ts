import { describe, expect, it } from "vitest";

import { ItemListItemProjectionSchema, ItemQueryResultSchema } from "../src/item-crud";
import { VaultRequestSchema, vaultSenderPolicy } from "../src/vault";

const itemId = "10000000-0000-4000-8000-000000000001";

describe("re-prompt messaging", () => {
  it("accepts the confirmation from an extension document and binds it to one item", () => {
    const request = {
      version: 1,
      kind: "vault.confirmReprompt",
      challengeId: "0123456789abcdef0123456789abcdef",
      keyEncryptionKey: "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=",
      itemId,
    };
    expect(VaultRequestSchema.safeParse(request).success).toBe(true);
    expect(VaultRequestSchema.safeParse({ ...request, itemId: undefined }).success).toBe(false);
    expect(
      VaultRequestSchema.safeParse({
        version: 1,
        kind: "vault.getKdfChallenge",
        purpose: "reprompt",
      }).success,
    ).toBe(true);
    expect(vaultSenderPolicy["vault.confirmReprompt"].allowedContexts).toEqual(["popup", "vault"]);
  });

  it("carries the flag on list projections and names withheld items in query results", () => {
    expect(
      ItemListItemProjectionSchema.safeParse({
        id: itemId,
        kind: "login",
        revision: 1,
        name: "A",
        favorite: false,
        tags: [],
        reprompt: true,
      }).success,
    ).toBe(true);
    expect(
      ItemQueryResultSchema.safeParse({
        version: 1,
        kind: "item.queryResult",
        items: [],
        redacted: [itemId],
      }).success,
    ).toBe(true);
    expect(
      ItemQueryResultSchema.safeParse({
        version: 1,
        kind: "item.queryResult",
        items: [],
        redacted: ["nope"],
      }).success,
    ).toBe(false);
  });
});
