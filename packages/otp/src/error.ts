export type OtpErrorCode =
  | "OTP_INVALID_COUNTER"
  | "OTP_INVALID_ITEM"
  | "OTP_INVALID_SECRET"
  | "OTP_INVALID_TIME"
  | "OTP_INVALID_URI"
  | "OTP_URI_UNREPRESENTABLE"
  | "OTP_RESERVATION_BINDING"
  | "OTP_RESERVATION_BUSY"
  | "OTP_RESERVATION_CAPACITY"
  | "OTP_RESERVATION_EXPIRED"
  | "OTP_RESERVATION_NOT_FOUND"
  | "OTP_RESERVATION_STALE"
  | "OTP_RESERVATION_UNCERTAIN";

export class OtpError extends Error {
  readonly code: OtpErrorCode;

  constructor(code: OtpErrorCode) {
    super(code);
    this.name = "OtpError";
    this.code = code;
  }
}
