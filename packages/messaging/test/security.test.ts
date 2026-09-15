import { describe, expect, it } from "vitest";

import {
  parseSecurityResponseForRequest,
  SecurityRequestSchema,
  securitySenderPolicy,
} from "../src/security";

const itemId = "10000000-0000-4000-8000-000000000001";

describe("security messaging", () => {
  it("accepts the three commands and nothing extra", () => {
    expect(
      SecurityRequestSchema.safeParse({ version: 1, kind: "security.getSettings" }).success,
    ).toBe(true);
    expect(
      SecurityRequestSchema.safeParse({
        version: 1,
        kind: "security.setBreachChecks",
        enabled: true,
      }).success,
    ).toBe(true);
    expect(
      SecurityRequestSchema.safeParse({ version: 1, kind: "security.checkItem", itemId }).success,
    ).toBe(true);
    expect(
      SecurityRequestSchema.safeParse({
        version: 1,
        kind: "security.checkItem",
        itemId,
        password: "x",
      }).success,
    ).toBe(false);
    expect(
      SecurityRequestSchema.safeParse({ version: 1, kind: "security.checkItem", itemId: "nope" })
        .success,
    ).toBe(false);
  });

  it("keeps the network-touching commands to the vault page", () => {
    expect(securitySenderPolicy["security.checkItem"].allowedContexts).toEqual(["vault"]);
    expect(securitySenderPolicy["security.setBreachChecks"].allowedContexts).toEqual(["vault"]);
    expect(securitySenderPolicy["security.getSettings"].allowedContexts).toEqual([
      "popup",
      "vault",
    ]);
  });

  it("matches a reply to its request", () => {
    const check = { version: 1 as const, kind: "security.checkItem" as const, itemId };
    expect(
      parseSecurityResponseForRequest(check, {
        version: 1,
        kind: "security.breachResult",
        itemId,
        count: 2,
        checkedAt: 10,
      }).success,
    ).toBe(true);
    expect(
      parseSecurityResponseForRequest(check, {
        version: 1,
        kind: "security.settings",
        breachChecks: true,
      }).success,
    ).toBe(false);
    expect(
      parseSecurityResponseForRequest(check, {
        version: 1,
        kind: "security.breachResult",
        itemId,
        count: -1,
        checkedAt: 10,
      }).success,
    ).toBe(false);
  });
});
