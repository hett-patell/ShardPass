import { describe, expect, it } from "vitest";

import {
  PASSKEY_FLAGS,
  buildAttestationObject,
  buildAuthenticatorData,
  clientDataJson,
  encodeCbor,
  fromBase64Url,
  generateEs256KeyPair,
  isRegistrableRpId,
  rawToDerSignature,
  sha256,
  signAssertion,
  toBase64Url,
} from "../src";

const hex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

describe("CBOR", () => {
  it("matches RFC 8949 examples and orders map keys canonically", () => {
    expect(hex(encodeCbor(0))).toBe("00");
    expect(hex(encodeCbor(23))).toBe("17");
    expect(hex(encodeCbor(24))).toBe("1818");
    expect(hex(encodeCbor(1000))).toBe("1903e8");
    expect(hex(encodeCbor(-7))).toBe("26");
    expect(hex(encodeCbor("a"))).toBe("6161");
    expect(hex(encodeCbor(Uint8Array.of(1, 2, 3, 4)))).toBe("4401020304");
    expect(hex(encodeCbor([1, 2]))).toBe("820102");
    // {"fmt":"none","attStmt":{},"authData":h''} in canonical order: fmt (3), attStmt (7), authData (8).
    expect(hex(encodeCbor({ authData: new Uint8Array(0), fmt: "none", attStmt: {} }))).toBe(
      "a3" + "63666d74" + "646e6f6e65" + "6761747453746d74" + "a0" + "686175746844617461" + "40",
    );
    // COSE key order: 1, 3, -1, -2, -3.
    const cose = encodeCbor(
      new Map<number, number>([
        [-3, 0],
        [1, 2],
        [-2, 0],
        [3, -7],
        [-1, 1],
      ]),
    );
    expect(hex(cose)).toBe("a5" + "0102" + "0326" + "2001" + "2100" + "2200");
  });
});

describe("base64url", () => {
  it("round-trips without padding", () => {
    const bytes = Uint8Array.of(251, 255, 191, 0, 1);
    expect(toBase64Url(bytes)).toBe("-_-_AAE");
    expect(fromBase64Url("-_-_AAE")).toEqual(bytes);
    expect(() => fromBase64Url("not/base64url+")).toThrow(TypeError);
  });
});

describe("rp id", () => {
  it("accepts the origin's host or a parent domain, never a suffix or an IP", () => {
    expect(isRegistrableRpId("https://accounts.github.com", "github.com")).toBe(true);
    expect(isRegistrableRpId("https://github.com", "github.com")).toBe(true);
    expect(isRegistrableRpId("https://github.com", "com")).toBe(false);
    expect(isRegistrableRpId("https://evilgithub.com", "github.com")).toBe(false);
    expect(isRegistrableRpId("https://10.0.0.1", "10.0.0.1")).toBe(false);
    expect(isRegistrableRpId("http://github.com", "github.com")).toBe(false);
    expect(isRegistrableRpId("http://localhost:3000", "localhost")).toBe(true);
  });
});

describe("registration and assertion", () => {
  it("produces attested authenticator data a relying party can parse, and a signature WebCrypto verifies", async () => {
    const pair = await generateEs256KeyPair();
    const credentialId = Uint8Array.from({ length: 32 }, (_, index) => index);
    const authData = await buildAuthenticatorData({
      rpId: "example.test",
      flags: PASSKEY_FLAGS,
      counter: 0,
      attestedCredential: { credentialId, publicKeyCose: pair.publicKeyCose },
    });
    expect(authData.subarray(0, 32)).toEqual(
      await sha256(new TextEncoder().encode("example.test")),
    );
    expect(authData[32]).toBe(0x5d); // UP | UV | BE | BS | AT
    expect(authData.subarray(33, 37)).toEqual(Uint8Array.of(0, 0, 0, 0));
    expect(authData.subarray(37, 53)).toEqual(new Uint8Array(16)); // aaguid
    expect(authData.subarray(53, 55)).toEqual(Uint8Array.of(0, 32));
    expect(authData.subarray(55, 87)).toEqual(credentialId);
    expect(authData.subarray(87)).toEqual(pair.publicKeyCose);
    const attestation = buildAttestationObject(authData);
    expect(hex(attestation.subarray(0, 1))).toBe("a3");

    const client = clientDataJson("webauthn.get", "Y2hhbGxlbmdl", "https://example.test");
    const assertionData = await buildAuthenticatorData({
      rpId: "example.test",
      flags: PASSKEY_FLAGS,
      counter: 0,
    });
    expect(assertionData.byteLength).toBe(37);
    const signature = await signAssertion(pair.privateKey, assertionData, client);
    expect(signature[0]).toBe(0x30);

    // Verify as a relying party would: DER → raw, over authData || sha256(clientDataJSON).
    const publicKey = await crypto.subtle.importKey(
      "spki",
      Uint8Array.from(pair.publicKeySpki).buffer,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const raw = derToRaw(signature);
    const message = Uint8Array.from([...assertionData, ...(await sha256(client))]).buffer;
    expect(
      await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        publicKey,
        Uint8Array.from(raw).buffer,
        message,
      ),
    ).toBe(true);
  });

  it("DER-encodes signatures with a leading zero when the high bit is set and strips leading zeros otherwise", () => {
    const raw = new Uint8Array(64);
    raw[0] = 0x80;
    raw[63] = 0x01;
    const der = rawToDerSignature(raw);
    // r: 0x00 0x80 0x00... (33 bytes); s: 0x01 (1 byte)
    expect(der[0]).toBe(0x30);
    expect(der[2]).toBe(0x02);
    expect(der[3]).toBe(33);
    expect(der[4]).toBe(0x00);
    expect(der[5]).toBe(0x80);
    expect(der.at(-3)).toBe(0x02);
    expect(der.at(-2)).toBe(1);
    expect(der.at(-1)).toBe(0x01);
  });
});

function derToRaw(der: Uint8Array): Uint8Array {
  const raw = new Uint8Array(64);
  let offset = 2;
  for (const half of [0, 32]) {
    offset += 1; // 0x02
    const length = der[offset]!;
    offset += 1;
    const value = der.subarray(offset, offset + length);
    const trimmed = value.byteLength > 32 ? value.subarray(value.byteLength - 32) : value;
    raw.set(trimmed, half + 32 - trimmed.byteLength);
    offset += length;
  }
  return raw;
}
