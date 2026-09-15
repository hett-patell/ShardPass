import { MAX_OTP_AUTH_URI_LENGTH } from "@shardpass/otp";
import { describe, expect, it } from "vitest";

import { IMPORT_LIMITS, parseOtpAuthLines, parseOtpAuthUri } from "../src";

const SYNTHETIC_SECRET = "GEZDGNBVGY3TQOJQ";
const COMPLETE_BYTE_SECRET = "MY";
const uri = (
  path = "Account",
  query: readonly [string, string][] = [["secret", SYNTHETIC_SECRET]],
  authority = "totp",
) =>
  `otpauth://${authority}/${path}?${query
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&")}`;
const expectSafeFailure = (operation: () => unknown) => {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as Error).message).toMatch(/^IMPORT_(?:MALFORMED|UNSUPPORTED|LIMIT_EXCEEDED)$/u);
  expect((thrown as Error).message).not.toContain(SYNTHETIC_SECRET);
};

describe("strict otpauth import parsing", () => {
  it("applies TOTP defaults and canonicalizes a complete-byte Base32 secret", () => {
    expect(parseOtpAuthUri(uri("Account", [["secret", "my======"]]))).toEqual({
      issuer: "",
      label: "Account",
      secret: COMPLETE_BYTE_SECRET,
      otpType: "totp",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      favorite: false,
      tags: [],
      note: "",
    });
  });

  it("preserves UTF-8 issuer and colon-bearing label while keeping plus literal", () => {
    const parsed = parseOtpAuthUri(
      uri(encodeURIComponent("組織:account+primary:device"), [
        ["secret", SYNTHETIC_SECRET],
        ["issuer", "組織"],
      ]),
    );
    expect(parsed).toMatchObject({ issuer: "組織", label: "account+primary:device" });
  });

  it("accepts every digit count the vault generates, and an issuer spelled in another case", () => {
    expect(
      parseOtpAuthUri(
        uri("Site:me", [
          ["secret", SYNTHETIC_SECRET],
          ["digits", "7"],
        ]),
      ),
    ).toMatchObject({
      digits: 7,
    });
    expect(
      parseOtpAuthUri(
        uri("GitHub%3Aalice", [
          ["secret", SYNTHETIC_SECRET],
          ["issuer", "github"],
        ]),
      ),
    ).toMatchObject({ label: "alice" });
  });

  it("preserves supported algorithms, digits, periods, and HOTP boundary counters", () => {
    expect(
      parseOtpAuthUri(
        uri("Issuer%3AAccount", [
          ["secret", SYNTHETIC_SECRET],
          ["issuer", "Issuer"],
          ["algorithm", "SHA-512"],
          ["digits", "8"],
          ["period", "300"],
        ]),
      ),
    ).toMatchObject({ algorithm: "SHA512", digits: 8, period: 300 });

    for (const counter of [0, Number.MAX_SAFE_INTEGER]) {
      expect(
        parseOtpAuthUri(
          uri(
            "Account",
            [
              ["secret", SYNTHETIC_SECRET],
              ["algorithm", "SHA256"],
              ["digits", "8"],
              ["counter", String(counter)],
            ],
            "hotp",
          ),
        ),
      ).toMatchObject({ otpType: "hotp", algorithm: "SHA256", digits: 8, period: 0, counter });
    }
  });

  it("recognizes Steam through the issuer marker, the steam authority, encoder=steam and five digits", () => {
    const steam = { otpType: "steam", algorithm: "SHA1", digits: 5, period: 30 };
    expect(
      parseOtpAuthUri(
        uri("Steam%3AAccount", [
          ["secret", SYNTHETIC_SECRET],
          ["issuer", "Steam"],
        ]),
      ),
    ).toMatchObject({ issuer: "Steam", label: "Account", ...steam });

    // The steam authority, as the otp package and Aegis write it; the issuer defaults to Steam.
    expect(parseOtpAuthUri(uri("Account", undefined, "steam"))).toMatchObject({
      issuer: "Steam",
      label: "Account",
      ...steam,
    });
    // KeePassXC's spelling: a plain TOTP URI carrying encoder=steam under any issuer.
    expect(
      parseOtpAuthUri(
        uri("Valve%3AAccount", [
          ["secret", SYNTHETIC_SECRET],
          ["issuer", "Valve"],
          ["encoder", "steam"],
        ]),
      ),
    ).toMatchObject({ issuer: "Valve", label: "Account", ...steam });
    // Five digits are Steam's alone.
    expect(
      parseOtpAuthUri(
        uri("Account", [
          ["secret", SYNTHETIC_SECRET],
          ["digits", "5"],
        ]),
      ),
    ).toMatchObject({ issuer: "Steam", label: "Account", ...steam });

    expect(parseOtpAuthUri(uri("Steam%20account"))).toMatchObject({ otpType: "totp" });
    // Steam never uses eight digits or another hash; the strict shape still holds.
    expectSafeFailure(() =>
      parseOtpAuthUri(
        uri(
          "Account",
          [
            ["secret", SYNTHETIC_SECRET],
            ["digits", "8"],
          ],
          "steam",
        ),
      ),
    );
    expectSafeFailure(() =>
      parseOtpAuthUri(
        uri(
          "Account",
          [
            ["secret", SYNTHETIC_SECRET],
            ["algorithm", "SHA256"],
          ],
          "steam",
        ),
      ),
    );
  });

  it.each([
    ["scheme", () => uri().replace("otpauth:", "https:")],
    ["authority", () => uri("Account", undefined, "unknown")],
    ["credentials", () => uri().replace("otpauth://", "otpauth://user@")],
    ["port", () => uri().replace("totp/", "totp:443/")],
    ["fragment", () => `${uri()}#fragment`],
    ["missing label", () => `otpauth://totp/?secret=${SYNTHETIC_SECRET}`],
    ["missing secret", () => "otpauth://totp/Account"],
    ["line trailing text", () => `${uri()} trailing`],
    ["malformed path percent", () => `otpauth://totp/%E0%A4%A?secret=${SYNTHETIC_SECRET}`],
    ["malformed query percent", () => "otpauth://totp/Account?secret=%E0%A4%A"],
    ["query NUL", () => `otpauth://totp/Account?secret=${SYNTHETIC_SECRET}%00`],
    ["invalid Unicode scalar", () => `${uri()}\ud800`],
    ["invalid Base32 alphabet", () => uri("Account", [["secret", "M1"]])],
    ["incomplete Base32 byte", () => uri("Account", [["secret", "M"]])],
    ["noncanonical Base32 terminal bits", () => uri("Account", [["secret", "MZ"]])],
    [
      "issuer mismatch",
      () =>
        uri("First%3AAccount", [
          ["secret", SYNTHETIC_SECRET],
          ["issuer", "Second"],
        ]),
    ],
    ["empty issuer colon", () => uri("%3AAccount")],
  ])("rejects malformed URI structure without reflecting input: %s", (_case, build) => {
    expectSafeFailure(() => parseOtpAuthUri(build()));
  });

  it.each([
    ["secret", "secret"],
    ["issuer", "issuer"],
    ["algorithm", "algorithm"],
    ["digits", "digits"],
    ["period", "period"],
    ["counter", "counter"],
  ])("rejects duplicate query fields after case-sensitive key validation: %s", (_case, key) => {
    const pairs: [string, string][] = [["secret", SYNTHETIC_SECRET]];
    const fallback: Record<string, string> = {
      secret: SYNTHETIC_SECRET,
      issuer: "Issuer",
      algorithm: "SHA1",
      digits: "6",
      period: "30",
      counter: "0",
    };
    pairs.push([key, fallback[key]!], [key, fallback[key]!]);
    expectSafeFailure(() =>
      parseOtpAuthUri(uri("Account", pairs, key === "counter" ? "hotp" : "totp")),
    );
  });

  it.each<[string, [string, string]]>([
    ["critical extension", ["x-critical", "true"]],
    ["unsupported algorithm", ["algorithm", "MD5"]],
    ["unsupported digits", ["digits", "11"]],
    ["unsupported period zero", ["period", "0"]],
    ["unsupported period high", ["period", "301"]],
    ["TOTP counter", ["counter", "0"]],
  ])("rejects unsupported URI semantics without downgrade: %s", (_case, extra) => {
    expectSafeFailure(() => parseOtpAuthUri(uri("Account", [["secret", SYNTHETIC_SECRET], extra])));
  });

  it.each(["-1", "01", "1.5", String(Number.MAX_SAFE_INTEGER + 1)])(
    "rejects unsupported HOTP counter syntax",
    (counter) => {
      expectSafeFailure(() =>
        parseOtpAuthUri(
          uri(
            "Account",
            [
              ["secret", SYNTHETIC_SECRET],
              ["counter", counter],
            ],
            "hotp",
          ),
        ),
      );
    },
  );

  it("rejects absent HOTP counter and incompatible Steam parameters", () => {
    expectSafeFailure(() => parseOtpAuthUri(uri("Account", undefined, "hotp")));
    expectSafeFailure(() =>
      parseOtpAuthUri(
        uri("Steam%3AAccount", [
          ["secret", SYNTHETIC_SECRET],
          ["issuer", "Steam"],
          ["digits", "6"],
        ]),
      ),
    );
  });

  it("allows bounded unknown noncritical fields but rejects query confusion and excess fields", () => {
    expect(
      parseOtpAuthUri(
        uri("Account", [
          ["secret", SYNTHETIC_SECRET],
          ["image", "local"],
        ]),
      ).label,
    ).toBe("Account");
    expectSafeFailure(() => parseOtpAuthUri(`${uri()}&Secret=${SYNTHETIC_SECRET}`));
    const fields: [string, string][] = [["secret", SYNTHETIC_SECRET]];
    for (let index = 0; index < 32; index += 1) fields.push([`field${index}`, "value"]);
    expectSafeFailure(() => parseOtpAuthUri(uri("Account", fields)));
  });

  it("bounds an individual URI before URL parsing or percent decoding", () => {
    const prefix = `otpauth://totp/Account?secret=${SYNTHETIC_SECRET}&image=`;
    const exact = prefix + "a".repeat(MAX_OTP_AUTH_URI_LENGTH - prefix.length);
    expect(parseOtpAuthUri(exact).label).toBe("Account");
    expectSafeFailure(() => parseOtpAuthUri(`${exact}a`));

    const hugeEncoded = `otpauth://totp/${"%41".repeat(MAX_OTP_AUTH_URI_LENGTH)}?secret=${SYNTHETIC_SECRET}`;
    expectSafeFailure(() => parseOtpAuthUri(hugeEncoded));
  });
});

