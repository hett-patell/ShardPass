import { describe, expect, it } from "vitest";

import {
  OTP_FILL_LIMITS,
  OtpFillRequestSchema,
  OtpFillResponseSchema,
  otpFillResponseKindByRequest,
  otpFillSenderPolicy,
  parseOtpFillResponseForRequest,
} from "../src/otp-fill";

const itemId = "01234567-89ab-4def-8123-456789abcdef";
const requestId = "request_0123456789abcdef";
const fieldHandle = "field_0123456789abcdef";
const capability = "capability_0123456789abcdef";
const releaseId = "release_0123456789abcdef";

const requests = [
  { version: 1, kind: "otp.fillSuggestions", requestId, fieldHandle },
  { version: 1, kind: "otp.fillSelect", capability, itemId, expectedRevision: 1, fieldHandle },
  { version: 1, kind: "otp.fillConfirm", releaseId, fieldHandle, result: "filled" },
  { version: 1, kind: "otp.fillCancel", releaseId, fieldHandle },
] as const;

const responses = [
  {
    version: 1,
    kind: "otp.fillSuggestionsResult",
    capability,
    expiresAt: 301_000,
    suggestions: [
      {
        itemId,
        expectedRevision: 1,
        issuer: "Example",
        label: "Account",
        otpType: "totp",
        favorite: true,
        tags: ["work"],
      },
    ],
  },
  {
    version: 1,
    kind: "otp.fillRelease",
    releaseId,
    code: "123456",
    expiresAt: 6_000,
    codeLength: 6,
    characterClass: "digits",
  },
  { version: 1, kind: "otp.fillConfirmed", result: "committed" },
  { version: 1, kind: "otp.fillCancelled", cancelled: true },
] as const;

describe("OTP fill messaging", () => {
  it("publishes the fixed limits", () => {
    expect(OTP_FILL_LIMITS).toEqual({
      suggestionTtlMs: 300_000,
      releaseTtlMs: 5_000,
      terminalRetentionMs: 60_000,
      maxSuggestions: 10_000,
      maxCapabilitiesPerDocument: 4,
      maxCapabilitiesGlobal: 256,
      maxReleasesGlobal: 256,
      maxDiscoveryNodesPerPass: 256,
      maxDiscoveredFieldsPerFrame: 32,
      maxDiscoveryPassesPerSecond: 10,
    });
    expect(Object.isFrozen(OTP_FILL_LIMITS)).toBe(true);
  });

  it("accepts exact version 1 requests and rejects unknown fields and bounds", () => {
    for (const request of requests) {
      expect(OtpFillRequestSchema.safeParse(request).success).toBe(true);
      expect(OtpFillRequestSchema.safeParse({ ...request, origin: "forbidden" }).success).toBe(
        false,
      );
    }
    for (const invalid of [
      { ...requests[0], version: 2 },
      { ...requests[0], requestId: "" },
      { ...requests[0], fieldHandle: "x".repeat(257) },
      { ...requests[1], expectedRevision: 0 },
      { ...requests[2], result: "page-derived" },
    ])
      expect(OtpFillRequestSchema.safeParse(invalid).success).toBe(false);
  });

  it("accepts only metadata suggestions and fixed code release shapes", () => {
    for (const response of responses) {
      expect(OtpFillResponseSchema.safeParse(response).success).toBe(true);
      expect(OtpFillResponseSchema.safeParse({ ...response, secret: "forbidden" }).success).toBe(
        false,
      );
    }
    expect(
      OtpFillResponseSchema.safeParse({
        ...responses[0],
        suggestions: [{ ...responses[0].suggestions[0], counter: 1 }],
      }).success,
    ).toBe(false);
    expect(
      OtpFillResponseSchema.safeParse({ ...responses[1], code: "12345", codeLength: 6 }).success,
    ).toBe(false);
    expect(
      OtpFillResponseSchema.safeParse({
        ...responses[0],
        suggestions: Array.from(
          { length: OTP_FILL_LIMITS.maxSuggestions + 1 },
          () => responses[0].suggestions[0],
        ),
      }).success,
    ).toBe(false);
  });

  it("pairs every request with exactly one response kind", () => {
    expect(otpFillResponseKindByRequest).toEqual({
      "otp.fillSuggestions": "otp.fillSuggestionsResult",
      "otp.fillSelect": "otp.fillRelease",
      "otp.fillConfirm": "otp.fillConfirmed",
      "otp.fillCancel": "otp.fillCancelled",
    });
    requests.forEach((request, index) => {
      expect(parseOtpFillResponseForRequest(request, responses[index])).toMatchObject({
        success: true,
      });
      expect(
        parseOtpFillResponseForRequest(request, responses[(index + 1) % responses.length]),
      ).toEqual({ success: false });
    });
  });

  it("authorizes every fill command only for exact content sender metadata", () => {
    for (const policy of Object.values(otpFillSenderPolicy))
      expect(policy).toEqual({
        allowedContexts: ["content"],
        requireTab: true,
        requireFrame: true,
        requireDocument: true,
      });
  });
});
