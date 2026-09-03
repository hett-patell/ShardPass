export type SafeErrorCode =
  | "CHALLENGE_INVALID"
  | "INVALID_CREDENTIALS"
  | "INVALID_MESSAGE"
  | "OTP_INVALID"
  | "OTP_IMPORT_INVALID"
  | "OTP_IMPORT_LIMIT"
  | "OTP_IMPORT_EXPIRED"
  | "OTP_IMPORT_CAPACITY"
  | "OTP_IMPORT_UNAVAILABLE"
  | "OTP_NOT_FOUND"
  | "OTP_CONFLICT"
  | "OTP_HOTP_REQUIRED"
  | "OTP_RESERVATION_INVALID"
  | "OTP_RESERVATION_STALE"
  | "OTP_RESERVATION_UNCERTAIN"
  | "OTP_FILL_INVALID"
  | "OTP_FILL_UNAVAILABLE"
  | "OTP_FILL_EXPIRED"
  | "OTP_FILL_FIELD_CHANGED"
  | "OTP_FILL_ITEM_CHANGED"
  | "OTP_FILL_CANCELLED"
  | "OTP_FILL_UNCERTAIN"
  | "ITEM_INVALID"
  | "ITEM_NOT_FOUND"
  | "ITEM_CONFLICT"
  | "FOLDER_INVALID"
  | "FOLDER_NOT_FOUND"
  | "LOGIN_FILL_INVALID"
  | "LOGIN_FILL_UNAVAILABLE"
  | "LOGIN_FILL_NOT_FOUND"
  | "LOGIN_FILL_ITEM_CHANGED"
  | "PASSWORD_GEN_INVALID"
  | "CLIPBOARD_UNAVAILABLE"
  | "BACKUP_INVALID"
  | "BACKUP_AUTH_FAILED"
  | "BACKUP_EXPIRED"
  | "BACKUP_CHANGED"
  | "BACKUP_CAPACITY"
  | "BACKUP_UNAVAILABLE"
  | "ENTE_INVALID"
  | "ENTE_UNAVAILABLE"
  | "ENTE_AUTH_FAILED"
  | "ENTE_TOTP2FA_REQUIRED"
  | "ENTE_REAUTH_REQUIRED"
  | "ENTE_SRP_UNSUPPORTED"
  | "ENTE_PROTOCOL_DRIFT"
  | "ENTE_LIMIT_REACHED"
  | "ENTE_TIMESTAMP_AMBIGUOUS"
  | "ENTE_CONFLICT"
  | "ENTE_CREATE_UNCERTAIN"
  | "ENTE_WRITE_UNCERTAIN"
  | "ENTE_STORAGE_CHANGED"
  | "ENTE_STORAGE_FAILED"
  | "ENTE_DEPENDENCY_INTEGRITY"
  | "ENTE_PERMISSION_DENIED"
  | "ENTE_AUTH_KEY_MISSING"
  | "THROTTLED"
  | "UNAUTHORIZED_SENDER"
  | "UNSUPPORTED_CONTEXT"
  | "VAULT_ALREADY_CONFIGURED"
  | "VAULT_LOCKED"
  | "VAULT_NOT_CONFIGURED"
  | "VAULT_UNAVAILABLE"
  | "UNEXPECTED";

