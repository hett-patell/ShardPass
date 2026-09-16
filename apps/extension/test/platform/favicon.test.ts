import { afterEach, describe, expect, it } from "vitest";

import { faviconUrl } from "../../src/platform/favicon";

const globalWithChrome = globalThis as { chrome?: unknown };

afterEach(() => {
  delete globalWithChrome.chrome;
});

describe("faviconUrl", () => {
  it("is nothing outside an extension page", () => {
    expect(faviconUrl("https://example.com")).toBeUndefined();
  });

  it("asks the browser's cache for the site's origin only, at the size wanted", () => {
    globalWithChrome.chrome = {
      runtime: { getURL: (path: string) => `chrome-extension://abcdefgh${path}` },
    };
    expect(faviconUrl("https://accounts.google.com/signin/v2?hl=en#x")).toBe(
      "chrome-extension://abcdefgh/_favicon/?pageUrl=https%3A%2F%2Faccounts.google.com&size=32",
    );
    expect(faviconUrl("example.org/login", 16)).toBe(
      "chrome-extension://abcdefgh/_favicon/?pageUrl=https%3A%2F%2Fexample.org&size=16",
    );
    expect(faviconUrl("ftp://example.org")).toBeUndefined();
    expect(faviconUrl("")).toBeUndefined();
    expect(faviconUrl(undefined)).toBeUndefined();
    expect(faviconUrl("not a url at all ://")).toBeUndefined();
  });
});
