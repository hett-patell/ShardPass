import { z } from "zod/mini";

import { MESSAGE_VERSION } from "./envelope";

export const LoginFillSuggestionSchema = z.strictObject({
  itemId: z.uuid(),
  expectedRevision: z.int().check(z.positive()),
  name: z.string(),
  username: z.string(),
  favorite: z.boolean(),
  tags: z.array(z.string()),
  hasLinkedOtp: z.boolean(),
});

export type LoginFillSuggestion = z.infer<typeof LoginFillSuggestionSchema>;

export const LoginFillSuggestionsRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("login.fillSuggestions"),
  domain: z.string().check(z.minLength(1), z.maxLength(2048)),
});

export const LoginFillSuggestionsResponseSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("login.fillSuggestionsResult"),
  suggestions: z.array(LoginFillSuggestionSchema).check(z.maxLength(10000)),
});

export const LoginFillSelectRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("login.fillSelect"),
  itemId: z.uuid(),
  expectedRevision: z.int().check(z.positive()),
});

export const LoginFillReleaseResponseSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("login.fillRelease"),
  username: z.string(),
  password: z.string(),
  linkedOtpCode: z.optional(z.string()),
});

export const LoginFillConfirmRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("login.fillConfirm"),
  itemId: z.uuid(),
});

export const LoginFillCancelRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("login.fillCancel"),
  itemId: z.uuid(),
});

export const SaveLoginOfferRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("login.saveOffer"),
  domain: z.string(),
  username: z.string(),
  password: z.string(),
});

export const LoginFillRequestSchema = z.union([
  LoginFillSuggestionsRequestSchema,
  LoginFillSelectRequestSchema,
  LoginFillConfirmRequestSchema,
  LoginFillCancelRequestSchema,
  SaveLoginOfferRequestSchema,
]);

export const LoginFillResponseSchema = z.union([
  LoginFillSuggestionsResponseSchema,
  LoginFillReleaseResponseSchema,
]);
