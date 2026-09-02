import { isCanonicalBase64 } from "@shardpass/security";
import { z } from "zod/mini";

import type { CommandSenderPolicy } from "./context";
import { MESSAGE_VERSION } from "./envelope";

const opaqueId = z.string().check(z.regex(/^[0-9a-f]{32}$/u));
const canonicalDerivedKey = z.string().check(z.refine((value) => isCanonicalBase64(value, 32, 32)));
const canonicalLegacySalt = z.string().check(z.refine((value) => isCanonicalBase64(value, 16, 16)));
const expiry = z.number().check(z.int(), z.nonnegative());
const phase = z.enum(["none", "staged", "verified", "completed", "failed"]);
const lifecycleRequest = (kind: "migration.inspect" | "migration.verify" | "migration.activate") =>
  z.strictObject({ version: z.literal(MESSAGE_VERSION), kind: z.literal(kind) });

export const MigrationInspectRequestSchema = lifecycleRequest("migration.inspect");
export const MigrationGetCredentialChallengeRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("migration.getCredentialChallenge"),
});
export const MigrationAuthorizeCredentialRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("migration.authorizeCredential"),
  challengeId: opaqueId,
  derivedKey: canonicalDerivedKey,
});
export const MigrationStartRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("migration.start"),
  credentialToken: opaqueId,
});
export const MigrationVerifyRequestSchema = lifecycleRequest("migration.verify");
export const MigrationActivateRequestSchema = lifecycleRequest("migration.activate");
export const MigrationRetryRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("migration.retry"),
  credentialToken: z.optional(opaqueId),
});
export const MigrationRequestSchema = z.discriminatedUnion("kind", [
  MigrationInspectRequestSchema,
  MigrationGetCredentialChallengeRequestSchema,
  MigrationAuthorizeCredentialRequestSchema,
  MigrationStartRequestSchema,
  MigrationVerifyRequestSchema,
  MigrationActivateRequestSchema,
  MigrationRetryRequestSchema,
]);

export const MigrationCredentialChallengeResponseSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("migration.credentialChallenge"),
  challengeId: opaqueId,
  kdf: z.strictObject({
    algorithm: z.literal("PBKDF2-HMAC-SHA-256"),
    salt: canonicalLegacySalt,
    iterations: z.literal(600_000),
    outputBytes: z.literal(32),
  }),
  expiresAt: expiry,
});
export const MigrationCredentialAuthorizedResponseSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("migration.credentialAuthorized"),
  credentialToken: opaqueId,
  expiresAt: expiry,
});
export const MigrationStatusResponseSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("migration.status"),
  available: z.boolean(),
  phase,
  itemCount: z.int().check(z.nonnegative()),
  guidance: z.optional(z.literal("retry-or-export")),
});
export const MigrationResponseSchema = z.discriminatedUnion("kind", [
  MigrationCredentialChallengeResponseSchema,
  MigrationCredentialAuthorizedResponseSchema,
  MigrationStatusResponseSchema,
]);

export type MigrationRequest = z.infer<typeof MigrationRequestSchema>;
export type MigrationResponse = z.infer<typeof MigrationResponseSchema>;
export type MigrationCommandKind = MigrationRequest["kind"];

const privileged = { allowedContexts: ["vault"], requireDocument: true } as const;
export const migrationSenderPolicy = {
  "migration.inspect": privileged,
  "migration.getCredentialChallenge": privileged,
  "migration.authorizeCredential": privileged,
  "migration.start": privileged,
  "migration.verify": privileged,
  "migration.activate": privileged,
  "migration.retry": privileged,
} satisfies Record<MigrationCommandKind, CommandSenderPolicy>;
