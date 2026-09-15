import { describe, expect, it } from "vitest";

import { matchLoginUrl, matchLoginUrls } from "../src";

describe("matchLoginUrl", () => {
  it("domain: registrable-domain match including subdomains", () => {
    expect(matchLoginUrl("https://login.example.test/x", "https://example.test", "domain")).toBe(
      true,
    );
    expect(matchLoginUrl("https://example.test", "https://www.example.test", "domain")).toBe(true);
    expect(matchLoginUrl("https://notexample.test", "https://example.test", "domain")).toBe(false);
  });

  it("host: the exact host only, subdomains excluded", () => {
    expect(
      matchLoginUrl("https://login.example.test", "https://login.example.test/a", "host"),
    ).toBe(true);
    expect(matchLoginUrl("https://other.example.test", "https://login.example.test", "host")).toBe(
      false,
    );
    expect(matchLoginUrl("https://example.test:8443", "https://example.test:8443", "host")).toBe(
      true,
    );
    expect(matchLoginUrl("https://example.test:8443", "https://example.test", "host")).toBe(false);
  });

  it("startsWith and exact compare the path, ignoring trailing slash and fragment", () => {
    expect(matchLoginUrl("https://e.test/app/login/", "https://e.test/app", "startsWith")).toBe(
      true,
    );
    expect(matchLoginUrl("https://e.test/other", "https://e.test/app", "startsWith")).toBe(false);
    expect(
      matchLoginUrl("https://e.test/app/login#top", "https://e.test/app/login/", "exact"),
    ).toBe(true);
    expect(matchLoginUrl("https://e.test/app/login/2", "https://e.test/app/login", "exact")).toBe(
      false,
    );
  });

  it("never excludes the URL from matching", () => {
    expect(matchLoginUrl("https://example.test", "https://example.test", "never")).toBe(false);
  });

  it("degrades path-sensitive modes to a host match when only a hostname is known", () => {
    expect(
      matchLoginUrl("login.example.test", "https://login.example.test/app/login", "exact"),
    ).toBe(true);
    expect(
      matchLoginUrl("other.example.test", "https://login.example.test/app", "startsWith"),
    ).toBe(false);
  });

  it("matchLoginUrls applies modes positionally and defaults to domain", () => {
    const urls = ["https://a.test", "https://b.test/only/here"];
    expect(matchLoginUrls("https://sub.a.test", urls)).toBe(true);
    expect(matchLoginUrls("https://b.test/elsewhere", urls, ["domain", "exact"])).toBe(false);
    expect(matchLoginUrls("https://b.test/only/here", urls, ["never", "exact"])).toBe(true);
    expect(matchLoginUrls("https://sub.a.test", urls, ["never", "exact"])).toBe(false);
  });

  it("startsWith stays on the saved host: a look-alike domain that begins with it does not match", () => {
    expect(matchLoginUrl("https://example.com/login", "https://example.com", "startsWith")).toBe(
      true,
    );
    expect(
      matchLoginUrl("https://example.com.evil.net/login", "https://example.com", "startsWith"),
    ).toBe(false);
    expect(
      matchLoginUrl("https://example.community/login", "https://example.com", "startsWith"),
    ).toBe(false);
  });
});
