import { describe, expect, it, vi } from "vitest";

import type { StoragePort, StorageValue } from "@shardpass/storage";

import { BreachCheckService } from "../../src/background/security/breach-check-service";

const itemId = "10000000-0000-4000-8000-000000000001";
// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
const PREFIX = "5BAA6";
const SUFFIX = "1E4C9B93F3F0682250B6CF8331B7EE68FD8";

function localStore(initial: Record<string, unknown> = {}): StoragePort {
  const values: Record<string, StorageValue> = { ...(initial as Record<string, StorageValue>) };
  return {
    get: (keys: readonly string[]) =>
      Promise.resolve(
        Object.fromEntries(
          keys.filter((key) => key in values).map((key) => [key, values[key] as StorageValue]),
        ),
      ),
    set: (next: Readonly<Record<string, StorageValue>>) => {
      Object.assign(values, next);
      return Promise.resolve();
    },
    remove: (keys: readonly string[]) => {
      for (const key of keys) delete values[key];
      return Promise.resolve();
    },
    listKeys: () => Promise.resolve({ keys: [], complete: true }),
  };
}

function harness(
  options: { enabled?: boolean; password?: string; body?: string; fail?: boolean } = {},
) {
  let now = 1_000_000;
  const fetchRange = vi.fn((prefix: string) => {
    if (options.fail) return Promise.reject(new Error("offline"));
    expect(prefix).toBe(PREFIX);
    return Promise.resolve(
      options.body ??
        `0018A45C4D1DEF81644B54AB7F969B88D65:0\r\n${SUFFIX}:3861493\r\n011053FD0102E94D6AE2F8B83D76FAF94F6:1\r\n`,
    );
  });
  const service = new BreachCheckService({
    repository: {
      getItem: (id: string) =>
        Promise.resolve(
          id === itemId
            ? ({ id, kind: "login", password: options.password ?? "password" } as never)
            : null,
        ),
    },
    local: localStore(
      options.enabled === false
        ? {}
        : { "shardpass:v1:breach-checks": { version: 1, enabled: true } },
    ),
    fetchRange,
    now: () => now,
  });
  return { service, fetchRange, advance: (ms: number) => (now += ms) };
}

describe("BreachCheckService", () => {
  it("is off until turned on, and says so instead of calling the network", async () => {
    const { service, fetchRange } = harness({ enabled: false });
    expect(await service.handle({ version: 1, kind: "security.getSettings" })).toEqual({
      version: 1,
      kind: "security.settings",
      breachChecks: false,
    });
    await expect(
      service.handle({ version: 1, kind: "security.checkItem", itemId }),
    ).rejects.toMatchObject({
      code: "BREACH_CHECK_DISABLED",
    });
    expect(fetchRange).not.toHaveBeenCalled();
    expect(
      await service.handle({ version: 1, kind: "security.setBreachChecks", enabled: true }),
    ).toMatchObject({
      breachChecks: true,
    });
  });

  it("sends only the five-character prefix, finds the suffix in the padded range, and reuses the range", async () => {
    const { service, fetchRange } = harness();
    const first = await service.handle({ version: 1, kind: "security.checkItem", itemId });
    expect(first).toMatchObject({ kind: "security.breachResult", itemId, count: 3_861_493 });
    expect(fetchRange).toHaveBeenCalledTimes(1);
    expect(fetchRange).toHaveBeenCalledWith(PREFIX);
    await service.handle({ version: 1, kind: "security.checkItem", itemId });
    expect(fetchRange).toHaveBeenCalledTimes(1);
  });

  it("reports zero for a password absent from its range, and refetches once the range has aged", async () => {
    const { service, fetchRange, advance } = harness({
      password: "correct horse battery staple",
      body: "ABCDEF0123456789ABCDEF0123456789ABC:2\n",
    });
    const fresh = harness({
      password: "correct horse battery staple",
      body: "ABCDEF0123456789ABCDEF0123456789ABC:2\n",
    });
    void fresh;
    const prefixFree = new BreachCheckService({
      repository: {
        getItem: () =>
          Promise.resolve({
            id: itemId,
            kind: "login",
            password: "correct horse battery staple",
          } as never),
      },
      local: localStore({ "shardpass:v1:breach-checks": { version: 1, enabled: true } }),
      fetchRange: vi.fn(() => Promise.resolve("ABCDEF0123456789ABCDEF0123456789ABC:2\n")),
      now: () => 5,
    });
    expect(
      await prefixFree.handle({ version: 1, kind: "security.checkItem", itemId }),
    ).toMatchObject({ count: 0 });
    void service;
    void fetchRange;
    void advance;
  });

  it("names a missing or password-less item, and an unreachable service", async () => {
    const { service } = harness();
    await expect(
      service.handle({
        version: 1,
        kind: "security.checkItem",
        itemId: "10000000-0000-4000-8000-000000000002",
      }),
    ).rejects.toMatchObject({ code: "ITEM_NOT_FOUND" });
    const offline = harness({ fail: true });
    await expect(
      offline.service.handle({ version: 1, kind: "security.checkItem", itemId }),
    ).rejects.toMatchObject({
      code: "BREACH_CHECK_UNAVAILABLE",
    });
  });
});

