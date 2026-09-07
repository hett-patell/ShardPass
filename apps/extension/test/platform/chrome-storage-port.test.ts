import { describe, expect, it, vi } from "vitest";

import { createChromeStoragePort } from "../../src/platform/chrome-storage-port";

function fakeArea(values: Record<string, unknown>, withGetKeys: boolean) {
  const get = vi.fn((keys: string[] | null) =>
    Promise.resolve(
      keys === null
        ? structuredClone(values)
        : Object.fromEntries(
            keys.filter((key) => key in values).map((key) => [key, structuredClone(values[key])]),
          ),
    ),
  );
  const getKeys = vi.fn(() => Promise.resolve(Object.keys(values)));
  const area = {
    get,
    set: vi.fn((input: Record<string, unknown>) => {
      Object.assign(values, structuredClone(input));
      return Promise.resolve();
    }),
    remove: vi.fn((keys: string[]) => {
      for (const key of keys) delete values[key];
      return Promise.resolve();
    }),
    ...(withGetKeys ? { getKeys } : {}),
  };
  return { area: area as unknown as chrome.storage.StorageArea, get, getKeys };
}

function values(): Record<string, unknown> {
  const entries: [string, unknown][] = ["d", "b", "a", "c", "e"].map((suffix) => [
    `p:${suffix}`,
    { big: "value" },
  ]);
  entries.push(["other", 1]);
  return Object.fromEntries(entries);
}

describe("createChromeStoragePort.listKeys", () => {
  it("lists through getKeys when the browser offers it and never reads the whole area", async () => {
    const { area, get, getKeys } = fakeArea(values(), true);
    const port = createChromeStoragePort(area);

    await expect(port.listKeys("p:", undefined, 2)).resolves.toEqual({
      keys: ["p:a", "p:b"],
      nextCursor: "p:b",
      complete: false,
    });
    await expect(port.listKeys("p:", "p:b", 2)).resolves.toEqual({
      keys: ["p:c", "p:d"],
      nextCursor: "p:d",
      complete: false,
    });
    await expect(port.listKeys("p:", "p:d", 2)).resolves.toEqual({ keys: ["p:e"], complete: true });
    expect(getKeys).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalledWith(null);
  });

  it("without getKeys reads the area once per scan, not once per page", async () => {
    const { area, get } = fakeArea(values(), false);
    const port = createChromeStoragePort(area);

    const first = await port.listKeys("p:", undefined, 2);
    expect(first).toEqual({ keys: ["p:a", "p:b"], nextCursor: "p:b", complete: false });
    // Keys removed mid-scan still page coherently from the scan's snapshot.
    await port.remove(["p:c"]);
    await expect(port.listKeys("p:", first.nextCursor, 2)).resolves.toEqual({
      keys: ["p:c", "p:d"],
      nextCursor: "p:d",
      complete: false,
    });
    await expect(port.listKeys("p:", "p:d", 2)).resolves.toEqual({ keys: ["p:e"], complete: true });
    expect(get.mock.calls.filter(([keys]) => keys === null)).toHaveLength(1);

    // A new scan takes a fresh snapshot.
    await expect(port.listKeys("p:", undefined, 10)).resolves.toEqual({
      keys: ["p:a", "p:b", "p:d", "p:e"],
      complete: true,
    });
    expect(get.mock.calls.filter(([keys]) => keys === null)).toHaveLength(2);
  });

  it("starts a fresh snapshot for a cursor under a different prefix", async () => {
    const { area, getKeys } = fakeArea({ ...values(), "q:a": 1, "q:b": 2 }, true);
    const port = createChromeStoragePort(area);
    await port.listKeys("p:", undefined, 2);
    await expect(port.listKeys("q:", "q:a", 2)).resolves.toEqual({ keys: ["q:b"], complete: true });
    expect(getKeys).toHaveBeenCalledTimes(2);
  });
});
