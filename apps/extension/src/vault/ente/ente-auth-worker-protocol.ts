import { z } from "zod/mini";

import { ENTE_SYNC_LIMITS, MAX_ENTE_ERROR_DETAIL_LENGTH } from "../../background/ente/protocol";

const bytes = (maximum: number) =>
  z.instanceof(Uint8Array).check(z.refine((value) => value.byteLength <= maximum));
const capability = z.string().check(z.regex(/^[a-f0-9]{64}$/u));

export const EnteAuthWorkerRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("ente.auth.password"),
    jobId: z.uuid(),
    emailUtf8: bytes(ENTE_SYNC_LIMITS.maxEmailUtf8Bytes),
    passwordUtf8: bytes(ENTE_SYNC_LIMITS.maxPasswordUtf8Bytes),
    handoffCapability: capability,
    handoffPublicKey: bytes(32),
  }),
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("ente.auth.totp"),
    jobId: z.uuid(),
    capability,
    codeUtf8: bytes(ENTE_SYNC_LIMITS.maxOtpCodeLength),
  }),
]);

export const EnteAuthWorkerResponseSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("ente.auth.complete"),
    jobId: z.uuid(),
    capability,
    ciphertext: bytes(4_256).check(z.minLength(49)),
  }),
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("ente.auth.totp-required"),
    jobId: z.uuid(),
    capability,
  }),
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("ente.auth.error"),
    jobId: z.uuid(),
    code: z.enum([
      "ENTE_INVALID",
      "ENTE_UNAVAILABLE",
      "ENTE_AUTH_FAILED",
      "ENTE_SRP_UNSUPPORTED",
      "ENTE_PROTOCOL_DRIFT",
      "ENTE_LIMIT_REACHED",
      "ENTE_REAUTH_REQUIRED",
    ]),
    /** Which step or request failed; never a secret or a body. */
    detail: z.optional(z.string().check(z.maxLength(MAX_ENTE_ERROR_DETAIL_LENGTH))),
  }),
]);
export type EnteAuthWorkerRequest = z.infer<typeof EnteAuthWorkerRequestSchema>;
export type EnteAuthWorkerResponse = z.infer<typeof EnteAuthWorkerResponseSchema>;
