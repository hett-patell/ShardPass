import { SIGN_IN_PROVIDERS } from "@shardpass/domain";
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
  /** When this login was last filled or copied, so the most recently used one leads. */
  lastUsedAt: z.optional(z.string()),
  /** Signs in through a provider: the page-side flow presses that button instead of filling. */
  signInWith: z.optional(z.enum(SIGN_IN_PROVIDERS)),
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

/** Names one release; the page hands it back with login.fillConfirm, and nothing else. */
export const LoginFillReleaseIdSchema = z.string().check(z.regex(/^[a-f0-9]{32}$/u));

export const LoginFillReleaseResponseSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("login.fillRelease"),
  releaseId: LoginFillReleaseIdSchema,
  username: z.string(),
  password: z.string(),
  signInWith: z.optional(z.enum(SIGN_IN_PROVIDERS)),
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
  // Without this a page could stamp any login it learned of, as often as it liked.
  releaseId: LoginFillReleaseIdSchema,
});

export const LoginFillCancelRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("login.fillCancel"),
  itemId: z.uuid(),
});

export const SaveLoginOfferRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("login.saveOffer"),
  domain: z.string().check(z.minLength(1), z.maxLength(2048)),
  username: z.string().check(z.maxLength(1024)),
  password: z.string().check(z.minLength(1), z.maxLength(4096)),
});

/**
 * What the vault already holds for the offered credential. The background keeps the offer
 * (with its password) in memory for a few minutes; the page only ever names it by id.
 */
export const SaveLoginOfferIdSchema = z.string().check(z.regex(/^[a-f0-9]{32}$/u));

/**
 * "locked": the vault could not be consulted; the offer is held all the same and is judged
 * once the vault is open again.
 */
export const SaveLoginExistingSchema = z.enum(["none", "same", "different-password", "locked"]);

export type SaveLoginExisting = z.infer<typeof SaveLoginExistingSchema>;

export const SaveLoginOfferResultSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("login.saveOfferResult"),
  offerId: SaveLoginOfferIdSchema,
  existing: SaveLoginExistingSchema,
  existingName: z.optional(z.string()),
});

/** Drops a held offer the person declined, so it does not come back on the next page. */
export const SaveLoginDismissRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("login.saveDismiss"),
  offerId: SaveLoginOfferIdSchema,
});

/**
 * Asks for the offer held for the sender's tab, if any: a login that navigated away took its
 * prompt with it, and the landing page picks it up here. Only the top frame is answered.
 */
export const LoginPendingOfferRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("login.pendingOffer"),
});

/** What a page may learn about a held offer. Never the password. */
export const PendingSaveOfferSchema = z.strictObject({
  offerId: SaveLoginOfferIdSchema,
  domain: z.string(),
  username: z.string(),
  existing: SaveLoginExistingSchema,
  existingName: z.optional(z.string()),
});

export type PendingSaveOffer = z.infer<typeof PendingSaveOfferSchema>;

export const LoginPendingOfferResultSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("login.pendingOfferResult"),
  offer: z.nullable(PendingSaveOfferSchema),
});

export const SaveLoginConfirmRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("login.saveConfirm"),
  offerId: SaveLoginOfferIdSchema,
  choice: z.enum(["new", "update"]),
});

export const SaveLoginResultSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("login.saveResult"),
  itemId: z.uuid(),
  saved: z.enum(["created", "updated"]),
});

export const LoginFillRequestSchema = z.discriminatedUnion("kind", [
  LoginFillSuggestionsRequestSchema,
  LoginFillSelectRequestSchema,
  LoginRevealRequestSchema,
  LoginFillConfirmRequestSchema,
  LoginFillCancelRequestSchema,
  SaveLoginOfferRequestSchema,
  SaveLoginConfirmRequestSchema,
  SaveLoginDismissRequestSchema,
  LoginPendingOfferRequestSchema,
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
  SaveLoginOfferResultSchema,
  SaveLoginResultSchema,
  LoginPendingOfferResultSchema,
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
  "login.saveOffer": "login.saveOfferResult",
  "login.saveConfirm": "login.saveResult",
  "login.saveDismiss": "login.fillAck",
  "login.pendingOffer": "login.pendingOfferResult",
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
  "login.saveConfirm": contentOnly,
  "login.saveDismiss": contentOnly,
  "login.pendingOffer": contentOnly,
} satisfies Record<LoginFillCommandKind, CommandSenderPolicy>;
