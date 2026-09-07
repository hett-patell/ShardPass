import { z } from "zod/mini";

import type { CommandSenderPolicy } from "./context";
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
  /** Full page URL when known; lets path-sensitive match modes ("startsWith", "exact") apply. */
  pageUrl: z.optional(z.string().check(z.minLength(1), z.maxLength(2048))),
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

/**
 * The popup's copy action: the same release as fillSelect, but from an extension page
 * rather than a content script, so it is a deliberate act by the person, not a page.
 */
export const LoginRevealRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("login.reveal"),
  itemId: z.uuid(),
  expectedRevision: z.int().check(z.positive()),
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

export const LoginFillRequestSchema = z.discriminatedUnion("kind", [
  LoginFillSuggestionsRequestSchema,
  LoginFillSelectRequestSchema,
  LoginRevealRequestSchema,
  LoginFillConfirmRequestSchema,
  LoginFillCancelRequestSchema,
  SaveLoginOfferRequestSchema,
]);

/** Acknowledges a fire-and-forget command (confirm, cancel, save-offer) that carries no data. */
export const LoginFillAckSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("login.fillAck"),
  ok: z.literal(true),
});

export const LoginFillResponseSchema = z.discriminatedUnion("kind", [
  LoginFillSuggestionsResponseSchema,
  LoginFillReleaseResponseSchema,
  LoginFillAckSchema,
]);

export type LoginFillRequest = z.infer<typeof LoginFillRequestSchema>;
export type LoginFillResponse = z.infer<typeof LoginFillResponseSchema>;
export type LoginFillCommandKind = LoginFillRequest["kind"];
export type LoginFillResponseKind = LoginFillResponse["kind"];

export const loginFillResponseKindByRequest = {
  "login.fillSuggestions": "login.fillSuggestionsResult",
  "login.fillSelect": "login.fillRelease",
  "login.reveal": "login.fillRelease",
  "login.fillConfirm": "login.fillAck",
  "login.fillCancel": "login.fillAck",
  "login.saveOffer": "login.fillAck",
} as const satisfies Record<LoginFillCommandKind, LoginFillResponseKind>;

export function parseLoginFillResponseForRequest(request: LoginFillRequest, candidate: unknown) {
  const parsed = LoginFillResponseSchema.safeParse(candidate);
  if (!parsed.success || parsed.data.kind !== loginFillResponseKindByRequest[request.kind]) {
    return { success: false as const };
  }
  return { success: true as const, data: parsed.data };
}

const contentOnly = {
  allowedContexts: ["content"],
  requireTab: true,
  requireFrame: true,
  requireDocument: true,
} as const;

const extensionPage = { allowedContexts: ["popup", "vault"], requireDocument: true } as const;

export const loginFillSenderPolicy = {
  "login.fillSuggestions": contentOnly,
  "login.fillSelect": contentOnly,
  "login.reveal": extensionPage,
  "login.fillConfirm": contentOnly,
  "login.fillCancel": contentOnly,
  "login.saveOffer": contentOnly,
} satisfies Record<LoginFillCommandKind, CommandSenderPolicy>;
