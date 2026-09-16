import { FakeStoragePort } from "@shardpass/testing/fake-storage-port";
import { describe, expect, it, vi } from "vitest";

import { AliasError, AliasService } from "../../src/background/alias/alias-service";

/** A stand-in for the session's sealing: reversible, and refusing while "locked". */
function fakeSecrets(state: { locked: boolean }) {
  return {
    seal: (purpose: string, plaintext: Uint8Array) => {
      if (state.locked) return Promise.reject(new Error("locked"));
      return Promise.resolve({
        nonce: purpose,
        ciphertext: Buffer.from(plaintext).toString("base64"),
      });
    },
    open: (purpose: string, sealed: { nonce: string; ciphertext: string }) => {
      if (state.locked || sealed.nonce !== purpose) return Promise.reject(new Error("locked"));
      return Promise.resolve(new Uint8Array(Buffer.from(sealed.ciphertext, "base64")));
    },
  };
}

describe("AliasService", () => {
  it("stores the token sealed, reports status, mints addresses and forgets the token on request", async () => {
    const local = new FakeStoragePort();
    const state = { locked: false };
    const requestDuckAddress = vi.fn((token: string) =>
      Promise.resolve(token === "tok3n" ? "quiet_falcon42" : ""),
    );
    const service = new AliasService({ local, secrets: fakeSecrets(state), requestDuckAddress });

    expect(await service.handle({ version: 1, kind: "alias.getStatus" })).toEqual({
      version: 1,
      kind: "alias.status",
      duckduckgo: false,
    });
    await expect(service.handle({ version: 1, kind: "alias.generateDuck" })).rejects.toMatchObject({
      code: "ALIAS_NOT_CONFIGURED",
    });

    await service.handle({ version: 1, kind: "alias.setDuckToken", token: "Bearer tok3n" });
    const stored = JSON.stringify(await local.get(["shardpass:v1:integrations"]));
    expect(stored).not.toContain("tok3n");
    expect(await service.configured()).toBe(true);

    expect(await service.handle({ version: 1, kind: "alias.generateDuck" })).toEqual({
      version: 1,
      kind: "alias.generated",
      provider: "duckduckgo",
      address: "quiet_falcon42@duck.com",
    });
    expect(requestDuckAddress).toHaveBeenCalledWith("tok3n");
    expect(await service.generateDuckAddress()).toBe("quiet_falcon42@duck.com");

    state.locked = true;
    await expect(service.handle({ version: 1, kind: "alias.generateDuck" })).rejects.toMatchObject({
      code: "VAULT_LOCKED",
    });
    expect(await service.generateDuckAddress()).toBeNull();
    state.locked = false;

    await service.handle({ version: 1, kind: "alias.clearDuckToken" });
    expect(await service.configured()).toBe(false);
  });

  it("passes DuckDuckGo's refusal through and rejects an address it cannot trust", async () => {
    const local = new FakeStoragePort();
    const service = new AliasService({
      local,
      secrets: fakeSecrets({ locked: false }),
      requestDuckAddress: () => Promise.reject(new AliasError("ALIAS_REJECTED")),
    });
    await service.handle({ version: 1, kind: "alias.setDuckToken", token: "x" });
    await expect(service.handle({ version: 1, kind: "alias.generateDuck" })).rejects.toMatchObject({
      code: "ALIAS_REJECTED",
    });
    const odd = new AliasService({
      local,
      secrets: fakeSecrets({ locked: false }),
      requestDuckAddress: () => Promise.resolve("not an address@evil"),
    });
    await expect(odd.handle({ version: 1, kind: "alias.generateDuck" })).rejects.toMatchObject({
      code: "ALIAS_UNAVAILABLE",
    });
  });
});

describe("AliasService remembered addresses", () => {
  it("keeps every minted address, with its site, sealed beside the token, and forgets one on request", async () => {
    const local = new FakeStoragePort();
    const state = { locked: false };
    let minted = 0;
    let now = 1_000;
    const service = new AliasService({
      local,
      secrets: fakeSecrets(state),
      requestDuckAddress: () => Promise.resolve(`addr${(minted += 1)}`),
      now: () => (now += 1),
    });
    await service.handle({ version: 1, kind: "alias.setDuckToken", token: "tok" });
    await service.handle({ version: 1, kind: "alias.generateDuck", site: "shop.example" });
    expect(await service.generateDuckAddress("forum.example")).toBe("addr2@duck.com");
    await service.handle({ version: 1, kind: "alias.generateDuck" });
    expect(await service.handle({ version: 1, kind: "alias.listDuck" })).toEqual({
      version: 1,
      kind: "alias.duckList",
      addresses: [
        { address: "addr3@duck.com", createdAt: 1_003 },
        { address: "addr2@duck.com", createdAt: 1_002, site: "forum.example" },
        { address: "addr1@duck.com", createdAt: 1_001, site: "shop.example" },
      ],
    });
    expect(JSON.stringify(await local.get(["shardpass:v1:integrations"]))).not.toContain("addr1");

    expect(
      await service.handle({ version: 1, kind: "alias.forgetDuck", address: "addr2@duck.com" }),
    ).toMatchObject({ addresses: [{ address: "addr3@duck.com" }, { address: "addr1@duck.com" }] });

    // The token can go while the addresses stay; a locked vault shows none.
    await service.handle({ version: 1, kind: "alias.clearDuckToken" });
    expect((await service.handle({ version: 1, kind: "alias.listDuck" })).kind).toBe(
      "alias.duckList",
    );
    expect(await service.readAddresses()).toHaveLength(2);
    state.locked = true;
    expect(await service.readAddresses()).toEqual([]);
  });
});
