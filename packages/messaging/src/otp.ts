import {
  isCanonicalUnpaddedBase32,
  isUnicodeScalarText,
  MAX_ITEM_TAG_LENGTH,
  MAX_ITEM_TAGS,
  MAX_OTP_ISSUER_LENGTH,
  MAX_OTP_LABEL_LENGTH,
  MAX_OTP_NOTE_LENGTH,
  MAX_OTP_PERIOD_SECONDS,
  MAX_OTP_SECRET_LENGTH,
} from "@shardpass/domain";
import { z } from "zod/mini";

import type { CommandSenderPolicy } from "./context";
import { MESSAGE_VERSION } from "./envelope";

export const MAX_OTP_SEARCH_QUERY_LENGTH = 256;
export const MAX_OTP_LIST_ITEMS = 10_000;

const itemId = z.uuid();
const reservationId = z.uuid();
const positiveSafeInteger = z.int().check(z.positive(), z.maximum(Number.MAX_SAFE_INTEGER));
const nonnegativeSafeInteger = z.int().check(z.nonnegative(), z.maximum(Number.MAX_SAFE_INTEGER));
const finiteTimestamp = z
  .number()
  .check(z.int(), z.nonnegative(), z.maximum(Number.MAX_SAFE_INTEGER));
const unicodeString = (maximum: number) =>
  z.string().check(z.maxLength(maximum), z.refine(isUnicodeScalarText));
const trimmedUnicodeString = (minimum: number, maximum: number) =>
  unicodeString(maximum).check(
    z.minLength(minimum),
    z.refine((value) => value === value.trim()),
  );
const otpType = z.enum(["totp", "hotp", "steam"]);
const algorithm = z.enum(["SHA1", "SHA256", "SHA512"]);
const tags = z.array(trimmedUnicodeString(1, MAX_ITEM_TAG_LENGTH)).check(
  z.maxLength(MAX_ITEM_TAGS),
  z.refine(
    (values) =>
      new Set(values.map((value) => value.normalize("NFKC").toLocaleLowerCase("en-US"))).size ===
      values.length,
  ),
);

export const OtpEditableInputSchema = z
  .strictObject({
    issuer: trimmedUnicodeString(0, MAX_OTP_ISSUER_LENGTH),
    label: trimmedUnicodeString(1, MAX_OTP_LABEL_LENGTH),
    secret: z
      .string()
      .check(
        z.minLength(1),
        z.maxLength(MAX_OTP_SECRET_LENGTH),
        z.refine(isCanonicalUnpaddedBase32),
      ),
    otpType,
    algorithm,
    digits: z.int().check(z.minimum(5), z.maximum(10)),
    period: z.int().check(z.nonnegative(), z.maximum(MAX_OTP_PERIOD_SECONDS)),
    counter: z.optional(nonnegativeSafeInteger),
    favorite: z.boolean(),
    tags,
    note: unicodeString(MAX_OTP_NOTE_LENGTH),
  })
  .check(
    z.refine((input) =>
      input.otpType === "hotp"
        ? input.counter !== undefined && input.period === 0
        : input.counter === undefined && input.period > 0,
    ),
    z.refine((input) =>
      input.otpType === "steam"
        ? input.algorithm === "SHA1" && input.digits === 5 && input.period === 30
        : input.digits >= 6,
    ),
  );

export const OtpCreateInputSchema = OtpEditableInputSchema;

export const OtpListItemProjectionSchema = z.strictObject({
  id: itemId,
  revision: positiveSafeInteger,
  issuer: trimmedUnicodeString(0, MAX_OTP_ISSUER_LENGTH),
  label: trimmedUnicodeString(1, MAX_OTP_LABEL_LENGTH),
  otpType,
  favorite: z.boolean(),
  tags,
});

export const OtpEditorProjectionSchema = z.extend(OtpEditableInputSchema, {
  id: itemId,
  revision: positiveSafeInteger,
});

export const OtpCodeProjectionSchema = z
  .strictObject({
    itemId,
    revision: positiveSafeInteger,
    code: z.string().check(z.minLength(5), z.maxLength(10)),
    otpType: z.enum(["totp", "steam"]),
    period: z.int().check(z.positive(), z.maximum(MAX_OTP_PERIOD_SECONDS)),
    remaining: z.int().check(z.nonnegative(), z.maximum(MAX_OTP_PERIOD_SECONDS)),
    expiresAt: finiteTimestamp,
  })
  .check(
    z.refine((projection) =>
      projection.otpType === "steam"
        ? /^[23456789BCDFGHJKMNPQRTVWXY]{5}$/u.test(projection.code) &&
          projection.period === 30 &&
          projection.remaining <= 30
        : /^\d{6,10}$/u.test(projection.code) && projection.remaining <= projection.period,
    ),
  );

export const OtpListRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("otp.list"),
  query: unicodeString(MAX_OTP_SEARCH_QUERY_LENGTH),
});
export const OtpGetEditorRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("otp.getEditor"),
  itemId,
});
export const OtpCreateRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("otp.create"),
  input: OtpCreateInputSchema,
});
export const OtpUpdateRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("otp.update"),
  itemId,
  expectedRevision: positiveSafeInteger,
  input: OtpEditableInputSchema,
});
export const OtpDeleteRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("otp.delete"),
  itemId,
  expectedRevision: positiveSafeInteger,
});
const itemRequest = (kind: "otp.getCode" | "otp.reserveHotp") =>
  z.strictObject({ version: z.literal(MESSAGE_VERSION), kind: z.literal(kind), itemId });
