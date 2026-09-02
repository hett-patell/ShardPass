import { describe, expect, expectTypeOf, it } from "vitest";

import {
  FoundationRequestSchema,
  FoundationResponseSchema,
  MessageEnvelopeSchema,
} from "../src/foundation";
import type { FoundationRequest, FoundationResponse, MessageEnvelope } from "../src/foundation";

const request: FoundationRequest = {
  version: 1,
  kind: "foundation.getStatus",
};

const response: FoundationResponse = {
  version: 1,
  kind: "foundation.status",
  phase: "foundation",
  vaultAvailable: false,
};

describe("message envelope", () => {
  it("accepts only an exact supported envelope", () => {
    expect(MessageEnvelopeSchema.parse(request)).toEqual(request);
    expect(() => MessageEnvelopeSchema.parse({ ...request, version: 2 })).toThrow();
    expect(() => MessageEnvelopeSchema.parse({ ...request, extra: true })).toThrow();
    expect(() => MessageEnvelopeSchema.parse({ version: 1 })).toThrow();
  });

  it("infers the public envelope type from its runtime schema", () => {
    expectTypeOf<MessageEnvelope>().toEqualTypeOf<{ version: 1; kind: string }>();
  });
});

describe("foundation messages", () => {
  it("accepts the exact versioned request", () => {
    expect(FoundationRequestSchema.parse(request)).toEqual(request);
  });

  it.each([
    { version: 2, kind: "foundation.getStatus" },
    { version: 1, kind: "foundation.unknown" },
    { version: 1, kind: "foundation.getStatus", secret: "x" },
    { kind: "foundation.getStatus" },
    null,
  ])("rejects an invalid request: %j", (input) => {
    expect(() => FoundationRequestSchema.parse(input)).toThrow();
  });

  it("accepts the exact versioned response", () => {
    expect(FoundationResponseSchema.parse(response)).toEqual(response);
  });

  it.each([
    { ...response, version: 2 },
    { ...response, kind: "foundation.unknown" },
    { ...response, phase: "vault" },
    { ...response, vaultAvailable: true },
    { ...response, secret: "x" },
  ])("rejects an invalid response: %j", (input) => {
    expect(() => FoundationResponseSchema.parse(input)).toThrow();
  });

  it("infers request and response types from their schemas", () => {
    expectTypeOf(request).toEqualTypeOf<FoundationRequest>();
    expectTypeOf(response).toEqualTypeOf<FoundationResponse>();
  });
});
