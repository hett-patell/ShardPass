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
  loginFillSenderPolicy,
  parseLoginFillResponseForRequest,
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
  { version: 1, kind: "login.saveDismiss", offerId: "a".repeat(32) },
  { version: 1, kind: "login.pendingOffer" },
] as const;

const responses = [
  { version: 1, kind: "login.fillSuggestionsResult", suggestions: [suggestion] },
  { version: 1, kind: "login.fillRelease", username: "alice", password: "s3cret" },
  { version: 1, kind: "login.pendingOfferResult", offer: null },
  {
    version: 1,
    kind: "login.pendingOfferResult",
    offer: { offerId: "b".repeat(32), domain: "example.com", username: "alice", existing: "locked" },
  },
  { version: 1, kind: "login.saveOfferResult", offerId: "c".repeat(32), existing: "locked" },
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

describe("held save offers", () => {
  it("are asked for and dismissed by content scripts only, and never carry a password", () => {
    expect(loginFillSenderPolicy["login.pendingOffer"].allowedContexts).toEqual(["content"]);
    expect(loginFillSenderPolicy["login.saveDismiss"].allowedContexts).toEqual(["content"]);
    const offer = { offerId: "b".repeat(32), domain: "example.com", username: "alice", existing: "none" };
    expect(
      LoginFillResponseSchema.safeParse({
        version: 1,
        kind: "login.pendingOfferResult",
        offer: { ...offer, password: "s3cret" },
      }).success,
    ).toBe(false);
    expect(
      parseLoginFillResponseForRequest(
        { version: 1, kind: "login.pendingOffer" },
        { version: 1, kind: "login.pendingOfferResult", offer },
      ).success,
    ).toBe(true);
    expect(
      parseLoginFillResponseForRequest(
        { version: 1, kind: "login.saveDismiss", offerId: "b".repeat(32) },
        { version: 1, kind: "login.fillAck", ok: true },
      ).success,
    ).toBe(true);
  });
});

describe("login.reveal", () => {
  it("is an extension-page command paired with the release response, unlike fillSelect", () => {
    expect(loginFillSenderPolicy["login.reveal"]).toEqual({
      allowedContexts: ["popup", "vault"],
      requireDocument: true,
    });
    expect(loginFillSenderPolicy["login.fillSelect"].allowedContexts).toEqual(["content"]);
    const request = {
      version: 1 as const,
      kind: "login.reveal" as const,
      itemId: "11111111-1111-4111-8111-111111111111",
      expectedRevision: 3,
    };
    expect(LoginFillRequestSchema.safeParse(request).success).toBe(true);
    expect(
      parseLoginFillResponseForRequest(request, {
        version: 1,
        kind: "login.fillRelease",
        username: "u",
        password: "p",
      }).success,
    ).toBe(true);
    expect(
      parseLoginFillResponseForRequest(request, { version: 1, kind: "login.fillAck", ok: true })
        .success,
    ).toBe(false);
  });
});
