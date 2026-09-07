import { z } from "zod/mini";

import type { CommandSenderPolicy } from "./context";
import { MESSAGE_VERSION } from "./envelope";

const base64url = (max: number) => z.string().check(z.maxLength(max), z.regex(/^[A-Za-z0-9_-]*$/u));
const rpId = z.string().check(z.minLength(1), z.maxLength(253));
const name = z.string().check(z.maxLength(256));

/** Which login a registration would attach to, so the prompt can say so. */
export const PasskeyPreviewRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("passkey.preview"),
  rpId,
  userName: name,
});
export const PasskeyPreviewResultSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("passkey.previewResult"),
  login: z.nullable(z.strictObject({ itemId: z.uuid(), name, username: name })),
});

export const PasskeyRegisterRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("passkey.register"),
  origin: z.string().check(z.maxLength(2048)),
  rpId,
  rpName: name,
  userHandle: base64url(128),
  userName: name,
  userDisplayName: name,
  /** COSE algorithm identifiers the relying party accepts; -7 (ES256) is required. */
  algorithms: z.array(z.int()).check(z.maxLength(32)),
  excludeCredentialIds: z.array(base64url(1024)).check(z.maxLength(64)),
  /** The clientDataJSON the content script built from the real origin, base64url. */
  clientDataJson: base64url(8192),
  attachTo: z.optional(z.uuid()),
});
export const PasskeyRegisterResultSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("passkey.registerResult"),
  itemId: z.uuid(),
  credentialId: base64url(128),
  attestationObject: base64url(8192),
  authenticatorData: base64url(4096),
  publicKey: base64url(1024),
  publicKeyAlgorithm: z.literal(-7),
});

export const PasskeyCandidatesRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("passkey.candidates"),
  origin: z.string().check(z.maxLength(2048)),
  rpId,
  allowCredentialIds: z.array(base64url(1024)).check(z.maxLength(64)),
});
export const PasskeyCandidateSchema = z.strictObject({
  itemId: z.uuid(),
  credentialId: base64url(128),
  userName: name,
  loginName: name,
});
export const PasskeyCandidatesResultSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("passkey.candidatesResult"),
  candidates: z.array(PasskeyCandidateSchema).check(z.maxLength(64)),
});

export const PasskeyAssertRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("passkey.assert"),
  origin: z.string().check(z.maxLength(2048)),
  rpId,
  itemId: z.uuid(),
  credentialId: base64url(128),
  clientDataJson: base64url(8192),
});
export const PasskeyAssertResultSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("passkey.assertResult"),
  credentialId: base64url(128),
  authenticatorData: base64url(4096),
  signature: base64url(1024),
  userHandle: base64url(128),
});

export const PasskeyRequestSchema = z.discriminatedUnion("kind", [
  PasskeyPreviewRequestSchema,
  PasskeyRegisterRequestSchema,
  PasskeyCandidatesRequestSchema,
  PasskeyAssertRequestSchema,
]);
export const PasskeyResponseSchema = z.discriminatedUnion("kind", [
  PasskeyPreviewResultSchema,
  PasskeyRegisterResultSchema,
  PasskeyCandidatesResultSchema,
  PasskeyAssertResultSchema,
]);

export type PasskeyRequest = z.infer<typeof PasskeyRequestSchema>;
export type PasskeyResponse = z.infer<typeof PasskeyResponseSchema>;
export type PasskeyCommandKind = PasskeyRequest["kind"];
export type PasskeyCandidate = z.infer<typeof PasskeyCandidateSchema>;

export const passkeyResponseKindByRequest = {
  "passkey.preview": "passkey.previewResult",
  "passkey.register": "passkey.registerResult",
  "passkey.candidates": "passkey.candidatesResult",
  "passkey.assert": "passkey.assertResult",
} as const satisfies Record<PasskeyCommandKind, PasskeyResponse["kind"]>;

export function parsePasskeyResponseForRequest(request: PasskeyRequest, candidate: unknown) {
  const parsed = PasskeyResponseSchema.safeParse(candidate);
  if (!parsed.success || parsed.data.kind !== passkeyResponseKindByRequest[request.kind])
    return { success: false as const };
  return { success: true as const, data: parsed.data };
}

// Every passkey command originates in a page's content script, bound to its tab and frame.
const contentOnly = {
  allowedContexts: ["content"],
  requireTab: true,
  requireFrame: true,
  requireDocument: true,
} as const;
export const passkeySenderPolicy = {
  "passkey.preview": contentOnly,
  "passkey.register": contentOnly,
  "passkey.candidates": contentOnly,
  "passkey.assert": contentOnly,
} satisfies Record<PasskeyCommandKind, CommandSenderPolicy>;
