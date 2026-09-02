import { describe, expect, it } from "vitest";

import { GeneratePasswordRequestSchema, GeneratePasswordResponseSchema } from "../src/password-gen";

const randomRequest = {
  version: 1,
  kind: "password.generate",
  mode: "random",
  length: 20,
  uppercase: true,
  lowercase: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: true,
} as const;

const passphraseRequest = {
  version: 1,
  kind: "password.generate",
  mode: "passphrase",
  wordCount: 5,
  separator: "hyphen",
  capitalize: true,
} as const;

const minimalRequest = { version: 1, kind: "password.generate", mode: "random" } as const;

const response = {
  version: 1,
  kind: "password.generateResult",
  password: "Tr0ub4dor&3",
  entropyBits: 52.3,
} as const;

describe("password generation messaging", () => {
  it("accepts random and passphrase requests, including the minimal all-optional form", () => {
    for (const request of [randomRequest, passphraseRequest, minimalRequest]) {
      expect(GeneratePasswordRequestSchema.safeParse(request).success).toBe(true);
      expect(GeneratePasswordRequestSchema.safeParse({ ...request, extra: "nope" }).success).toBe(
        false,
      );
    }
  });

  it("rejects an invalid mode and out-of-range numeric fields", () => {
    expect(
      GeneratePasswordRequestSchema.safeParse({ ...minimalRequest, mode: "bogus" }).success,
    ).toBe(false);
    expect(GeneratePasswordRequestSchema.safeParse({ ...randomRequest, length: 7 }).success).toBe(
      false,
    );
    expect(GeneratePasswordRequestSchema.safeParse({ ...randomRequest, length: 129 }).success).toBe(
      false,
    );
    expect(
      GeneratePasswordRequestSchema.safeParse({ ...passphraseRequest, wordCount: 2 }).success,
    ).toBe(false);
    expect(
      GeneratePasswordRequestSchema.safeParse({ ...passphraseRequest, wordCount: 11 }).success,
    ).toBe(false);
    expect(
      GeneratePasswordRequestSchema.safeParse({ ...passphraseRequest, separator: "bogus" }).success,
    ).toBe(false);
  });

  it("accepts a well-formed generation result and rejects unknown fields or wrong types", () => {
    expect(GeneratePasswordResponseSchema.safeParse(response).success).toBe(true);
    expect(GeneratePasswordResponseSchema.safeParse({ ...response, extra: "nope" }).success).toBe(
      false,
    );
    expect(
      GeneratePasswordResponseSchema.safeParse({ ...response, entropyBits: "52" }).success,
    ).toBe(false);
    expect(GeneratePasswordResponseSchema.safeParse({ ...response, version: 2 }).success).toBe(
      false,
    );
  });
});
