import {
  MAX_ITEM_TAG_LENGTH,
  MAX_ITEM_TAGS,
  MAX_OTP_ISSUER_LENGTH,
  MAX_OTP_LABEL_LENGTH,
  MAX_OTP_NOTE_LENGTH,
  MAX_OTP_PERIOD_SECONDS,
  MAX_OTP_SECRET_LENGTH,
} from "@shardpass/domain";
import { describe, expect, it } from "vitest";

import {
  MAX_OTP_LIST_ITEMS,
  MAX_OTP_SEARCH_QUERY_LENGTH,
  OtpCreateInputSchema,
  OtpEditableInputSchema,
  OtpRequestSchema,
  OtpResponseSchema,
  otpResponseKindByRequest,
  parseOtpResponseForRequest,
  otpSenderPolicy,
} from "../src/otp";

const itemId = "01234567-89ab-4def-8123-456789abcdef";
const reservationId = "fedcba98-7654-4abc-9234-fedcba987654";
const secret = "JBSWY3DPEHPK3PXP";

function editable(overrides: Record<string, unknown> = {}) {
  return {
    issuer: "Example",
    label: "Account",
    secret,
    otpType: "totp",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    favorite: false,
    tags: ["work"],
    note: "",
    ...overrides,
  };
}

function listProjection(overrides: Record<string, unknown> = {}) {
  return {
    id: itemId,
    revision: 1,
    issuer: "Example",
    label: "Account",
    otpType: "totp",
    favorite: false,
    tags: ["work"],
    ...overrides,
  };
}

const validRequests = [
  { version: 1, kind: "otp.list", query: "work" },
  { version: 1, kind: "otp.getEditor", itemId },
  { version: 1, kind: "otp.create", input: editable() },
  { version: 1, kind: "otp.update", itemId, expectedRevision: 1, input: editable() },
  { version: 1, kind: "otp.delete", itemId, expectedRevision: 1 },
  { version: 1, kind: "otp.getCode", itemId },
  { version: 1, kind: "otp.copyCode", itemId, expectedRevision: 1 },
  { version: 1, kind: "otp.reserveHotp", itemId },
  { version: 1, kind: "otp.commitHotp", reservationId },
  { version: 1, kind: "otp.cancelHotp", reservationId },
] as const;

const validResponses = [
  { version: 1, kind: "otp.listResult", items: [listProjection()] },
  { version: 1, kind: "otp.editorResult", item: { ...editable(), id: itemId, revision: 1 } },
  { version: 1, kind: "otp.mutationResult", item: listProjection({ revision: 2 }) },
  { version: 1, kind: "otp.deleteResult", itemId, revision: 2 },
  {
    version: 1,
    kind: "otp.codeResult",
    itemId,
    revision: 1,
    code: "123456",
    otpType: "totp",
    period: 30,
    remaining: 15,
    expiresAt: 30_000,
  },
  {
    version: 1,
    kind: "otp.hotpReserved",
    reservationId,
    itemId,
    itemRevision: 1,
    counter: 7,
    code: "123456",
    expiresAt: 30_000,
  },
  { version: 1, kind: "otp.hotpCommitted", reservationId, revision: 2, counter: 8 },
  { version: 1, kind: "otp.hotpCancelled", reservationId, cancelled: true },
] as const;

