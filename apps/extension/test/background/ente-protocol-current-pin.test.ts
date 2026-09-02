import { describe, expect, it } from "vitest";

import {
  ENTE_API_ORIGIN,
  ENTE_PROTOCOL_ENDPOINTS,
  ENTE_PROTOCOL_PIN,
  ENTE_SYNC_LIMITS,
  EnteProtocolError,
  parseEnteProtocolResponse,
} from "../../src/background/ente/protocol";
import {
  authenticatorEntityDiffResponseSchema,
  authenticatorEntitySchema,
  authenticatorKeyResponseSchema,
  createEntityRequestSchema,
  createEntityResponseSchema,
  createSrpSessionRequestSchema,
  createSrpSessionResponseSchema,
  deleteEntityQuerySchema,
  srpAttributesResponseSchema,
  totpTwoFactorVerifyRequestSchema,
  updateEntityRequestSchema,
  verifySrpSessionRequestSchema,
} from "../../src/background/ente/schemas";

const uuid = "123e4567-e89b-42d3-a456-426614174000";

describe("current-pin Ente protocol", () => {
  it("pins authority, immutable limits, and the endpoint allowlist", () => {
    expect(ENTE_PROTOCOL_PIN).toBe("c69dcf66704ad7ec1f95e32920455be429a566ef");
    expect(ENTE_API_ORIGIN).toBe("https://api.ente.io");
    expect(Object.isFrozen(ENTE_SYNC_LIMITS)).toBe(true);
    expect(ENTE_SYNC_LIMITS).toMatchObject({
      pageSize: 2500,
      maxPagesPerSnapshot: 40,
      maxRemoteChanges: 100_000,
    });
    expect(ENTE_PROTOCOL_ENDPOINTS).toEqual([
      ["GET", "/users/srp/attributes"],
      ["POST", "/users/srp/create-session"],
      ["POST", "/users/srp/verify-session"],
      ["POST", "/users/two-factor/verify"],
      ["GET", "/authenticator/key"],
      ["GET", "/authenticator/entity/diff"],
      ["POST", "/authenticator/entity"],
      ["PUT", "/authenticator/entity"],
      ["DELETE", "/authenticator/entity"],
    ]);
  });

  it("strictly validates current SRP and TOTP framing", () => {
    const attrs = {
      attributes: {
        srpUserID: uuid,
        srpSalt: "AA==",
        memLimit: 16_777_216,
        opsLimit: 2,
        kekSalt: "AQ==",
        isEmailMFAEnabled: false,
      },
    };
    expect(parseEnteProtocolResponse(srpAttributesResponseSchema, attrs)).toEqual(attrs);
    expect(createSrpSessionRequestSchema.parse({ srpUserID: uuid, srpA: "AA==" })).toBeTruthy();
    expect(createSrpSessionResponseSchema.parse({ sessionID: uuid, srpB: "AA==" })).toBeTruthy();
    expect(
      verifySrpSessionRequestSchema.parse({ sessionID: uuid, srpUserID: uuid, srpM1: "AA==" }),
    ).toBeTruthy();
    expect(
      totpTwoFactorVerifyRequestSchema.parse({ code: "123456", sessionID: uuid }),
    ).toBeTruthy();
    expect(() => srpAttributesResponseSchema.parse({ ...attrs, extra: true })).toThrow();
  });

  it("enforces canonical entities, tombstones, requests, and query values", () => {
    const live = {
      id: uuid,
      encryptedData: "AA==",
      header: "AQ==",
      isDeleted: false,
      createdAt: 1,
      updatedAt: 2,
    };
    const tombstone = { ...live, encryptedData: null, header: null, isDeleted: true };
    expect(authenticatorEntitySchema.parse(live)).toEqual(live);
    expect(authenticatorEntitySchema.parse(tombstone)).toEqual(tombstone);
    expect(
      authenticatorEntityDiffResponseSchema.parse({ diff: [live], timestamp: 2 }),
    ).toBeTruthy();
    expect(
      authenticatorKeyResponseSchema.parse({ encryptedKey: "AA==", header: "AQ==" }),
    ).toBeTruthy();
    expect(createEntityRequestSchema.parse({ encryptedData: "AA==", header: "AQ==" })).toBeTruthy();
    expect(createEntityResponseSchema.parse(live)).toEqual(live);
    expect(
      updateEntityRequestSchema.parse({ id: uuid, encryptedData: "AA==", header: "AQ==" }),
    ).toBeTruthy();
    expect(deleteEntityQuerySchema.parse({ id: uuid })).toEqual({ id: uuid });
    expect(() => authenticatorEntitySchema.parse({ ...live, encryptedData: null })).toThrow();
    expect(() => deleteEntityQuerySchema.parse({ id: uuid.toUpperCase() })).toThrow();
    expect(() =>
      authenticatorEntitySchema.parse({ ...live, updatedAt: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrow();
    expect(() => authenticatorEntitySchema.parse({ ...live, header: "AB==" })).toThrow();
  });

  it("exposes only fixed safe protocol errors", () => {
    let error: unknown;
    try {
      parseEnteProtocolResponse(authenticatorKeyResponseSchema, {
        encryptedKey: "secret",
        header: "body",
        drift: true,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EnteProtocolError);
    expect(error).toMatchObject({
      code: "ENTE_PROTOCOL_DRIFT",
      message: "Ente protocol response rejected",
    });
    expect(String(error)).not.toMatch(/secret|body|drift|authenticator/u);
  });
});
