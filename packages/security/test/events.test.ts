import { describe, expect, it, vi } from "vitest";
import { noopSecurityEventSink, type SecurityEvent, type SecurityEventSink } from "../src/events";

describe("security event contracts", () => {
  it("records stable non-secret event data through the sink interface", () => {
    const record = vi.fn<(event: SecurityEvent) => void>();
    const sink: SecurityEventSink = { record };
    const event = {
      code: "MESSAGE_REJECTED",
      reason: "UNAUTHORIZED_SENDER",
      senderKnown: false,
    } as const satisfies SecurityEvent;

    sink.record(event);

    expect(record).toHaveBeenCalledWith(event);
  });

  it("provides a no-op default sink", () => {
    const event = {
      code: "UNEXPECTED_ERROR",
      operation: "MESSAGE_HANDLING",
      recovered: true,
    } as const satisfies SecurityEvent;

    expect(noopSecurityEventSink.record(event)).toBeUndefined();
  });
});
