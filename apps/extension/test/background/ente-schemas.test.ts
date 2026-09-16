import { describe, expect, it } from "vitest";

import {
  ENTE_PROTOCOL_PIN,
  ENTE_SNAPSHOT_LIMITS,
  parseEnteProtocolResponse,
} from "../../src/background/ente/protocol";
import {
  authenticatorEntityDiffResponseSchema,
  authenticatorKeyResponseSchema,
  srpAttributesResponseSchema,
  verifySrpSessionResponseSchema,
} from "../../src/background/ente/schemas";
import type { EnteOtpAdapterInput } from "../../src/background/ente/schemas";

describe("pinned strict Ente protocol schemas", () => {
  it("pins the reviewed protocol and immutable limits", () => {
    expect(ENTE_PROTOCOL_PIN).toBe("c69dcf66704ad7ec1f95e32920455be429a566ef");
    expect(ENTE_SNAPSHOT_LIMITS).toMatchObject({ pageSize: 2500, maxPages: 40 });
    expect(Object.isFrozen(ENTE_SNAPSHOT_LIMITS)).toBe(true);
  });

  it("strictly projects SRP attributes and rejects nested drift and malformed encodings", () => {
    const valid = {
      attributes: {
        srpUserID: "123e4567-e89b-42d3-a456-426614174000",
        srpSalt: "AA==",
        memLimit: 1,
        opsLimit: 1,
        kekSalt: "AQ==",
        isEmailMFAEnabled: false,
      },
    };
    expect(parseEnteProtocolResponse(srpAttributesResponseSchema, valid)).toEqual(valid);
    // Fields the server adds later are stripped, not fatal: a strict parse here turned the
    // first API addition into a sign-in outage.
    expect(
      parseEnteProtocolResponse(srpAttributesResponseSchema, { ...valid, drift: true }),
    ).toEqual(valid);
    expect(
      parseEnteProtocolResponse(srpAttributesResponseSchema, {
        attributes: { ...valid.attributes, addedLater: 1 },
      }),
    ).toEqual(valid);
    expect(() =>
      parseEnteProtocolResponse(srpAttributesResponseSchema, {
        attributes: { ...valid.attributes, srpSalt: "%%%" },
      }),
    ).toThrow();
    expect(() =>
      parseEnteProtocolResponse(srpAttributesResponseSchema, {
        attributes: { ...valid.attributes, memLimit: -1 },
      }),
    ).toThrow();
  });

  it("rejects unknown key envelopes, unsafe values, malformed tombstones, and oversized fields", () => {
    expect(() =>
      parseEnteProtocolResponse(authenticatorKeyResponseSchema, { version: 999 }),
    ).toThrow();
    expect(() =>
      parseEnteProtocolResponse(authenticatorEntityDiffResponseSchema, {
        diff: [
          {
            id: "x",
            isDeleted: true,
            createdAt: 0,
            updatedAt: -1,
            encryptedData: "AA==",
            header: "AA==",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      parseEnteProtocolResponse(authenticatorEntityDiffResponseSchema, {
        diff: [
          {
            id: "x",
            isDeleted: false,
            createdAt: 0,
            updatedAt: Number.MAX_SAFE_INTEGER + 1,
            encryptedData: "AA==",
            header: "AA==",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      parseEnteProtocolResponse(authenticatorEntityDiffResponseSchema, {
        diff: [
          {
            id: "x",
            isDeleted: false,
            createdAt: 0,
            updatedAt: 1,
            encryptedData: "A".repeat(1_048_580),
            header: "AA==",
          },
        ],
      }),
    ).toThrow();
  });

  it("makes password LoginItem structurally impossible at the OTP adapter boundary", () => {
    // @ts-expect-error Login/password entities are forbidden by the OTP-only adapter contract.
    const forbidden: EnteOtpAdapterInput = { type: "LoginItem", password: "synthetic-only" };
    expect((forbidden as unknown as { type: string }).type).toBe("LoginItem");
  });
});

describe("verify-session response as the production server sends it", () => {
  it("accepts empty session-id fields and extra keys for a password-only account", () => {
    const response = {
      id: 1580559962386438,
      keyAttributes: { kekSalt: "AQ==", encryptedKey: "AQ==", keyDecryptionNonce: "AQ==" },
      encryptedToken: "AQ==",
      srpM2: "AQ==",
      twoFactorSessionID: "",
      passkeySessionID: "",
      twoFactorSessionIDV2: "",
      accountsUrl: "https://accounts.ente.io",
    };
    const parsed = parseEnteProtocolResponse(verifySrpSessionResponseSchema, response);
    expect(parsed.twoFactorSessionID).toBe("");
    expect(parsed.srpM2).toBe("AQ==");
    expect("accountsUrl" in parsed).toBe(false);
  });
});
