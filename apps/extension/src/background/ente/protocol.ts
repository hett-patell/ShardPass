import type { ZodMiniType } from "zod/mini";

export const ENTE_PROTOCOL_PIN = "c69dcf66704ad7ec1f95e32920455be429a566ef" as const;
export const ENTE_API_ORIGIN = "https://api.ente.io" as const;

export const ENTE_SYNC_LIMITS = Object.freeze({
  pageSize: 2_500,
  maxPagesPerIncremental: 40,
  maxPagesPerSnapshot: 40,
  maxRemoteChanges: 100_000,
  maxLiveRemoteEntities: 10_000,
  maxLocalMappedItems: 10_000,
  maxPendingOperations: 10_000,
  maxConflicts: 10_000,
  maxResponseBytes: 16 * 1024 * 1024,
  maxCycleResponseBytes: 64 * 1024 * 1024,
  maxCiphertextBytes: 1024 * 1024,
  maxHeaderBytes: 4_096,
  maxDecryptedEntityBytes: 64 * 1024,
  maxCanonicalOtpUriBytes: 16 * 1024,
  maxEmailUtf8Bytes: 320,
  maxPasswordUtf8Bytes: 1_024,
  maxOtpCodeLength: 10,
  maxBase64TextBytes: 2 * 1024 * 1024,
  maxSafeTimestamp: 9_007_199_254_740_991,
  requestTimeoutMs: 30_000,
  cycleTimeoutMs: 120_000,
  schedulerMinutes: 15,
  maxMutationAttempts: 8,
  maxDiagnosticEventsPerCycle: 256,
});

/** @deprecated Current code uses the complete ENTE_SYNC_LIMITS contract. */
export const ENTE_SNAPSHOT_LIMITS = Object.freeze({ pageSize: 2_500, maxPages: 40 });

export const ENTE_PROTOCOL_ENDPOINTS = Object.freeze([
  ["GET", "/users/srp/attributes"],
  ["POST", "/users/srp/create-session"],
  ["POST", "/users/srp/verify-session"],
  ["POST", "/users/two-factor/verify"],
  ["GET", "/authenticator/key"],
  ["GET", "/authenticator/entity/diff"],
  ["POST", "/authenticator/entity"],
  ["PUT", "/authenticator/entity"],
  ["DELETE", "/authenticator/entity"],
] as const);

export type EnteErrorCode =
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
  | "ENTE_AUTH_KEY_MISSING";

export type EnteOtpProjection = Readonly<{
  version: 1;
  kind: "otp";
  otpType: "totp" | "hotp" | "steam";
  issuer: string;
  label: string;
  secretBase32: string;
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: 6 | 7 | 8;
  period?: number;
  counter?: number;
  notes?: string;
  tags?: readonly string[];
}>;

export class EnteProtocolError extends Error {
  readonly code: EnteErrorCode;
  constructor(code: EnteErrorCode = "ENTE_PROTOCOL_DRIFT") {
    super("Ente protocol response rejected");
    this.name = "EnteProtocolError";
    this.code = code;
  }
}

export function parseEnteProtocolResponse<T>(schema: ZodMiniType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new EnteProtocolError();
  return result.data;
}
