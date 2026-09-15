import { z } from "zod/mini";

import type { CommandSenderPolicy } from "./context";
import { MESSAGE_VERSION } from "./envelope";

const challengeId = z.string().check(z.regex(/^[0-9a-f]{32}$/));
const canonicalKek = z.string().check(z.regex(/^[A-Za-z0-9+/]{43}=$/));
const lockMinutes = z.int().check(z.nonnegative(), z.maximum(1_440));
const purpose = z.enum(["setup", "unlock", "change-current", "change-new", "reprompt"]);
const request = <T extends z.ZodMiniObject>(shape: T) => shape;

export const VaultGetStateRequestSchema = request(
  z.strictObject({ version: z.literal(MESSAGE_VERSION), kind: z.literal("vault.getState") }),
);
export const VaultGetKdfChallengeRequestSchema = request(
  z.strictObject({
    version: z.literal(MESSAGE_VERSION),
    kind: z.literal("vault.getKdfChallenge"),
    purpose,
  }),
);
export const VaultSetupRequestSchema = request(
  z.strictObject({
    version: z.literal(MESSAGE_VERSION),
    kind: z.literal("vault.setup"),
    challengeId,
    keyEncryptionKey: canonicalKek,
  }),
);
export const VaultUnlockRequestSchema = request(
  z.strictObject({
    version: z.literal(MESSAGE_VERSION),
    kind: z.literal("vault.unlock"),
    challengeId,
    keyEncryptionKey: canonicalKek,
  }),
);
export const VaultLockRequestSchema = request(
  z.strictObject({ version: z.literal(MESSAGE_VERSION), kind: z.literal("vault.lock") }),
);
export const VaultChangePasswordRequestSchema = request(
  z.strictObject({
    version: z.literal(MESSAGE_VERSION),
    kind: z.literal("vault.changePassword"),
    currentChallengeId: challengeId,
    currentKeyEncryptionKey: canonicalKek,
    newChallengeId: challengeId,
    newKeyEncryptionKey: canonicalKek,
  }),
);
export const VaultUpdateLockSettingsRequestSchema = request(
  z.strictObject({
    version: z.literal(MESSAGE_VERSION),
    kind: z.literal("vault.updateLockSettings"),
    autoLockMinutes: lockMinutes,
    lockOnScreenLock: z.boolean(),
    /** Lock as soon as the last ShardPass page closes ("immediately"). */
    lockWhenClosed: z.optional(z.boolean()),
  }),
);

/** Proves the master password again for one item; the grant lasts a few minutes. */
export const VaultConfirmRepromptRequestSchema = request(
  z.strictObject({
    version: z.literal(MESSAGE_VERSION),
    kind: z.literal("vault.confirmReprompt"),
    challengeId,
    keyEncryptionKey: canonicalKek,
    itemId: z.uuid(),
  }),
);

export const VaultRequestSchema = z.discriminatedUnion("kind", [
  VaultGetStateRequestSchema,
  VaultGetKdfChallengeRequestSchema,
  VaultSetupRequestSchema,
  VaultUnlockRequestSchema,
  VaultLockRequestSchema,
  VaultChangePasswordRequestSchema,
  VaultUpdateLockSettingsRequestSchema,
  VaultConfirmRepromptRequestSchema,
]);

const state = z.enum(["unconfigured", "locked", "unlocked"]);
export const VaultStateResponseSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("vault.state"),
  state,
  autoLockMinutes: lockMinutes,
  lockOnScreenLock: z.boolean(),
  lockWhenClosed: z.optional(z.boolean()),
  retryAfterMs: z.int().check(z.nonnegative()),
  streamId: z.string().check(z.regex(/^[0-9a-f]{32}$/)),
  sequence: z.int().check(z.positive()),
});
export const VaultStateUnavailableSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("vault.stateUnavailable"),
  streamId: z.string().check(z.regex(/^[0-9a-f]{32}$/)),
  sequence: z.int().check(z.positive()),
});
export const VaultKdfChallengeResponseSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("vault.kdfChallenge"),
  challengeId,
  purpose,
  kdf: z.strictObject({
    algorithm: z.literal("argon2id"),
    salt: z.string().check(z.regex(/^[A-Za-z0-9+/]{22}==$/)),
    memoryKiB: z.int().check(z.minimum(8192), z.maximum(131072)),
    iterations: z.int().check(z.minimum(1), z.maximum(10)),
    parallelism: z.int().check(z.minimum(1), z.maximum(4)),
  }),
  expiresAt: z.number().check(z.nonnegative()),
});
export const VaultOkResponseSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("vault.ok"),
  state,
  committed: z.optional(z.boolean()),
});
export const VaultResponseSchema = z.discriminatedUnion("kind", [
  VaultStateResponseSchema,
  VaultKdfChallengeResponseSchema,
  VaultOkResponseSchema,
]);

export type VaultRequest = z.infer<typeof VaultRequestSchema>;
export type VaultResponse = z.infer<typeof VaultResponseSchema>;
export type VaultStateResponse = z.infer<typeof VaultStateResponseSchema>;
export type VaultState = z.infer<typeof state>;
export type VaultLockSettings = Readonly<{
  autoLockMinutes: z.infer<typeof lockMinutes>;
  lockOnScreenLock: boolean;
  lockWhenClosed?: boolean | undefined;
}>;
export type VaultCommandKind = VaultRequest["kind"];

const privileged = { allowedContexts: ["popup", "vault"] } as const;
const documentBound = { ...privileged, requireDocument: true } as const;
const vaultDocumentOnly = { allowedContexts: ["vault"], requireDocument: true } as const;
export const vaultSenderPolicy = {
  "vault.getState": privileged,
  "vault.getKdfChallenge": documentBound,
  "vault.setup": documentBound,
  "vault.unlock": documentBound,
  "vault.lock": privileged,
  "vault.changePassword": vaultDocumentOnly,
  "vault.updateLockSettings": privileged,
  "vault.confirmReprompt": documentBound,
} satisfies Record<VaultCommandKind, CommandSenderPolicy>;
