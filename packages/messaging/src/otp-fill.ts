import {
  isUnicodeScalarText,
  MAX_ITEM_TAG_LENGTH,
  MAX_ITEM_TAGS,
  MAX_OTP_ISSUER_LENGTH,
  MAX_OTP_LABEL_LENGTH,
} from "@shardpass/domain";
import { z } from "zod/mini";

import type { CommandSenderPolicy } from "./context";
import { MESSAGE_VERSION } from "./envelope";

export const OTP_FILL_LIMITS = Object.freeze({
  suggestionTtlMs: 300_000,
  releaseTtlMs: 5_000,
  terminalRetentionMs: 60_000,
  maxSuggestions: 10_000,
  maxCapabilitiesPerDocument: 4,
  maxCapabilitiesGlobal: 256,
  maxReleasesGlobal: 256,
  maxDiscoveryNodesPerPass: 256,
  maxDiscoveredFieldsPerFrame: 32,
  maxDiscoveryPassesPerSecond: 10,
});

const opaque = z.string().check(z.minLength(16), z.maxLength(256), z.regex(/^[A-Za-z0-9_-]+$/u));
const itemId = z.uuid();
const positiveSafeInteger = z.int().check(z.positive(), z.maximum(Number.MAX_SAFE_INTEGER));
const timestamp = z.number().check(z.int(), z.nonnegative(), z.maximum(Number.MAX_SAFE_INTEGER));
const unicode = (maximum: number) =>
  z.string().check(z.maxLength(maximum), z.refine(isUnicodeScalarText));
const trimmedUnicode = (minimum: number, maximum: number) =>
  unicode(maximum).check(
    z.minLength(minimum),
    z.refine((value) => value === value.trim()),
  );
const tags = z.array(trimmedUnicode(1, MAX_ITEM_TAG_LENGTH)).check(z.maxLength(MAX_ITEM_TAGS));
const otpType = z.enum(["totp", "hotp", "steam"]);

export const OtpFillSuggestionSchema = z.strictObject({
  itemId,
  expectedRevision: positiveSafeInteger,
  issuer: trimmedUnicode(0, MAX_OTP_ISSUER_LENGTH),
  label: trimmedUnicode(1, MAX_OTP_LABEL_LENGTH),
  otpType,
  favorite: z.boolean(),
  tags,
  /** The account belongs to the page's site (issuer, label, or a login saved for it says so). */
  siteMatch: z.optional(z.boolean()),
});

export const OtpFillSuggestionsRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("otp.fillSuggestions"),
  requestId: opaque,
  fieldHandle: opaque,
});
export const OtpFillSelectRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("otp.fillSelect"),
  capability: opaque,
  itemId,
  expectedRevision: positiveSafeInteger,
  fieldHandle: opaque,
});
export const OtpFillConfirmRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("otp.fillConfirm"),
  releaseId: opaque,
  fieldHandle: opaque,
  result: z.enum(["filled", "failed"]),
});
export const OtpFillCancelRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("otp.fillCancel"),
  releaseId: opaque,
  fieldHandle: opaque,
});

export const OtpFillRequestSchema = z.discriminatedUnion("kind", [
  OtpFillSuggestionsRequestSchema,
  OtpFillSelectRequestSchema,
  OtpFillConfirmRequestSchema,
  OtpFillCancelRequestSchema,
]);

export const OtpFillSuggestionsResultSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("otp.fillSuggestionsResult"),
  capability: opaque,
  expiresAt: timestamp,
  suggestions: z.array(OtpFillSuggestionSchema).check(z.maxLength(OTP_FILL_LIMITS.maxSuggestions)),
});
export const OtpFillReleaseSchema = z
  .strictObject({
    version: z.literal(MESSAGE_VERSION),
    kind: z.literal("otp.fillRelease"),
    releaseId: opaque,
    code: z.string().check(z.minLength(5), z.maxLength(10)),
    expiresAt: timestamp,
    codeLength: z.int().check(z.minimum(5), z.maximum(10)),
    characterClass: z.enum(["digits", "steam"]),
  })
  .check(
    z.refine(
      (value) =>
        value.code.length === value.codeLength &&
        (value.characterClass === "digits"
          ? /^\d{5,10}$/u.test(value.code)
          : /^[23456789BCDFGHJKMNPQRTVWXY]{5}$/u.test(value.code)),
    ),
  );
export const OtpFillConfirmedSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("otp.fillConfirmed"),
  result: z.enum(["committed", "cancelled", "uncertain"]),
});
export const OtpFillCancelledSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("otp.fillCancelled"),
  cancelled: z.literal(true),
});
export const OtpFillResponseSchema = z.discriminatedUnion("kind", [
  OtpFillSuggestionsResultSchema,
  OtpFillReleaseSchema,
  OtpFillConfirmedSchema,
  OtpFillCancelledSchema,
]);

export type OtpFillSuggestion = Readonly<z.infer<typeof OtpFillSuggestionSchema>>;
export type OtpFillRequest = z.infer<typeof OtpFillRequestSchema>;
export type OtpFillResponse = z.infer<typeof OtpFillResponseSchema>;
export type OtpFillCommandKind = OtpFillRequest["kind"];
export type OtpFillResponseKind = OtpFillResponse["kind"];

export const otpFillResponseKindByRequest = {
  "otp.fillSuggestions": "otp.fillSuggestionsResult",
  "otp.fillSelect": "otp.fillRelease",
  "otp.fillConfirm": "otp.fillConfirmed",
  "otp.fillCancel": "otp.fillCancelled",
} as const satisfies Record<OtpFillCommandKind, OtpFillResponseKind>;

export function parseOtpFillResponseForRequest(request: OtpFillRequest, candidate: unknown) {
  const parsed = OtpFillResponseSchema.safeParse(candidate);
  if (!parsed.success || parsed.data.kind !== otpFillResponseKindByRequest[request.kind])
    return { success: false as const };
  return { success: true as const, data: parsed.data };
}

const contentOnly = {
  allowedContexts: ["content"],
  requireTab: true,
  requireFrame: true,
  requireDocument: true,
} as const;

export const otpFillSenderPolicy = {
  "otp.fillSuggestions": contentOnly,
  "otp.fillSelect": contentOnly,
  "otp.fillConfirm": contentOnly,
  "otp.fillCancel": contentOnly,
} satisfies Record<OtpFillCommandKind, CommandSenderPolicy>;
