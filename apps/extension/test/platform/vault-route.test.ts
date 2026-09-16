import { describe, expect, it } from "vitest";

import { parseVaultPageHash, vaultPageHash } from "../../src/platform/vault-route";

const id = "10000000-0000-4000-8000-000000000010";

describe("vault page deep links", () => {
  it("round-trips every target through the hash", () => {
    const targets = [
      { view: "settings" as const },
      { view: "import" as const },
      { view: "ente" as const },
      { newItem: "login" as const },
      { newItem: "card" as const },
      { item: id },
    ];
    for (const target of targets) expect(parseVaultPageHash(vaultPageHash(target))).toEqual(target);
    expect(vaultPageHash()).toBe("");
    expect(vaultPageHash({ view: "import" })).toBe("#/settings/import");
  });

  it("refuses anything that is not a known view, kind, or item id", () => {
    expect(parseVaultPageHash("")).toBeNull();
    expect(parseVaultPageHash("#/")).toBeNull();
    expect(parseVaultPageHash("#/new/rocket")).toBeNull();
    expect(parseVaultPageHash("#/item/not-an-id")).toBeNull();
    expect(parseVaultPageHash("#/settings/other")).toBeNull();
    expect(parseVaultPageHash("#javascript:alert(1)")).toBeNull();
    expect(vaultPageHash({ item: "../x" })).toBe("");
  });
});

describe("tool routes", () => {
  it("round-trips the generator, username and alias tools", () => {
    for (const view of ["generator", "usernames", "aliases"] as const) {
      expect(vaultPageHash({ view })).toBe(`#/tools/${view}`);
      expect(parseVaultPageHash(`#/tools/${view}`)).toEqual({ view });
    }
    expect(parseVaultPageHash("#/tools/other")).toBeNull();
  });
});
