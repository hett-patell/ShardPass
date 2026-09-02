import { describe, expect, it } from "vitest";

import { matchDomain } from "../src/domain-match";

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
});
