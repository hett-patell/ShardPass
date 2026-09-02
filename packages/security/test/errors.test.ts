import { describe, expect, it } from "vitest";
import { toSafeError } from "../src/errors";

describe("toSafeError", () => {
  it("drops arbitrary messages, stacks, causes, and payloads", () => {
    const input = Object.assign(new Error("password=hunter2", { cause: "private cause" }), {
      token: "secret",
    });

    const result = toSafeError(input, "UNEXPECTED");

    expect(result).toEqual({
      code: "UNEXPECTED",
      message: "Something went wrong. Try again.",
    });
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("private cause");
  });

  it.each([
    ["INVALID_MESSAGE", "The request was invalid."],
    ["UNAUTHORIZED_SENDER", "This action is not allowed here."],
    ["UNSUPPORTED_CONTEXT", "This page context is not supported."],
    ["OTP_INVALID", "The authenticator item is invalid."],
    ["OTP_NOT_FOUND", "The authenticator item was not found."],
    ["OTP_CONFLICT", "This item changed. Review the latest version and try again."],
    ["OTP_HOTP_REQUIRED", "This code is available only for a confirmed fill."],
    ["OTP_RESERVATION_INVALID", "This code reservation is invalid or expired."],
    ["OTP_RESERVATION_STALE", "This item changed before the code could be confirmed."],
    ["OTP_RESERVATION_UNCERTAIN", "The code confirmation could not be verified."],
    ["CLIPBOARD_UNAVAILABLE", "Copy failed. Try again."],
    ["BACKUP_INVALID", "The backup request is invalid."],
    ["BACKUP_AUTH_FAILED", "The current password could not be verified."],
    ["BACKUP_EXPIRED", "That backup authorization expired. Try again."],
    ["BACKUP_CHANGED", "The vault changed. Review the backup preview again."],
    ["BACKUP_CAPACITY", "The vault does not have capacity for this backup."],
    ["BACKUP_UNAVAILABLE", "The backup could not be verified. Try again."],
    ["UNEXPECTED", "Something went wrong. Try again."],
  ] as const)("maps %s to its stable allowlisted message", (code, message) => {
    expect(toSafeError("untrusted detail", code)).toEqual({ code, message });
  });

  it("maps OTP failures without reflecting arbitrary strings", () => {
    const result = toSafeError("reflected input", "OTP_CONFLICT");

    expect(result).toEqual({
      code: "OTP_CONFLICT",
      message: "This item changed. Review the latest version and try again.",
    });
    expect(JSON.stringify(result)).not.toContain("reflected input");
  });
});
