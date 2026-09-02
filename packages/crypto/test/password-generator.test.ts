import { describe, expect, it } from "vitest";

import {
  generatePassphrase,
  generateRandomPassword,
  type PassphraseSeparator,
} from "../src/password-generator";
import { EFF_WORDLIST } from "../src/wordlist";

describe("generateRandomPassword", () => {
  it("produces a password of the requested length", () => {
    const { password } = generateRandomPassword({ length: 20 });
    expect(password).toHaveLength(20);
  });

  it("defaults to a 20-character password with letters and digits when no options are given", () => {
    const { password } = generateRandomPassword();
    expect(password).toHaveLength(20);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).not.toMatch(/[^A-Za-z0-9]/);
  });

  it("includes at least one char from each enabled class", () => {
    const { password } = generateRandomPassword({
      length: 20,
      uppercase: true,
      lowercase: true,
      digits: true,
      symbols: true,
    });
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).toMatch(/[^A-Za-z0-9]/);
  });

  it("includes at least one char from each enabled class across many trials", () => {
    for (let trial = 0; trial < 50; trial++) {
      const { password } = generateRandomPassword({
        length: 10,
        uppercase: true,
        lowercase: true,
        digits: true,
        symbols: true,
      });
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[^A-Za-z0-9]/);
    }
  });

  it("only uses characters from disabled-aware pool (symbols only)", () => {
    const { password } = generateRandomPassword({
      length: 20,
      uppercase: false,
      lowercase: false,
      digits: false,
      symbols: true,
    });
    expect(password).toMatch(/^[!@#$%^&*()\-_=+[\]{}|;:,.<>?]+$/);
  });

  it("excludes ambiguous characters when requested", () => {
    const { password } = generateRandomPassword({
      length: 100,
      excludeAmbiguous: true,
      uppercase: true,
      lowercase: true,
      digits: true,
    });
    expect(password).not.toMatch(/[0OIl1]/);
  });

  it("does not exclude ambiguous characters by default over many trials", () => {
    // Statistical check: with excludeAmbiguous unset (false) and a large pool
    // of long passwords, at least one ambiguous character should appear.
    const passwords = Array.from(
      { length: 30 },
      () => generateRandomPassword({ length: 50 }).password,
    );
    expect(passwords.some((password) => /[0O1l]/.test(password))).toBe(true);
  });

  it("reports entropy bits", () => {
    const { entropyBits } = generateRandomPassword({ length: 20 });
    expect(entropyBits).toBeGreaterThan(0);
  });

  it("computes entropy from the enabled pool size and length", () => {
    // uppercase + lowercase + digits (no ambiguous exclusion): 26+26+10 = 62
    const { entropyBits } = generateRandomPassword({
      length: 20,
      uppercase: true,
      lowercase: true,
      digits: true,
      symbols: false,
    });
    expect(entropyBits).toBe(Math.floor(20 * Math.log2(62)));
  });

  it("rejects length below 8", () => {
    expect(() => generateRandomPassword({ length: 7 })).toThrow();
  });

  it("accepts the minimum length of 8", () => {
    const { password } = generateRandomPassword({ length: 8 });
    expect(password).toHaveLength(8);
  });

  it("accepts the maximum length of 128", () => {
    const { password } = generateRandomPassword({ length: 128 });
    expect(password).toHaveLength(128);
  });

  it("rejects length above 128", () => {
    expect(() => generateRandomPassword({ length: 129 })).toThrow();
  });

  it("rejects a non-integer length", () => {
    expect(() => generateRandomPassword({ length: 12.5 })).toThrow();
  });

  it("rejects when every character class is disabled", () => {
    expect(() =>
      generateRandomPassword({ uppercase: false, lowercase: false, digits: false, symbols: false }),
    ).toThrow();
  });

  it("handles the minimum length with every class enabled", () => {
    // length (8) always covers the max possible enabled class count (4).
    const { password } = generateRandomPassword({
      length: 8,
      uppercase: true,
      lowercase: true,
      digits: true,
      symbols: true,
    });
    expect(password).toHaveLength(8);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).toMatch(/[^A-Za-z0-9]/);
  });

  it("generates different passwords across calls", () => {
    const passwords = new Set(
      Array.from({ length: 20 }, () => generateRandomPassword({ length: 20 }).password),
    );
    expect(passwords.size).toBeGreaterThan(1);
  });
});

