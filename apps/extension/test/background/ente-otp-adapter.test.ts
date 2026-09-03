import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createEnteSodiumAdapter,
  type EnteSodiumAdapter,
} from "../../src/background/ente/sodium-adapter";
import {
  encryptEnteOtpEntity,
  parseEnteOtpEntity,
  projectionFromEnteUri,
  projectionToEnteUri,
} from "../../src/background/ente/otp-adapter";

let sodium: EnteSodiumAdapter;
beforeAll(async () => {
  sodium = await createEnteSodiumAdapter();
});
afterAll(() => sodium.dispose());

const projections = [
  {
    version: 1,
    kind: "otp",
    otpType: "totp",
    issuer: "Issuer",
    label: "alice",
    secretBase32: "JBSWY3DPEHPK3PXP",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  },
  {
    version: 1,
    kind: "otp",
    otpType: "hotp",
    issuer: "Issuer",
    label: "counter",
    secretBase32: "JBSWY3DPEHPK3PXP",
    algorithm: "SHA256",
    digits: 8,
    counter: 7,
  },
  {
    version: 1,
    kind: "otp",
    otpType: "steam",
    issuer: "Steam",
    label: "player",
    secretBase32: "JBSWY3DPEHPK3PXP",
    algorithm: "SHA1",
    digits: 5,
    period: 30,
  },
  {
    version: 1,
    kind: "otp",
    otpType: "totp",
    issuer: "Ünïcode Co",
    label: "a:b c@example.test",
    secretBase32: "JBSWY3DPEHPK3PXP",
    algorithm: "SHA512",
    digits: 7,
    period: 60,
    notes: "recovery in the safe",
    tags: ["work", "2fa"],
  },
] as const;

const frame = (text: string, key: Uint8Array) => {
  const plaintext = new TextEncoder().encode(text);
  try {
    return { version: 1 as const, ...sodium.encryptAuthEntity(plaintext, key) };
  } finally {
    plaintext.fill(0);
  }
};

