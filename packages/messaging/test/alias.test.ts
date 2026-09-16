import { describe, expect, it } from "vitest";

import { AliasRequestSchema, aliasSenderPolicy, parseAliasResponseForRequest } from "../src";

describe("alias messaging", () => {
  it("lets the popup ask for status and addresses but only the vault page store or clear a token", () => {
    expect(aliasSenderPolicy["alias.getStatus"].allowedContexts).toEqual(["popup", "vault"]);
    expect(aliasSenderPolicy["alias.generateDuck"].allowedContexts).toEqual(["popup", "vault"]);
    expect(aliasSenderPolicy["alias.setDuckToken"].allowedContexts).toEqual(["vault"]);
    expect(aliasSenderPolicy["alias.clearDuckToken"].allowedContexts).toEqual(["vault"]);
    for (const policy of Object.values(aliasSenderPolicy))
      expect(policy.requireDocument).toBe(true);
  });

  it("bounds the token and refuses unknown fields", () => {
    expect(
      AliasRequestSchema.safeParse({ version: 1, kind: "alias.setDuckToken", token: "" }).success,
    ).toBe(false);
    expect(
      AliasRequestSchema.safeParse({
        version: 1,
        kind: "alias.setDuckToken",
        token: "abc",
        extra: 1,
      }).success,
    ).toBe(false);
    expect(AliasRequestSchema.safeParse({ version: 1, kind: "alias.generateDuck" }).success).toBe(
      true,
    );
  });

  it("matches a reply to its request kind", () => {
    const status = { version: 1, kind: "alias.status", duckduckgo: true };
    const generated = {
      version: 1,
      kind: "alias.generated",
      provider: "duckduckgo",
      address: "abc123@duck.com",
    };
    expect(
      parseAliasResponseForRequest({ version: 1, kind: "alias.getStatus" }, status).success,
    ).toBe(true);
    expect(
      parseAliasResponseForRequest({ version: 1, kind: "alias.getStatus" }, generated).success,
    ).toBe(false);
    expect(
      parseAliasResponseForRequest({ version: 1, kind: "alias.generateDuck" }, generated).success,
    ).toBe(true);
  });
});
