import { describe, expect, it } from "vitest";

import { generateUsername, siteSlug } from "../src/username-generator";

describe("generateUsername", () => {
  it("makes word names with a number, capitalised on request", () => {
    expect(generateUsername({ kind: "word" }).username).toMatch(/^[a-z]+\.[a-z]+\d{2}$/u);
    expect(generateUsername({ kind: "word", number: false, capitalize: true }).username).toMatch(
      /^[A-Z][a-z]*\.[A-Z][a-z]*$/u,
    );
  });

  it("makes random names that start with a letter and bounds their length", () => {
    expect(generateUsername({ kind: "random" }).username).toMatch(/^[a-z][a-z0-9]{11}$/u);
    expect(() => generateUsername({ kind: "random", length: 3 })).toThrow(RangeError);
  });

  it("builds plus-addresses on the saved address, replacing an existing tag", () => {
    const plus = generateUsername({
      kind: "plus",
      email: "me+old@example.com",
      site: "shop.example.org",
    });
    expect(plus.username).toMatch(/^me\+example\d{4}@example\.com$/u);
    expect(generateUsername({ kind: "plus", email: "me@example.com" }).username).toMatch(
      /^me\+[a-z]+\d{4}@example\.com$/u,
    );
    expect(() => generateUsername({ kind: "plus", email: "not an address" })).toThrow(RangeError);
  });

  it("builds catch-all addresses on the saved domain", () => {
    expect(generateUsername({ kind: "catchall", domain: "@Mail.Example" }).username).toMatch(
      /^[a-z]+\.[a-z]+\d{2}@mail\.example$/u,
    );
    expect(
      generateUsername({
        kind: "catchall",
        domain: "mail.example",
        site: "https://a.b.example.com/x",
      }).username,
    ).toMatch(/^example\.\d{4}@mail\.example$/u);
    expect(() => generateUsername({ kind: "catchall", domain: "" })).toThrow(RangeError);
  });

  it("names a site by its registrable label", () => {
    expect(siteSlug("accounts.shop.example.co.uk")).toBe("example");
    expect(siteSlug("https://www.github.com/login")).toBe("github");
    expect(siteSlug("localhost")).toBe("localhost");
    expect(siteSlug("")).toBe("");
  });
});