describe("Ente entity codec", () => {
  it.each(projections)("round-trips a $otpType projection through Ente's URI dialect", (projection) => {
    const key = sodium.randomBytes(32);
    const encrypted = encryptEnteOtpEntity(projection, key, sodium);
    expect(parseEnteOtpEntity({ version: 1, ...encrypted }, key, sodium)).toEqual(projection);
  });

  it("writes the URI shape the Ente Auth app reads", () => {
    const uri = projectionToEnteUri(projections[3]);
    const url = new URL(uri);
    expect(url.protocol).toBe("otpauth:");
    expect(url.host).toBe("totp");
    expect(decodeURIComponent(url.pathname)).toBe("/Ünïcode Co:a:b c@example.test");
    expect(url.searchParams.get("secret")).toBe("JBSWY3DPEHPK3PXP");
    expect(url.searchParams.get("issuer")).toBe("Ünïcode Co");
    expect(url.searchParams.get("algorithm")).toBe("sha512");
    expect(url.searchParams.get("digits")).toBe("7");
    expect(url.searchParams.get("period")).toBe("60");
    expect(JSON.parse(url.searchParams.get("codeDisplay") ?? "{}")).toEqual({
      note: "recovery in the safe",
      tags: ["work", "2fa"],
    });
  });

  it("omits defaults the way the app does", () => {
    const url = new URL(projectionToEnteUri(projections[0]));
    expect(url.searchParams.has("algorithm")).toBe(false);
    expect(url.searchParams.has("digits")).toBe(false);
    expect(url.searchParams.has("period")).toBe(false);
    expect(url.searchParams.has("codeDisplay")).toBe(false);
  });

  it("writes the URI as a JSON string, which is what the app stores", () => {
    const key = sodium.randomBytes(32);
    const encrypted = encryptEnteOtpEntity(projections[0], key, sodium);
    const plaintext = new TextDecoder().decode(sodium.decryptAuthEntity(encrypted, key));
    expect(plaintext.startsWith('"otpauth://totp/')).toBe(true);
    expect(typeof JSON.parse(plaintext)).toBe("string");
  });

  it("reads a URI as the Ente Auth app writes it (a JSON string)", () => {
    const key = sodium.randomBytes(32);
    const parsed = parseEnteOtpEntity(
      frame(
        JSON.stringify(
          "otpauth://totp/GitHub:octocat?secret=jbsw%20y3dp-ehpk3pxp&issuer=GitHub&algorithm=SHA1&digits=6&period=30",
        ),
        key,
      ),
      key,
      sodium,
    );
    expect(parsed).toEqual({
      version: 1,
      kind: "otp",
      otpType: "totp",
      issuer: "GitHub",
      label: "octocat",
      secretBase32: "JBSWY3DPEHPK3PXP",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });
  });

  it("handles the app's known quirks", () => {
    // Type in the path rather than the host.
    expect(projectionFromEnteUri("otpauth:////totp/Acme:bob?secret=JBSWY3DPEHPK3PXP")).toMatchObject({
      otpType: "totp",
      issuer: "Acme",
      label: "bob",
    });
    // Issuer with the historical "period" suffix.
    expect(
      projectionFromEnteUri("otpauth://totp/bob?secret=JBSWY3DPEHPK3PXP&issuer=Acmeperiod"),
    ).toMatchObject({ issuer: "Acme" });
    // Issuer taken from a hyphenated path when no issuer parameter exists.
    expect(projectionFromEnteUri("otpauth://totp/Acme-bob?secret=JBSWY3DPEHPK3PXP")).toMatchObject({
      issuer: "Acme",
      label: "Acme-bob",
    });
    // A literal "#" in the label.
    expect(projectionFromEnteUri("otpauth://totp/Acme:bob#1?secret=JBSWY3DPEHPK3PXP")).toMatchObject({
      label: "bob#1",
    });
    // Steam defaults to 5 digits.
    expect(projectionFromEnteUri("otpauth://steam/Steam:player?secret=JBSWY3DPEHPK3PXP")).toMatchObject(
      { otpType: "steam", digits: 5 },
    );
    // Empty account falls back to the issuer for the label.
    expect(projectionFromEnteUri("otpauth://totp/?secret=JBSWY3DPEHPK3PXP&issuer=Solo")).toMatchObject({
      issuer: "Solo",
      label: "Solo",
    });
  });

  it("treats a trashed code as not-a-code rather than an error", () => {
    const key = sodium.randomBytes(32);
    const trashed = frame(
      JSON.stringify('otpauth://totp/Acme:bob?secret=JBSWY3DPEHPK3PXP&codeDisplay={"trashed":true}'),
      key,
    );
    expect(parseEnteOtpEntity(trashed, key, sodium)).toBeNull();
  });

  it("is lenient about a bare, unquoted URI", () => {
    const key = sodium.randomBytes(32);
    const bare = frame("otpauth://totp/Acme:bob?secret=JBSWY3DPEHPK3PXP", key);
    expect(parseEnteOtpEntity(bare, key, sodium)).toMatchObject({ issuer: "Acme", label: "bob" });
  });

  it("still reads the JSON projection an earlier build wrote", () => {
    const key = sodium.randomBytes(32);
    const legacy = frame(JSON.stringify(projections[1]), key);
    expect(parseEnteOtpEntity(legacy, key, sodium)).toEqual(projections[1]);
  });

  it("rejects plaintext that is neither a URI nor an OTP projection", () => {
    const key = sodium.randomBytes(32);
    for (const text of [
      JSON.stringify({ version: 1, kind: "login", password: "canary" }),
      "https://example.test/not-otpauth",
      "otpauth://totp/Acme:bob",
      "otpauth://sms/Acme:bob?secret=JBSWY3DPEHPK3PXP",
    ]) {
      expect(() => parseEnteOtpEntity(frame(text, key), key, sodium)).toThrowError(
        expect.objectContaining({ code: "ENTE_INVALID" }),
      );
    }
  });
});
