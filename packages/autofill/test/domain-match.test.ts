import { describe, expect, it } from "vitest";

import { matchDomain, registrableDomain } from "../src/domain-match";

describe("matchDomain", () => {
  it("matches exact domain", () => {
    expect(matchDomain("github.com", ["github.com"])).toBe(true);
  });

  it("matches subdomain against registered domain", () => {
    expect(matchDomain("login.github.com", ["github.com"])).toBe(true);
  });

  it("rejects non-matching domain", () => {
    expect(matchDomain("evil.com", ["github.com"])).toBe(false);
  });

  it("matches URL with protocol stripped", () => {
    expect(matchDomain("github.com", ["https://github.com/login"])).toBe(true);
  });

  it("handles www prefix", () => {
    expect(matchDomain("www.github.com", ["github.com"])).toBe(true);
  });

  it("rejects partial domain match (no substring)", () => {
    expect(matchDomain("notgithub.com", ["github.com"])).toBe(false);
  });

  it("matches when both sides carry a port", () => {
    expect(matchDomain("localhost:5173", ["localhost:5173"])).toBe(true);
  });

  it("returns false for an empty candidate list", () => {
    expect(matchDomain("github.com", [])).toBe(false);
  });

  it("matches hosts that share a registrable domain", () => {
    expect(matchDomain("mail.google.com", ["https://accounts.google.com/signin"])).toBe(true);
    expect(matchDomain("accounts.google.com", ["mail.google.com"])).toBe(true);
  });

  it("keeps sites apart under a multi-label public suffix or a hosting suffix", () => {
    expect(matchDomain("example.co.uk", ["other.co.uk"])).toBe(false);
    expect(matchDomain("shop.example.co.uk", ["https://example.co.uk"])).toBe(true);
    expect(matchDomain("a.github.io", ["b.github.io"])).toBe(false);
    expect(matchDomain("docs.a.github.io", ["a.github.io"])).toBe(true);
  });
});

describe("registrableDomain", () => {
  it("reduces a host to its eTLD+1 with the built-in suffix list", () => {
    expect(registrableDomain("mail.google.com")).toBe("google.com");
    expect(registrableDomain("shop.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("a.github.io")).toBe("a.github.io");
    expect(registrableDomain("app.pages.dev")).toBe("app.pages.dev");
    expect(registrableDomain("localhost")).toBe("localhost");
    expect(registrableDomain("10.0.0.1")).toBe("10.0.0.1");
  });
});
