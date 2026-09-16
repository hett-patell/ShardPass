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

describe("matchLoginUrl and the page's scheme", () => {
  it("keeps a login saved for https off a plain-http page of the same name", () => {
    const saved = "https://bank.example.test";
    expect(matchLoginUrl("http://bank.example.test/login", saved, "domain")).toBe(false);
    expect(matchLoginUrl("http://bank.example.test/login", saved, "host")).toBe(false);
    expect(matchLoginUrl("http://bank.example.test/login", "bank.example.test", "domain")).toBe(
      false,
    );
  });

  it("still matches a site saved as http, a loopback host, and an https page", () => {
    expect(matchLoginUrl("http://intranet.test/login", "http://intranet.test", "domain")).toBe(
      true,
    );
    expect(matchLoginUrl("http://localhost:3000/login", "https://localhost:3000", "host")).toBe(
      true,
    );
    expect(
      matchLoginUrl("https://bank.example.test/login", "http://bank.example.test", "domain"),
    ).toBe(true);
  });

  it("startsWith stops at a path boundary", () => {
    const saved = "https://example.test/app";
    expect(matchLoginUrl("https://example.test/app/home", saved, "startsWith")).toBe(true);
    expect(matchLoginUrl("https://example.test/app?x=1", saved, "startsWith")).toBe(true);
    expect(matchLoginUrl("https://example.test/application", saved, "startsWith")).toBe(false);
  });
});