describe("OTP messaging", () => {
  it("accepts every exact version 1 request and rejects unknown fields", () => {
    for (const request of validRequests) {
      expect(OtpRequestSchema.safeParse(request).success).toBe(true);
      expect(OtpRequestSchema.safeParse({ ...request, password: "forbidden" }).success).toBe(false);
    }
  });

  it("rejects invalid identifiers, revisions, versions, kinds, and bounded search violations", () => {
    for (const request of [
      { version: 2, kind: "otp.list", query: "" },
      { version: 1, kind: "otp.unknown", query: "" },
      { version: 1, kind: "otp.list", query: "x".repeat(MAX_OTP_SEARCH_QUERY_LENGTH + 1) },
      { version: 1, kind: "otp.getEditor", itemId: "not-a-uuid" },
      { version: 1, kind: "otp.update", itemId, expectedRevision: 0, input: editable() },
      {
        version: 1,
        kind: "otp.update",
        itemId,
        expectedRevision: Number.MAX_SAFE_INTEGER + 1,
        input: editable(),
      },
      { version: 1, kind: "otp.delete", itemId, expectedRevision: 1.5 },
      { version: 1, kind: "otp.copyCode", itemId },
      { version: 1, kind: "otp.copyCode", itemId, expectedRevision: 0 },
      { version: 1, kind: "otp.copyCode", itemId, expectedRevision: 1.5 },
      { version: 1, kind: "otp.commitHotp", reservationId: "not-a-uuid" },
    ]) {
      expect(OtpRequestSchema.safeParse(request).success).toBe(false);
    }
  });

  it("binds revision only to otp.copyCode and leaves otp.getCode item-only", () => {
    expect(
      OtpRequestSchema.safeParse({ version: 1, kind: "otp.copyCode", itemId, expectedRevision: 1 })
        .success,
    ).toBe(true);
    expect(
      OtpRequestSchema.safeParse({ version: 1, kind: "otp.getCode", itemId, expectedRevision: 1 })
        .success,
    ).toBe(false);
    expect(OtpRequestSchema.safeParse({ version: 1, kind: "otp.getCode", itemId }).success).toBe(
      true,
    );
  });

  it("enforces bounded canonical editable inputs without persisted metadata or extra authority", () => {
    expect(OtpCreateInputSchema.safeParse(editable()).success).toBe(true);
    expect(OtpEditableInputSchema.safeParse(editable()).success).toBe(true);

    for (const input of [
      editable({ issuer: "x".repeat(MAX_OTP_ISSUER_LENGTH + 1) }),
      editable({ label: "x".repeat(MAX_OTP_LABEL_LENGTH + 1) }),
      editable({ secret: "A".repeat(MAX_OTP_SECRET_LENGTH + 1) }),
      editable({ note: "x".repeat(MAX_OTP_NOTE_LENGTH + 1) }),
      editable({ tags: Array.from({ length: MAX_ITEM_TAGS + 1 }, (_, index) => `t${index}`) }),
      editable({ tags: ["x".repeat(MAX_ITEM_TAG_LENGTH + 1)] }),
      editable({ secret: "lowercase" }),
      editable({ id: itemId }),
      editable({ revision: 1 }),
      editable({ createdAt: "2026-08-10T00:00:00.000Z" }),
      editable({ updatedAt: "2026-08-10T00:00:00.000Z" }),
      editable({ archivedAt: "2026-08-10T00:00:00.000Z" }),
      editable({ deletedAt: "2026-08-10T00:00:00.000Z" }),
      editable({ schemaVersion: 1 }),
      editable({ kind: "otp" }),
      editable({ enteMetadata: {} }),
      editable({ root: {} }),
      editable({ key: "forbidden" }),
      editable({ token: "forbidden" }),
      editable({ records: [] }),
    ]) {
      expect(OtpEditableInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it("preserves strict TOTP, HOTP, and explicit Steam invariants", () => {
    expect(
      OtpEditableInputSchema.safeParse(
        editable({ otpType: "hotp", period: 0, counter: 0, algorithm: "SHA512", digits: 8 }),
      ).success,
    ).toBe(true);
    expect(
      OtpEditableInputSchema.safeParse(
        editable({ otpType: "steam", algorithm: "SHA1", digits: 5, period: 30 }),
      ).success,
    ).toBe(true);

    for (const input of [
      editable({ otpType: "totp", counter: 0 }),
      editable({ otpType: "totp", period: 0 }),
      editable({ otpType: "totp", digits: 5 }),
      editable({ period: MAX_OTP_PERIOD_SECONDS + 1 }),
      editable({ otpType: "hotp", period: 30, counter: 0 }),
      editable({ otpType: "hotp", period: 0 }),
      editable({ otpType: "hotp", period: 0, counter: -1 }),
      editable({ otpType: "steam", algorithm: "SHA256", digits: 5, period: 30 }),
      editable({ otpType: "steam", algorithm: "SHA1", digits: 6, period: 30 }),
      editable({ otpType: "steam", algorithm: "SHA1", digits: 5, period: 60 }),
      editable({ otpType: "steam", algorithm: "SHA1", digits: 5, period: 30, counter: 0 }),
    ]) {
      expect(OtpEditableInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it("accepts every exact bounded response and rejects unknown fields", () => {
    for (const response of validResponses) {
      expect(OtpResponseSchema.safeParse(response).success).toBe(true);
      expect(OtpResponseSchema.safeParse({ ...response, extra: "forbidden" }).success).toBe(false);
    }
  });

  it("rejects a list projection containing a secret, note, code, or full record", () => {
    for (const extra of [
      { secret },
      { seed: secret },
      { note: "private" },
      { code: "123456" },
      { createdAt: "2026-08-10T00:00:00.000Z" },
      { enteMetadata: {} },
    ]) {
      expect(
        OtpResponseSchema.safeParse({
          version: 1,
          kind: "otp.listResult",
          items: [{ ...listProjection(), ...extra }],
        }).success,
      ).toBe(false);
    }
  });

  it("bounds list allocation and permits a metadata-free locked list projection", () => {
    expect(
      OtpResponseSchema.safeParse({ version: 1, kind: "otp.listResult", items: [] }).success,
    ).toBe(true);
    expect(
      OtpResponseSchema.safeParse({
        version: 1,
        kind: "otp.listResult",
        items: Array.from({ length: MAX_OTP_LIST_ITEMS + 1 }, () => listProjection()),
      }).success,
    ).toBe(false);
  });

  it("keeps the secret only in the vault-only editor projection", () => {
    expect(
      OtpResponseSchema.safeParse({
        version: 1,
        kind: "otp.editorResult",
        item: { ...editable(), id: itemId, revision: 1 },
      }).success,
    ).toBe(true);

    for (const response of [
      { version: 1, kind: "otp.mutationResult", item: { ...listProjection(), secret } },
      { version: 1, kind: "otp.deleteResult", itemId, revision: 2, secret },
      {
        version: 1,
        kind: "otp.hotpReserved",
        reservationId,
        itemId,
        itemRevision: 1,
        counter: 7,
        code: "123456",
        expiresAt: 30_000,
        secret,
      },
    ]) {
      expect(OtpResponseSchema.safeParse(response).success).toBe(false);
    }
  });

  it("validates code shape, safe integer counters and revisions, and finite nonnegative times", () => {
    for (const response of [
      { ...validResponses[4], code: "12345" },
      { ...validResponses[4], code: "12345678901" },
      { ...validResponses[4], remaining: -1 },
      { ...validResponses[4], expiresAt: Number.POSITIVE_INFINITY },
      { ...validResponses[4], revision: Number.MAX_SAFE_INTEGER + 1 },
      { ...validResponses[5], counter: Number.MAX_SAFE_INTEGER + 1 },
      { ...validResponses[5], expiresAt: -1 },
      { ...validResponses[6], reservationId: "invalid" },
    ]) {
      expect(OtpResponseSchema.safeParse(response).success).toBe(false);
    }

    expect(
      OtpResponseSchema.safeParse({
        ...validResponses[4],
        otpType: "steam",
        code: "BCDFG",
      }).success,
    ).toBe(true);
    expect(
      OtpResponseSchema.safeParse({
        ...validResponses[4],
        otpType: "steam",
        code: "123456",
      }).success,
    ).toBe(false);
  });

  it("enforces one exhaustive response kind for every request command", () => {
    const expectedKinds = [
      "otp.listResult",
      "otp.editorResult",
      "otp.mutationResult",
      "otp.mutationResult",
      "otp.deleteResult",
      "otp.codeResult",
      "otp.codeResult",
      "otp.hotpReserved",
      "otp.hotpCommitted",
      "otp.hotpCancelled",
    ] as const;
    expect(validRequests.map((request) => otpResponseKindByRequest[request.kind])).toEqual(
      expectedKinds,
    );

    for (const [requestIndex, request] of validRequests.entries()) {
      for (const response of validResponses) {
        const parsed = parseOtpResponseForRequest(OtpRequestSchema.parse(request), response);
        expect(parsed.success).toBe(response.kind === expectedKinds[requestIndex]);
      }
    }
  });

  it("requires the configured period and preserves Steam's exact period", () => {
    expect(OtpResponseSchema.safeParse(validResponses[4]).success).toBe(true);
    expect(OtpResponseSchema.safeParse({ ...validResponses[4], period: 0 }).success).toBe(false);
    expect(
      OtpResponseSchema.safeParse({ ...validResponses[4], period: MAX_OTP_PERIOD_SECONDS + 1 })
        .success,
    ).toBe(false);
    expect(
      OtpResponseSchema.safeParse({
        ...validResponses[4],
        otpType: "steam",
        code: "BCDFG",
        period: 45,
      }).success,
    ).toBe(false);
    expect(
      OtpResponseSchema.safeParse({
        ...validResponses[4],
        otpType: "steam",
        code: "BCDFG",
        period: 30,
      }).success,
    ).toBe(true);
  });

  it("defines explicit reservation identifiers and commit/cancel semantics", () => {
    expect(validResponses[5]).toMatchObject({ reservationId, itemId, itemRevision: 1, counter: 7 });
    expect(validResponses[6]).toEqual({
      version: 1,
      kind: "otp.hotpCommitted",
      reservationId,
      revision: 2,
      counter: 8,
    });
    expect(validResponses[7]).toEqual({
      version: 1,
      kind: "otp.hotpCancelled",
      reservationId,
      cancelled: true,
    });
  });

  it("keeps CRUD and editor vault-only and denies content command-by-command", () => {
    expect(otpSenderPolicy).toEqual({
      "otp.list": { allowedContexts: ["popup", "vault"], requireDocument: true },
      "otp.getEditor": { allowedContexts: ["vault"], requireDocument: true },
      "otp.create": { allowedContexts: ["vault"], requireDocument: true },
      "otp.update": { allowedContexts: ["vault"], requireDocument: true },
      "otp.delete": { allowedContexts: ["vault"], requireDocument: true },
      "otp.getCode": { allowedContexts: ["popup", "vault"], requireDocument: true },
      "otp.copyCode": { allowedContexts: ["popup", "vault"], requireDocument: true },
      "otp.reserveHotp": { allowedContexts: [], requireDocument: true },
      "otp.commitHotp": { allowedContexts: [], requireDocument: true },
      "otp.cancelHotp": { allowedContexts: [], requireDocument: true },
    });
  });
});