export const OtpGetCodeRequestSchema = itemRequest("otp.getCode");
export const OtpCopyCodeRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("otp.copyCode"),
  itemId,
  expectedRevision: positiveSafeInteger,
});
export const OtpReserveHotpRequestSchema = itemRequest("otp.reserveHotp");
const reservationRequest = (kind: "otp.commitHotp" | "otp.cancelHotp") =>
  z.strictObject({ version: z.literal(MESSAGE_VERSION), kind: z.literal(kind), reservationId });
export const OtpCommitHotpRequestSchema = reservationRequest("otp.commitHotp");
export const OtpCancelHotpRequestSchema = reservationRequest("otp.cancelHotp");

export const OtpRequestSchema = z.discriminatedUnion("kind", [
  OtpListRequestSchema,
  OtpGetEditorRequestSchema,
  OtpCreateRequestSchema,
  OtpUpdateRequestSchema,
  OtpDeleteRequestSchema,
  OtpGetCodeRequestSchema,
  OtpCopyCodeRequestSchema,
  OtpReserveHotpRequestSchema,
  OtpCommitHotpRequestSchema,
  OtpCancelHotpRequestSchema,
]);

export const OtpListResultSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("otp.listResult"),
  items: z.array(OtpListItemProjectionSchema).check(z.maxLength(MAX_OTP_LIST_ITEMS)),
});
export const OtpEditorResultSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("otp.editorResult"),
  item: OtpEditorProjectionSchema,
});
export const OtpMutationResultSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("otp.mutationResult"),
  item: OtpListItemProjectionSchema,
});
export const OtpDeleteResultSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("otp.deleteResult"),
  itemId,
  revision: positiveSafeInteger,
});
export const OtpCodeResultSchema = z.extend(OtpCodeProjectionSchema, {
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("otp.codeResult"),
});
export const OtpHotpReservedSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("otp.hotpReserved"),
  reservationId,
  itemId,
  itemRevision: positiveSafeInteger,
  counter: nonnegativeSafeInteger,
  code: z.string().check(z.regex(/^\d{6,10}$/u)),
  expiresAt: finiteTimestamp,
});
export const OtpHotpCommittedSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("otp.hotpCommitted"),
  reservationId,
  revision: positiveSafeInteger,
  counter: nonnegativeSafeInteger,
});
export const OtpHotpCancelledSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("otp.hotpCancelled"),
  reservationId,
  cancelled: z.boolean(),
});

export const OtpResponseSchema = z.discriminatedUnion("kind", [
  OtpListResultSchema,
  OtpEditorResultSchema,
  OtpMutationResultSchema,
  OtpDeleteResultSchema,
  OtpCodeResultSchema,
  OtpHotpReservedSchema,
  OtpHotpCommittedSchema,
  OtpHotpCancelledSchema,
]);

export type OtpEditableInput = z.infer<typeof OtpEditableInputSchema>;
export type OtpCreateInput = z.infer<typeof OtpCreateInputSchema>;
export type OtpListItemProjection = z.infer<typeof OtpListItemProjectionSchema>;
export type OtpEditorProjection = z.infer<typeof OtpEditorProjectionSchema>;
export type OtpCodeProjection = z.infer<typeof OtpCodeProjectionSchema>;
export type OtpRequest = z.infer<typeof OtpRequestSchema>;
export type OtpResponse = z.infer<typeof OtpResponseSchema>;
export type OtpCommandKind = OtpRequest["kind"];
export type OtpResponseKind = OtpResponse["kind"];

export const otpResponseKindByRequest = {
  "otp.list": "otp.listResult",
  "otp.getEditor": "otp.editorResult",
  "otp.create": "otp.mutationResult",
  "otp.update": "otp.mutationResult",
  "otp.delete": "otp.deleteResult",
  "otp.getCode": "otp.codeResult",
  "otp.copyCode": "otp.codeResult",
  "otp.reserveHotp": "otp.hotpReserved",
  "otp.commitHotp": "otp.hotpCommitted",
  "otp.cancelHotp": "otp.hotpCancelled",
} as const satisfies Record<OtpCommandKind, OtpResponseKind>;

export function parseOtpResponseForRequest(request: OtpRequest, candidate: unknown) {
  const parsed = OtpResponseSchema.safeParse(candidate);
  if (!parsed.success || parsed.data.kind !== otpResponseKindByRequest[request.kind]) {
    return { success: false as const };
  }
  return { success: true as const, data: parsed.data };
}

const popupAndVault = { allowedContexts: ["popup", "vault"], requireDocument: true } as const;
const vaultOnly = { allowedContexts: ["vault"], requireDocument: true } as const;
const internalOnly = { allowedContexts: [], requireDocument: true } as const;

export const otpSenderPolicy = {
  "otp.list": popupAndVault,
  "otp.getEditor": vaultOnly,
  "otp.create": vaultOnly,
  "otp.update": vaultOnly,
  "otp.delete": vaultOnly,
  "otp.getCode": popupAndVault,
  "otp.copyCode": popupAndVault,
  "otp.reserveHotp": internalOnly,
  "otp.commitHotp": internalOnly,
  "otp.cancelHotp": internalOnly,
} satisfies Record<OtpCommandKind, CommandSenderPolicy>;
