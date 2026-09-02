import type { GeneratePasswordRequest } from "@shardpass/messaging";
import { GeneratePasswordResponseSchema } from "@shardpass/messaging";
import { describe, expect, it } from "vitest";

import {
  PasswordGenService,
  PasswordGenServiceError,
} from "../../src/background/password/password-gen-service";

function request(values: Record<string, unknown> = {}): GeneratePasswordRequest {
  return { version: 1, kind: "password.generate", mode: "random", ...values };
}

describe("PasswordGenService", () => {
  it("generates a random password honoring length and character-class options", async () => {
    const service = new PasswordGenService();
    const result = await service.handle(
      request({
        length: 24,
        uppercase: true,
        lowercase: true,
        digits: true,
        symbols: true,
        excludeAmbiguous: true,
      }),
    );
    expect(result.kind).toBe("password.generateResult");
    expect(result.password).toHaveLength(24);
    expect(result.entropyBits).toBeGreaterThan(0);
    expect(GeneratePasswordResponseSchema.safeParse(result).success).toBe(true);
  });

  it("generates a random password using library defaults when options are omitted", async () => {
    const service = new PasswordGenService();
    const result = await service.handle(request());
    expect(result.password).toHaveLength(20);
  });

  it("generates a passphrase honoring word count, separator, and capitalization", async () => {
    const service = new PasswordGenService();
    const result = await service.handle(
      request({ mode: "passphrase", wordCount: 5, separator: "period", capitalize: true }),
    );
    expect(result.kind).toBe("password.generateResult");
    const words = result.password.split(".");
    expect(words).toHaveLength(5);
    for (const word of words) expect(word[0]).toBe(word[0]!.toUpperCase());
  });

  it("generates a passphrase using library defaults when options are omitted", async () => {
    const service = new PasswordGenService();
    const result = await service.handle(request({ mode: "passphrase" }));
    expect(result.password.split("-")).toHaveLength(4);
  });

  it("returns a fresh, frozen response on each call", async () => {
    const service = new PasswordGenService();
    const first = await service.handle(request());
    const second = await service.handle(request());
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.password).not.toBe(second.password);
  });

  it("rejects an invalid mode before generation", async () => {
    const service = new PasswordGenService();
    await expect(
      service.handle(request({ mode: "bogus" })),
    ).rejects.toBeInstanceOf(PasswordGenServiceError);
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