const messages: Readonly<Record<SafeErrorCode, string>> = {
  CHALLENGE_INVALID: "That secure request expired. Try again.",
  INVALID_CREDENTIALS: "The password is incorrect or the vault cannot be verified.",
  INVALID_MESSAGE: "The request was invalid.",
  OTP_INVALID: "The authenticator item is invalid.",
  OTP_IMPORT_INVALID: "The import request is invalid.",
  OTP_IMPORT_LIMIT: "The import exceeds the supported limit.",
  OTP_IMPORT_EXPIRED: "That import preview expired. Preview it again.",
  OTP_IMPORT_CAPACITY: "The vault does not have capacity for this import.",
  OTP_IMPORT_UNAVAILABLE: "The import could not be verified. Preview it again.",
  OTP_NOT_FOUND: "The authenticator item was not found.",
  OTP_CONFLICT: "This item changed. Review the latest version and try again.",
  OTP_HOTP_REQUIRED: "This code is available only for a confirmed fill.",
  OTP_RESERVATION_INVALID: "This code reservation is invalid or expired.",
  OTP_RESERVATION_STALE: "This item changed before the code could be confirmed.",
  OTP_RESERVATION_UNCERTAIN: "The code confirmation could not be verified.",
  OTP_FILL_INVALID: "This fill request is invalid.",
  OTP_FILL_UNAVAILABLE: "One-time code fill is unavailable.",
  OTP_FILL_EXPIRED: "This one-time code fill expired.",
  OTP_FILL_FIELD_CHANGED: "The one-time code field changed.",
  OTP_FILL_ITEM_CHANGED: "This one-time code account changed.",
  OTP_FILL_CANCELLED: "This one-time code fill was cancelled.",
  OTP_FILL_UNCERTAIN: "The one-time code confirmation could not be verified.",
  ITEM_INVALID: "The item is invalid.",
  ITEM_NOT_FOUND: "The item was not found.",
  ITEM_CONFLICT: "This item changed. Review the latest version and try again.",
  FOLDER_INVALID: "That folder name is already used here, or the folder is nested too deep.",
  FOLDER_NOT_FOUND: "That folder no longer exists.",
  LOGIN_FILL_INVALID: "This fill request is invalid.",
  LOGIN_FILL_UNAVAILABLE: "Login fill is unavailable.",
  LOGIN_FILL_NOT_FOUND: "This saved login was not found.",
  LOGIN_FILL_ITEM_CHANGED: "This saved login changed.",
  PASSWORD_GEN_INVALID: "Those password options are invalid.",
  CLIPBOARD_UNAVAILABLE: "Copy failed. Try again.",
  BACKUP_INVALID: "The backup request is invalid.",
  BACKUP_AUTH_FAILED: "The current password could not be verified.",
  BACKUP_EXPIRED: "That backup authorization expired. Try again.",
  BACKUP_CHANGED: "The vault changed. Review the backup preview again.",
  BACKUP_CAPACITY: "The vault does not have capacity for this backup.",
  BACKUP_UNAVAILABLE: "The backup could not be verified. Try again.",
  ENTE_INVALID: "The Ente request is invalid.",
  ENTE_UNAVAILABLE: "Ente is unavailable. Try again later.",
  ENTE_AUTH_FAILED: "Ente authentication failed.",
  ENTE_TOTP2FA_REQUIRED: "Enter your Ente authenticator code.",
  ENTE_REAUTH_REQUIRED: "Reconnect your Ente account.",
  ENTE_SRP_UNSUPPORTED: "This Ente account is not supported.",
  ENTE_PROTOCOL_DRIFT: "The Ente response was not recognized.",
  ENTE_LIMIT_REACHED: "The Ente sync limit was reached.",
  ENTE_TIMESTAMP_AMBIGUOUS: "Ente changes could not be ordered safely.",
  ENTE_CONFLICT: "Review the Ente synchronization conflict.",
  ENTE_CREATE_UNCERTAIN: "An Ente create may have completed.",
  ENTE_WRITE_UNCERTAIN: "An Ente change may have completed.",
  ENTE_STORAGE_CHANGED: "The vault changed during Ente synchronization.",
  ENTE_STORAGE_FAILED: "Ente synchronization state could not be stored.",
  ENTE_DEPENDENCY_INTEGRITY: "Ente cryptography could not be verified.",
  ENTE_PERMISSION_DENIED: "This Ente action is not allowed here.",
  ENTE_AUTH_KEY_MISSING: "This Ente account does not have an Authenticator key.",
  THROTTLED: "Too many attempts. Wait before trying again.",
  UNAUTHORIZED_SENDER: "This action is not allowed here.",
  UNSUPPORTED_CONTEXT: "This page context is not supported.",
  VAULT_ALREADY_CONFIGURED: "A vault is already configured.",
  VAULT_LOCKED: "Unlock the vault to continue.",
  VAULT_NOT_CONFIGURED: "Set up the vault to continue.",
  VAULT_UNAVAILABLE: "The vault could not be verified.",
  UNEXPECTED: "Something went wrong. Try again.",
};

export type SafeError = Readonly<{
  code: SafeErrorCode;
  message: string;
}>;

export function toSafeError(_error: unknown, fallback: SafeErrorCode): SafeError {
  return { code: fallback, message: messages[fallback] };
}