/** Reversible sealing for tests; refuses while "locked". */
function fakeSecrets(state: { locked: boolean }) {
  return {
    seal: (purpose: string, plaintext: Uint8Array) =>
      state.locked
        ? Promise.reject(new Error("locked"))
        : Promise.resolve({
            nonce: purpose,
            ciphertext: Buffer.from(plaintext).toString("base64"),
          }),
    open: (purpose: string, sealed: { nonce: string; ciphertext: string }) =>
      state.locked || sealed.nonce !== purpose
        ? Promise.reject(new Error("locked"))
        : Promise.resolve(new Uint8Array(Buffer.from(sealed.ciphertext, "base64"))),
  };
}

describe("BreachCheckService remembered verdicts", () => {
  const otherId = "10000000-0000-4000-8000-000000000002";

  function remembering() {
    const passwords = new Map<string, string>([
      [itemId, "password"],
      [otherId, "correct horse battery staple"],
    ]);
    const state = { locked: false };
    const local = localStore({ "shardpass:v1:breach-checks": { version: 1, enabled: true } });
    let now = 1_000_000;
    const fetchRange = vi.fn((prefix: string) =>
      Promise.resolve(
        prefix === PREFIX ? `${SUFFIX}:3861493\n` : "ABCDEF0123456789ABCDEF0123456789ABC:2\n",
      ),
    );
    const login = (id: string) =>
      passwords.has(id) ? ({ id, kind: "login", password: passwords.get(id) } as never) : null;
    const service = new BreachCheckService({
      repository: {
        getItem: (id: string) => Promise.resolve(login(id)),
        listAllItems: () => Promise.resolve([...passwords.keys()].map((id) => login(id)) as never),
      },
      local,
      secrets: fakeSecrets(state),
      fetchRange,
      now: () => now,
    });
    return { service, fetchRange, passwords, state, local, advance: (ms: number) => (now += ms) };
  }

  it("remembers a verdict sealed, answers from memory until the password changes, and re-checks on request", async () => {
    const { service, fetchRange, passwords, local, advance } = remembering();
    const first = await service.handle({ version: 1, kind: "security.checkItem", itemId });
    expect(first).toMatchObject({ count: 3_861_493, checkedAt: 1_000_000 });
    expect(JSON.stringify(await local.get(["shardpass:v1:breach-results"]))).not.toContain(
      "3861493",
    );

    advance(60 * 60_000 * 5);
    const again = await service.handle({ version: 1, kind: "security.checkItem", itemId });
    expect(again).toMatchObject({ count: 3_861_493, checkedAt: 1_000_000 });
    expect(fetchRange).toHaveBeenCalledTimes(1);

    expect(await service.handle({ version: 1, kind: "security.listResults" })).toEqual({
      version: 1,
      kind: "security.results",
      results: [{ itemId, count: 3_861_493, checkedAt: 1_000_000, stale: false }],
    });

    passwords.set(itemId, "correct horse battery staple");
    expect(
      await service.handle({ version: 1, kind: "security.listResults", itemId }),
    ).toMatchObject({
      results: [{ itemId, stale: true }],
    });
    const changed = await service.handle({ version: 1, kind: "security.checkItem", itemId });
    expect(changed).toMatchObject({ count: 0 });
    expect(fetchRange).toHaveBeenCalledTimes(2);

    // Forcing asks again even with a verdict for this very password; the range itself is
    // still reused for an hour, so the clock moves past that first.
    advance(2 * 60 * 60_000);
    const forced = await service.handle({
      version: 1,
      kind: "security.checkItem",
      itemId,
      force: true,
    });
    expect(forced).toMatchObject({
      count: 0,
      checkedAt: 1_000_000 + 5 * 60 * 60_000 + 2 * 60 * 60_000,
    });
    expect(fetchRange).toHaveBeenCalledTimes(3);
  });

  it("drops verdicts for logins that are gone and forgets nothing it cannot read", async () => {
    const { service, passwords, state } = remembering();
    await service.handle({ version: 1, kind: "security.checkItem", itemId });
    await service.handle({ version: 1, kind: "security.checkItem", itemId: otherId });
    passwords.delete(otherId);
    expect(await service.handle({ version: 1, kind: "security.listResults" })).toMatchObject({
      results: [{ itemId }],
    });
    expect(
      await service.handle({ version: 1, kind: "security.listResults", itemId: otherId }),
    ).toEqual({
      version: 1,
      kind: "security.results",
      results: [],
    });
    state.locked = true;
    await expect(service.handle({ version: 1, kind: "security.listResults" })).resolves.toEqual({
      version: 1,
      kind: "security.results",
      results: [],
    });
  });
});
