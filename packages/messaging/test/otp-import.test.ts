import { describe, expect, it } from "vitest";

import {
  OtpImportRequestSchema,
  OtpImportResponseSchema,
  otpImportSenderPolicy,
  parseOtpImportResponseForRequest,
} from "../src/otp-import";

const candidate = {
  sourceOrdinal: 1,
  issuer: "Synthetic",
  label: "account",
  secret: "JBSWY3DPEHPK3PXP",
  otpType: "totp" as const,
  algorithm: "SHA1" as const,
  digits: 6,
  period: 30,
  favorite: false,
  tags: [],
  note: "",
};
const token = "01234567-89ab-4def-8123-456789abcdef";
const rowId = "fedcba98-7654-4abc-9234-fedcba987654";

const preview = {
  version: 1 as const,
  kind: "otp.importPreview" as const,
  format: "otpauth" as const,
  candidates: [candidate],
};
const result = {
  version: 1 as const,
  kind: "otp.importPreviewResult" as const,
  previewToken: token,
  format: "otpauth" as const,
  rows: [
    {
      rowId,
      ordinal: 1,
      status: "accepted" as const,
      reason: "IMPORT_ACCEPTED" as const,
      metadata: {
        issuer: "Synthetic",
        label: "account",
        otpType: "totp" as const,
        algorithm: "SHA1" as const,
        digits: 6,
        period: 30,
      },
    },
  ],
  accepted: 1,
  duplicate: 0,
  rejected: 0,
  expiresAt: 300_000,
};

describe("OTP import messaging", () => {
  it("accepts only strict bounded candidate preview and token-only confirm requests", () => {
    expect(OtpImportRequestSchema.safeParse(preview).success).toBe(true);
    expect(
      OtpImportRequestSchema.safeParse({
        ...preview,
        candidates: [{ ...candidate, sourceOrdinal: 0 }],
      }).success,
    ).toBe(false);
    expect(
      OtpImportRequestSchema.safeParse({
        ...preview,
        candidates: [{ ...candidate, sourceOrdinal: 1_001 }],
      }).success,
    ).toBe(false);
    expect(
      OtpImportRequestSchema.safeParse({
        ...preview,
        candidates: [candidate, { ...candidate, label: "Second" }],
      }).success,
    ).toBe(false);
    expect(
      OtpImportRequestSchema.safeParse({
        version: 1,
        kind: "otp.importConfirm",
        previewToken: token,
      }).success,
    ).toBe(true);
    expect(OtpImportRequestSchema.safeParse({ ...preview, text: "secret" }).success).toBe(false);
    expect(OtpImportRequestSchema.safeParse({ ...preview, candidates: [] }).success).toBe(false);
    expect(
      OtpImportRequestSchema.safeParse({ ...preview, candidates: Array(1_001).fill(candidate) })
        .success,
    ).toBe(false);
    expect(
      OtpImportRequestSchema.safeParse({
        version: 1,
        kind: "otp.importConfirm",
        previewToken: token,
        candidates: [candidate],
      }).success,
    ).toBe(false);
  });

  it("keeps preview and confirmation responses secret-free and strictly command-paired", () => {
    expect(OtpImportResponseSchema.safeParse(result).success).toBe(true);
    expect(OtpImportResponseSchema.safeParse({ ...result, secret: candidate.secret }).success).toBe(
      false,
    );
    expect(parseOtpImportResponseForRequest(preview, result).success).toBe(true);
    expect(
      parseOtpImportResponseForRequest(preview, {
        version: 1,
        kind: "otp.importConfirmed",
        imported: 1,
        duplicate: 0,
      }).success,
    ).toBe(false);
  });

  it("defines every import command as document-bound vault-only", () => {
    expect(otpImportSenderPolicy).toEqual({
      "otp.importPreview": { allowedContexts: ["vault"], requireDocument: true },
      "otp.importConfirm": { allowedContexts: ["vault"], requireDocument: true },
      "otp.importCancel": { allowedContexts: ["vault"], requireDocument: true },
    });
  });
});
