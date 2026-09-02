import { describe, expect, it } from "vitest";

import {
  LoginFillCancelRequestSchema,
  LoginFillConfirmRequestSchema,
  LoginFillReleaseResponseSchema,
  LoginFillRequestSchema,
  LoginFillResponseSchema,
  LoginFillSelectRequestSchema,
  LoginFillSuggestionSchema,
  LoginFillSuggestionsRequestSchema,
  LoginFillSuggestionsResponseSchema,
  SaveLoginOfferRequestSchema,
} from "../src/login-fill";

const itemId = "01234567-89ab-4def-8123-456789abcdef";

const suggestion = {
  itemId,
  expectedRevision: 1,
  name: "Example",
  username: "alice",
  favorite: true,
  tags: ["work"],
  hasLinkedOtp: false,
};

const requests = [
  { version: 1, kind: "login.fillSuggestions", domain: "example.com" },
  { version: 1, kind: "login.fillSelect", itemId, expectedRevision: 1 },
  { version: 1, kind: "login.fillConfirm", itemId },
  { version: 1, kind: "login.fillCancel", itemId },
  {
    version: 1,
    kind: "login.saveOffer",
    domain: "example.com",
    username: "alice",
    password: "s3cret",
  },
] as const;

const responses = [
  { version: 1, kind: "login.fillSuggestionsResult", suggestions: [suggestion] },
  { version: 1, kind: "login.fillRelease", username: "alice", password: "s3cret" },
] as const;

describe("login fill messaging", () => {
  it("accepts a well-formed suggestion", () => {
    expect(LoginFillSuggestionSchema.safeParse(suggestion).success).toBe(true);
    expect(LoginFillSuggestionSchema.safeParse({ ...suggestion, extra: true }).success).toBe(false);
    expect(
      LoginFillSuggestionSchema.safeParse({ ...suggestion, expectedRevision: 0 }).success,
    ).toBe(false);
    expect(
      LoginFillSuggestionSchema.safeParse({ ...suggestion, itemId: "not-a-uuid" }).success,
    ).toBe(false);
  });

  it("accepts every request kind and rejects unknown fields", () => {
    for (const request of requests) {
      expect(LoginFillRequestSchema.safeParse(request).success).toBe(true);
      expect(LoginFillRequestSchema.safeParse({ ...request, extra: "nope" }).success).toBe(false);
    }
  });

  it("rejects malformed requests", () => {
    expect(
      LoginFillSuggestionsRequestSchema.safeParse({ ...requests[0], domain: "" }).success,
    ).toBe(false);
    expect(
      LoginFillSuggestionsRequestSchema.safeParse({ ...requests[0], domain: "x".repeat(2049) })
        .success,
    ).toBe(false);
    expect(
      LoginFillSelectRequestSchema.safeParse({ ...requests[1], expectedRevision: -1 }).success,
    ).toBe(false);
    expect(LoginFillSelectRequestSchema.safeParse({ ...requests[1], itemId: "bad" }).success).toBe(
      false,
    );
    expect(LoginFillConfirmRequestSchema.safeParse({ ...requests[2], version: 2 }).success).toBe(
      false,
    );
    expect(LoginFillCancelRequestSchema.safeParse({ kind: "login.fillCancel" }).success).toBe(
      false,
    );
    expect(
      SaveLoginOfferRequestSchema.safeParse({ ...requests[4], password: undefined }).success,
    ).toBe(false);
  });

  it("accepts every response kind, with optional linkedOtpCode", () => {
    for (const response of responses) {
      expect(LoginFillResponseSchema.safeParse(response).success).toBe(true);
      expect(LoginFillResponseSchema.safeParse({ ...response, extra: "nope" }).success).toBe(false);
    }
    expect(
      LoginFillReleaseResponseSchema.safeParse({ ...responses[1], linkedOtpCode: "123456" })
        .success,
    ).toBe(true);
    expect(
      LoginFillSuggestionsResponseSchema.safeParse({
        ...responses[0],
        suggestions: Array.from({ length: 10_001 }, () => suggestion),
      }).success,
    ).toBe(false);
  });
});
