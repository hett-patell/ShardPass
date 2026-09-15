import type { GeneratePasswordRequest, PasswordGenResponse } from "@shardpass/messaging";
import { GeneratePasswordResponseSchema } from "@shardpass/messaging";
import { FakeStoragePort } from "@shardpass/testing/fake-storage-port";
import { describe, expect, it } from "vitest";

import {
  PasswordGenService,
  PasswordGenServiceError,
} from "../../src/background/password/password-gen-service";

function request(values: Record<string, unknown> = {}): GeneratePasswordRequest {
  return { version: 1, kind: "password.generate", mode: "random", ...values };
}

/** The password of a generate result; any other reply fails the test. */
function generated(result: PasswordGenResponse): { password: string; entropyBits: number } {
  if (result.kind !== "password.generateResult") throw new Error(`unexpected ${result.kind}`);
  return result;
}

describe("PasswordGenService", () => {
  it("generates a random password honoring length and character-class options", async () => {
    const service = new PasswordGenService();
    const result = generated(
      await service.handle(
        request({
          length: 24,
          uppercase: true,
          lowercase: true,
          digits: true,
          symbols: true,
          excludeAmbiguous: true,
        }),
      ),
    );
    expect(result.password).toHaveLength(24);
    expect(result.entropyBits).toBeGreaterThan(0);
    expect(GeneratePasswordResponseSchema.safeParse(result).success).toBe(true);
  });

  it("generates a random password using library defaults when options are omitted", async () => {
    const service = new PasswordGenService();
    const result = generated(await service.handle(request()));
    expect(result.password).toHaveLength(20);
  });

  it("generates a passphrase honoring word count, separator, and capitalization", async () => {
    const service = new PasswordGenService();
    const result = generated(
      await service.handle(
        request({ mode: "passphrase", wordCount: 5, separator: "period", capitalize: true }),
      ),
    );
    const words = result.password.split(".");
    expect(words).toHaveLength(5);
    for (const word of words) expect(word[0]).toBe(word[0]!.toUpperCase());
  });

  it("generates a passphrase using library defaults when options are omitted", async () => {
    const service = new PasswordGenService();
    const result = generated(await service.handle(request({ mode: "passphrase" })));
    expect(result.password.split("-")).toHaveLength(4);
  });

  it("returns a fresh, frozen response on each call", async () => {
    const service = new PasswordGenService();
    const first = generated(await service.handle(request()));
    const second = generated(await service.handle(request()));
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.password).not.toBe(second.password);
  });

  it("rejects an invalid mode before generation", async () => {
    const service = new PasswordGenService();
    await expect(service.handle(request({ mode: "bogus" }))).rejects.toBeInstanceOf(
      PasswordGenServiceError,
    );
    await expect(service.handle(request({ mode: "bogus" }))).rejects.toMatchObject({
      code: "PASSWORD_GEN_INVALID",
    });
  });

  it("rejects out-of-range numeric options before generation", async () => {
    const service = new PasswordGenService();
    await expect(service.handle(request({ length: 7 }))).rejects.toMatchObject({
      code: "PASSWORD_GEN_INVALID",
    });
    await expect(service.handle(request({ length: 129 }))).rejects.toMatchObject({
      code: "PASSWORD_GEN_INVALID",
    });
  });

  it("rejects a random request with every character class disabled", async () => {
    const service = new PasswordGenService();
    await expect(
      service.handle(
        request({ uppercase: false, lowercase: false, digits: false, symbols: false }),
      ),
    ).rejects.toMatchObject({ code: "PASSWORD_GEN_INVALID" });
  });
});

describe("PasswordGenService usernames", () => {
  it("generates word, random, plus and catch-all names from the saved settings", async () => {
    const local = new FakeStoragePort();
    const service = new PasswordGenService({ local });
    const word = await service.handle({
      version: 1,
      kind: "password.generateUsername",
      usernameKind: "word",
    });
    expect(word).toMatchObject({ kind: "password.generateUsernameResult" });
    if (word.kind !== "password.generateUsernameResult") throw new Error("kind");
    expect(word.username).toMatch(/^[a-z]+\.[a-z]+\d{2}$/u);
    expect(word.entropyBits).toBeGreaterThan(25);

    const random = await service.handle({
      version: 1,
      kind: "password.generateUsername",
      usernameKind: "random",
      length: 10,
    });
    if (random.kind !== "password.generateUsernameResult") throw new Error("kind");
    expect(random.username).toMatch(/^[a-z][a-z0-9]{9}$/u);

    await expect(
      service.handle({ version: 1, kind: "password.generateUsername", usernameKind: "plus" }),
    ).rejects.toMatchObject({ code: "PASSWORD_GEN_INVALID" });

    const saved = await service.handle({
      version: 1,
      kind: "password.setGeneratorSettings",
      email: " me+old@example.com ",
      domain: "mail.example",
    });
    expect(saved).toEqual({
      version: 1,
      kind: "password.generatorSettings",
      email: "me+old@example.com",
      domain: "mail.example",
    });
    expect(await service.handle({ version: 1, kind: "password.getGeneratorSettings" })).toEqual(
      saved,
    );

    const plus = await service.handle({
      version: 1,
      kind: "password.generateUsername",
      usernameKind: "plus",
      site: "accounts.shop.example.co.uk",
    });
    if (plus.kind !== "password.generateUsernameResult") throw new Error("kind");
    expect(plus.username).toMatch(/^me\+example\d{4}@example\.com$/u);

    const catchall = await service.handle({
      version: 1,
      kind: "password.generateUsername",
      usernameKind: "catchall",
    });
    if (catchall.kind !== "password.generateUsernameResult") throw new Error("kind");
    expect(catchall.username).toMatch(/^[a-z]+\.[a-z]+\d{2}@mail\.example$/u);
  });

  it("suggests for a site from what is configured, and never throws", async () => {
    const local = new FakeStoragePort();
    const service = new PasswordGenService({ local });
    expect(await service.suggestForSite("example.test")).toMatch(/^[a-z]+\.[a-z]+\d{2}$/u);
    await service.handle({
      version: 1,
      kind: "password.setGeneratorSettings",
      email: "",
      domain: "all.example",
    });
    expect(await service.suggestForSite("www.example.test")).toMatch(
      /^example\.\d{4}@all\.example$/u,
    );
    await service.handle({
      version: 1,
      kind: "password.setGeneratorSettings",
      email: "me@example.com",
      domain: "all.example",
    });
    expect(await service.suggestForSite("example.test")).toMatch(
      /^me\+example\d{4}@example\.com$/u,
    );
  });
});