describe("bounded otpauth multiline parsing", () => {
  it("accepts blank lines and CRLF with deterministic source ordinals", () => {
    const first = uri("First");
    const second = uri("Second");
    expect(parseOtpAuthLines(`  \r\n${first}\r\n\t\r\n${second}\r\n`)).toEqual({
      format: "otpauth",
      candidates: [
        expect.objectContaining({ label: "First" }),
        expect.objectContaining({ label: "Second" }),
      ],
      rejected: [],
    });
  });

  it("keeps one malformed or unsupported row from aborting bounded siblings", () => {
    const parsed = parseOtpAuthLines(
      [
        uri("First"),
        "otpauth://totp/Broken",
        uri("Third", [
          ["secret", SYNTHETIC_SECRET],
          ["digits", "11"],
        ]),
        uri("Fourth"),
      ].join("\n"),
    );
    expect(parsed.candidates.map(({ label }) => label)).toEqual(["First", "Fourth"]);
    expect(parsed.rejected).toEqual([
      { ordinal: 2, reason: "IMPORT_MALFORMED" },
      { ordinal: 3, reason: "IMPORT_UNSUPPORTED" },
    ]);
  });

  it("rejects all-whitespace input and classifies BOM, padding, and NUL confusion as malformed rows", () => {
    for (const text of ["", "   \r\n\t"]) expectSafeFailure(() => parseOtpAuthLines(text));
    for (const text of [`\ufeff${uri()}`, ` ${uri()}`, `${uri()} `, `${uri()}\0`]) {
      expect(parseOtpAuthLines(text)).toEqual({
        format: "otpauth",
        candidates: [],
        rejected: [{ ordinal: 1, reason: "IMPORT_MALFORMED" }],
      });
    }
  });

  it("does not confuse Google migration URLs, JSON, or prose with otpauth lines", () => {
    for (const text of [
      "otpauth-migration://offline?data=synthetic",
      '{"type":"totp"}',
      `prefix ${uri()}`,
    ]) {
      expect(parseOtpAuthLines(text).rejected).toEqual([
        { ordinal: 1, reason: "IMPORT_MALFORMED" },
      ]);
    }
  });

  it("accepts exact aggregate byte, scalar, entry, and line boundaries and rejects one over", () => {
    const shortUri = uri("A", [["secret", COMPLETE_BYTE_SECRET]]);
    const entries = Array.from({ length: IMPORT_LIMITS.maxEntries }, () => shortUri).join("\n");
    expect(parseOtpAuthLines(entries).candidates).toHaveLength(IMPORT_LIMITS.maxEntries);
    expectSafeFailure(() => parseOtpAuthLines(`${entries}\n${shortUri}`));

    const buildSizedInput = (size: number) => {
      const linePrefix = `otpauth://totp/A?secret=${COMPLETE_BYTE_SECRET}&image=`;
      const newlineBytes = IMPORT_LIMITS.maxEntries - 1;
      const payloadBytes = size - newlineBytes - linePrefix.length * IMPORT_LIMITS.maxEntries;
      const basePayload = Math.floor(payloadBytes / IMPORT_LIMITS.maxEntries);
      const extra = payloadBytes % IMPORT_LIMITS.maxEntries;
      return Array.from(
        { length: IMPORT_LIMITS.maxEntries },
        (_, index) => linePrefix + "a".repeat(basePayload + (index < extra ? 1 : 0)),
      ).join("\n");
    };
    const exactBytes = buildSizedInput(IMPORT_LIMITS.maxInputBytes);
    expect(new TextEncoder().encode(exactBytes)).toHaveLength(IMPORT_LIMITS.maxInputBytes);
    expectSafeFailure(() => parseOtpAuthLines(exactBytes));
    expectSafeFailure(() => parseOtpAuthLines(`${exactBytes}a`));

    const exactScalars = buildSizedInput(IMPORT_LIMITS.maxTextScalars);
    expect(Array.from(exactScalars)).toHaveLength(IMPORT_LIMITS.maxTextScalars);
    expect(parseOtpAuthLines(exactScalars).candidates).toHaveLength(IMPORT_LIMITS.maxEntries);
    expectSafeFailure(() => parseOtpAuthLines(`${exactScalars}a`));
  });
});