describe("generatePassphrase", () => {
  it("produces the requested number of words", () => {
    const { password } = generatePassphrase({ wordCount: 4, separator: "hyphen" });
    expect(password.split("-")).toHaveLength(4);
  });

  it("defaults to 4 words with a hyphen separator", () => {
    const { password } = generatePassphrase();
    expect(password.split("-")).toHaveLength(4);
  });

  it("capitalizes first letter when requested", () => {
    const { password } = generatePassphrase({
      wordCount: 4,
      separator: "hyphen",
      capitalize: true,
    });
    for (const word of password.split("-")) {
      expect(word[0]).toBe(word[0]?.toUpperCase());
    }
  });

  it("does not capitalize by default", () => {
    const { password } = generatePassphrase({ wordCount: 4, separator: "hyphen" });
    // Statistically implausible for all four EFF words to already start with
    // an uppercase-looking letter — the wordlist is entirely lowercase.
    expect(password).toBe(password.toLowerCase());
  });

  it.each<[PassphraseSeparator, string]>([
    ["hyphen", "-"],
    ["space", " "],
    ["period", "."],
    ["none", ""],
  ])("joins words with the %s separator", (separator, expected) => {
    const { password } = generatePassphrase({ wordCount: 5, separator });
    if (expected === "") {
      expect(password).not.toMatch(/[-. ]/);
    } else {
      expect(password.split(expected)).toHaveLength(5);
    }
  });

  it("draws every word from the EFF wordlist", () => {
    const { password } = generatePassphrase({ wordCount: 6, separator: "space" });
    for (const word of password.split(" ")) {
      expect(EFF_WORDLIST).toContain(word);
    }
  });

  it("reports entropy bits", () => {
    const { entropyBits } = generatePassphrase({ wordCount: 4 });
    expect(entropyBits).toBeGreaterThan(50);
  });

  it("computes entropy from word count and wordlist size", () => {
    const { entropyBits } = generatePassphrase({ wordCount: 6 });
    expect(entropyBits).toBe(Math.floor(6 * Math.log2(EFF_WORDLIST.length)));
  });

  it("rejects word count below 3", () => {
    expect(() => generatePassphrase({ wordCount: 2 })).toThrow();
  });

  it("rejects word count above 10", () => {
    expect(() => generatePassphrase({ wordCount: 11 })).toThrow();
  });

  it("accepts the minimum word count of 3", () => {
    const { password } = generatePassphrase({ wordCount: 3, separator: "space" });
    expect(password.split(" ")).toHaveLength(3);
  });

  it("accepts the maximum word count of 10", () => {
    const { password } = generatePassphrase({ wordCount: 10, separator: "space" });
    expect(password.split(" ")).toHaveLength(10);
  });

  it("generates different passphrases across calls", () => {
    const passphrases = new Set(
      Array.from({ length: 20 }, () => generatePassphrase({ wordCount: 6 }).password),
    );
    expect(passphrases.size).toBeGreaterThan(1);
  });
});

describe("EFF_WORDLIST", () => {
  it("contains exactly 7776 (6^5) diceware words", () => {
    expect(EFF_WORDLIST).toHaveLength(7776);
  });

  it("contains only unique, non-empty lowercase words", () => {
    const unique = new Set(EFF_WORDLIST);
    expect(unique.size).toBe(EFF_WORDLIST.length);
    for (const word of EFF_WORDLIST) {
      expect(word.length).toBeGreaterThan(0);
      expect(word).toBe(word.toLowerCase());
    }
  });
});
