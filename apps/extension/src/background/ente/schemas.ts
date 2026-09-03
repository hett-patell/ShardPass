import { z } from "zod/mini";

import { ENTE_SYNC_LIMITS, type EnteOtpProjection } from "./protocol";

const strict = z.strictObject;
/**
 * Responses are parsed tolerantly: unknown keys are stripped, never fatal. The server adds
 * fields as the API evolves (userID and createdAt on the key, more on entities), and a
 * client that treats a new field as protocol drift stops syncing on every such release.
 * Requests we send remain strict -- those we control.
 */
const tolerant = z.object;
const canonicalBase64 = (max: number) =>
  z.string().check(
    z.maxLength(max),
    z.refine((value) => {
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value))
        return false;
      try {
        const binary = atob(value);
        return btoa(binary) === value;
      } catch {
        return false;
      }
    }),
  );
const uuid = z.uuid().check(z.refine((value) => value === value.toLowerCase()));
const safeTimestamp = z.int().check(z.nonnegative(), z.maximum(ENTE_SYNC_LIMITS.maxSafeTimestamp));
const positiveBounded = z.int().check(z.positive(), z.maximum(ENTE_SYNC_LIMITS.maxSafeTimestamp));
const b64 = canonicalBase64(ENTE_SYNC_LIMITS.maxBase64TextBytes);
const ciphertext = canonicalBase64(ENTE_SYNC_LIMITS.maxCiphertextBytes);
const header = canonicalBase64(ENTE_SYNC_LIMITS.maxHeaderBytes);

export const srpAttributesResponseSchema = tolerant({
  attributes: tolerant({
    srpUserID: uuid,
    srpSalt: b64,
    memLimit: positiveBounded,
    opsLimit: positiveBounded,
    kekSalt: b64,
    isEmailMFAEnabled: z.boolean(),
  }),
});
export const createSrpSessionRequestSchema = strict({ srpUserID: uuid, srpA: b64 });
export const createSrpSessionResponseSchema = tolerant({ sessionID: uuid, srpB: b64 });
export const verifySrpSessionRequestSchema = strict({
  sessionID: uuid,
  srpUserID: uuid,
  srpM1: b64,
});
export const verifySrpSessionResponseSchema = tolerant({
  srpM2: b64,
  id: safeTimestamp,
  token: z.optional(b64),
  encryptedToken: z.optional(b64),
  twoFactorSessionID: z.optional(uuid),
  // Newer servers send the V2 id (alongside or instead of the original); a passkey-only
  // account sends passkeySessionID and no token. Both are real responses, not drift.
  twoFactorSessionIDV2: z.optional(uuid),
  passkeySessionID: z.optional(uuid),
  keyAttributes: z.optional(z.unknown()),
});
export const totpTwoFactorVerifyRequestSchema = strict({
  code: z.string().check(z.regex(/^\d{6,10}$/u)),
  sessionID: uuid,
});
export const totpTwoFactorVerifyResponseSchema = tolerant({
  id: safeTimestamp,
  encryptedToken: b64,
  keyAttributes: z.unknown(),
});
export const authenticatorKeyResponseSchema = tolerant({ encryptedKey: ciphertext, header });

const liveEntity = tolerant({
  id: uuid,
  encryptedData: ciphertext,
  header,
  isDeleted: z.literal(false),
  createdAt: z.optional(safeTimestamp),
  updatedAt: safeTimestamp,
});
const deletedEntity = tolerant({
  id: uuid,
  encryptedData: z.nullish(ciphertext),
  header: z.nullish(header),
  isDeleted: z.literal(true),
  createdAt: z.optional(safeTimestamp),
  updatedAt: safeTimestamp,
});
export const authenticatorEntitySchema = z.discriminatedUnion("isDeleted", [
  liveEntity,
  deletedEntity,
]);
export const authenticatorEntityDiffResponseSchema = tolerant({
  diff: z.array(authenticatorEntitySchema).check(z.maxLength(ENTE_SYNC_LIMITS.pageSize)),
  timestamp: z.nullish(safeTimestamp),
});
export const createEntityRequestSchema = strict({ encryptedData: ciphertext, header });
export const createEntityResponseSchema = liveEntity;
export const updateEntityRequestSchema = strict({ id: uuid, encryptedData: ciphertext, header });
export const deleteEntityQuerySchema = strict({ id: uuid });

export const enteOtpProjectionSchema = strict({
  version: z.literal(1),
  kind: z.literal("otp"),
  otpType: z.enum(["totp", "hotp", "steam"]),
  issuer: z.string(),
  label: z.string(),
  secretBase32: z.string().check(z.regex(/^[A-Z2-7]+=*$/u)),
  algorithm: z.enum(["SHA1", "SHA256", "SHA512"]),
  digits: z.int().check(z.minimum(5), z.maximum(10)),
  period: z.optional(z.int().check(z.positive())),
  counter: z.optional(z.int().check(z.nonnegative())),
  notes: z.optional(z.string()),
  tags: z.optional(z.readonly(z.array(z.string()))),
});
export type EnteOtpAdapterInput = EnteOtpProjection;
void (enteOtpProjectionSchema satisfies z.ZodMiniType);
