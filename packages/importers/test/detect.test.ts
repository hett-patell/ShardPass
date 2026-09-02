import { describe, expect, it } from "vitest";

import { IMPORT_LIMITS, parseOtpImportText } from "../src";

const migrationUri =
  "otpauth-migration://offline?data=CiwKFDEyMzQ1Njc4OTAxMjM0NTY3ODkwEgVhbGljZRoHRXhhbXBsZSABKAEwAhABGAEoBw%3D%3D";
const secret = "GEZDGNBVGY3TQOJQ";
const uri = `otpauth://totp/Account?secret=${secret}`;
const aegis = JSON.stringify({
  version: 1,
  header: { slots: null, params: null },
  db: { version: 3, entries: [], groups: [], icons_optimized: true },
});
const ente = JSON.stringify({
  version: 1,
  kdfParams: { memLimit: 4096, opsLimit: 3, salt: "salt" },
  encryptedData: "data",
  encryptionNonce: "nonce",
});
const fixedFailure = (text: string, code?: string) => {
  let thrown: unknown;
  try {
    parseOtpImportText(text);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as Error).message).toMatch(/^IMPORT_(?:MALFORMED|UNSUPPORTED|LIMIT_EXCEEDED)$/u);
  if (code !== undefined) expect((thrown as Error).message).toBe(code);
  expect((thrown as Error).message).not.toContain(secret);
};

describe("deterministic OTP import text detection", () => {
  it("routes Google migration away from the synchronous detector before other formats", () => {
    fixedFailure(migrationUri, "IMPORT_UNSUPPORTED");
  });

  it("detects multiline otpauth before JSON formats", () => {
    expect(parseOtpImportText(`${uri}\n${uri}`).format).toBe("otpauth");
  });

  it("detects exact Aegis and recognizes documented Ente wrappers independent of order", () => {
    expect(parseOtpImportText(aegis).format).toBe("aegis");
    fixedFailure(ente, "IMPORT_UNSUPPORTED");
    fixedFailure(
      JSON.stringify({
        encryptionNonce: "nonce",
        encryptedData: "data",
        kdfParams: { salt: "salt", opsLimit: 3, memLimit: 4096 },
        version: 1,
      }),
      "IMPORT_UNSUPPORTED",
    );
  });

  it("does not fall back after a partial Aegis or Ente discriminator match", () => {
    fixedFailure(
      JSON.stringify({
        version: 1,
        header: { slots: null, params: null },
        db: { version: 2, entries: [] },
        format: "ente-auth-export",
        entries: [],
      }),
      "IMPORT_UNSUPPORTED",
    );
    fixedFailure(
      JSON.stringify({
        version: 1,
        kdfParams: { memLimit: 4096, opsLimit: 3, salt: "salt" },
        encryptedData: "data",
        encryptionNonce: "nonce",
        header: { slots: null, params: null },
        db: { version: 3, entries: [], groups: [] },
      }),
      "IMPORT_UNSUPPORTED",
    );
  });

  it.each([
    ["arbitrary JSON", JSON.stringify({ entries: [{ secret }] })],
    ["ambiguous generic version", JSON.stringify({ version: 1, entries: [] })],
    ["prose", `Import this ${uri}`],
    ["trailing JSON", `${ente} trailing`],
    ["empty", "  \n"],
  ])("rejects %s without heuristic scraping", (_name, text) => fixedFailure(text));

  it("rejects duplicate security-relevant keys rather than accepting JSON.parse last-wins", () => {
    fixedFailure(
      '{"format":"ente-auth-export","version":1,"version":2,"entries":[]}',
      "IMPORT_MALFORMED",
    );
    fixedFailure(
      '{"version":1,"header":{"slots":null,"slots":[],"params":null},"db":{"version":3,"entries":[],"groups":[]}}',
      "IMPORT_MALFORMED",
    );
  });

  it.each(["__proto__", "constructor", "prototype"])("rejects dangerous object key %s", (key) => {
    fixedFailure(
      `{"format":"ente-auth-export","version":1,"entries":[],"${key}":{}}`,
      "IMPORT_MALFORMED",
    );
  });

  it("rejects deep, wide, long-string, unsafe-number, NUL, and Unicode-scalar inputs", () => {
    fixedFailure(`${"[".repeat(65)}0${"]".repeat(65)}`, "IMPORT_LIMIT_EXCEEDED");
    fixedFailure(
      JSON.stringify({
        format: "ente-auth-export",
        version: 1,
        entries: [],
        wide: Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`k${index}`, index])),
      }),
      "IMPORT_LIMIT_EXCEEDED",
    );
    fixedFailure(
      JSON.stringify({
        format: "ente-auth-export",
        version: 1,
        entries: [],
        value: "x".repeat(4097),
      }),
      "IMPORT_LIMIT_EXCEEDED",
    );
    fixedFailure(
      JSON.stringify({
        format: "ente-auth-export",
        version: 1,
        entries: [],
        value: Number.MAX_SAFE_INTEGER + 1,
      }),
      "IMPORT_UNSUPPORTED",
    );
    fixedFailure(
      '{"format":"ente-auth-export","version":1,"entries":[],"value":"\\u0000"}',
      "IMPORT_MALFORMED",
    );
    fixedFailure(`${ente}\ud800`, "IMPORT_MALFORMED");
  });

  it("runs shared input preflight before allocating line splits", () => {
    const descriptor = Object.getOwnPropertyDescriptor(String.prototype, "split")!;
    const split = descriptor.value as (separator: string | RegExp, limit?: number) => string[];
    const original = (value: string, separator: string | RegExp, limit?: number) =>
      Reflect.apply(split, value, [separator, limit]);
    let calls = 0;
    Object.defineProperty(String.prototype, "split", {
      ...descriptor,
      value(this: string, separator: string | RegExp, limit?: number) {
        calls += 1;
        return original(this, separator, limit);
      },
    });
    try {
      fixedFailure("x".repeat(IMPORT_LIMITS.maxTextScalars + 1), "IMPORT_LIMIT_EXCEEDED");
      expect(calls).toBe(0);
    } finally {
      Object.defineProperty(String.prototype, "split", descriptor);
    }
  });

  it("enforces encoded UTF-8 bytes and Unicode scalar limits before JSON parsing", () => {
    fixedFailure(
      ` ${"é".repeat(Math.floor(IMPORT_LIMITS.maxInputBytes / 2) + 1)}`,
      "IMPORT_LIMIT_EXCEEDED",
    );
    fixedFailure("x".repeat(IMPORT_LIMITS.maxTextScalars + 1), "IMPORT_LIMIT_EXCEEDED");
  });
});
