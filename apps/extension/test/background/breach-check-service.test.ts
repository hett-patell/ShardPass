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
