export type SecurityEvent =
  | Readonly<{
      code: "MESSAGE_REJECTED";
      reason: "INVALID_MESSAGE" | "UNAUTHORIZED_SENDER" | "UNSUPPORTED_CONTEXT";
      senderKnown: boolean;
    }>
  | Readonly<{
      code: "UNEXPECTED_ERROR";
      operation: "MESSAGE_HANDLING" | "PLATFORM_OPERATION";
      recovered: boolean;
    }>;

export interface SecurityEventSink {
  record(event: SecurityEvent): void;
}

export const noopSecurityEventSink: SecurityEventSink = Object.freeze({
  record(): void {},
});
