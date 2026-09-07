import { z } from "zod/mini";

import type { CommandSenderPolicy } from "./context";

const version = { version: z.literal(1) };
const capability = z.string().check(z.minLength(32), z.maxLength(256));
const byte = z.int().check(z.nonnegative(), z.maximum(255));
const wireBytes = (minimum: number, maximum: number) =>
  z.array(byte).check(z.minLength(minimum), z.maxLength(maximum));
const status = z.strictObject({ ...version, kind: z.literal("ente.status") });
const authChallenge = z.strictObject({ ...version, kind: z.literal("ente.authChallenge") });
const connect = z.strictObject({
  ...version,
  kind: z.literal("ente.connect"),
  capability,
  ciphertext: wireBytes(49, 4_256),
});
const submitTotp = z.strictObject({
  ...version,
  kind: z.literal("ente.submitTotp2fa"),
  capability,
});
const manual = z.strictObject({ ...version, kind: z.literal("ente.manualSync") });
const cancel = z.strictObject({ ...version, kind: z.literal("ente.cancel") });
const resolve = z.strictObject({
  ...version,
  kind: z.literal("ente.resolveConflict"),
  capability,
  choice: z.enum(["keep-local", "keep-ente", "keep-both"]),
});
const reauth = z.strictObject({
  ...version,
  kind: z.literal("ente.reauthenticate"),
  passwordJob: capability,
});
const disconnectPreview = z.strictObject({ ...version, kind: z.literal("ente.disconnectPreview") });
const disconnectConfirm = z.strictObject({
  ...version,
  kind: z.literal("ente.disconnectConfirm"),
});
export const EnteRequestSchema = z.discriminatedUnion("kind", [
  status,
  authChallenge,
  connect,
  submitTotp,
  manual,
  cancel,
  resolve,
  reauth,
  disconnectPreview,
  disconnectConfirm,
]);
export type EnteRequest = z.infer<typeof EnteRequestSchema>;
export type EnteCommandKind = EnteRequest["kind"];
export const enteSenderPolicy = Object.freeze({
  "ente.status": { allowedContexts: ["vault", "popup"], requireDocument: true },
  "ente.authChallenge": { allowedContexts: ["vault"], requireDocument: true },
  "ente.connect": { allowedContexts: ["vault"], requireDocument: true },
  "ente.submitTotp2fa": { allowedContexts: ["vault"], requireDocument: true },
  "ente.manualSync": { allowedContexts: ["vault"], requireDocument: true },
  "ente.cancel": { allowedContexts: ["vault"], requireDocument: true },
  "ente.resolveConflict": { allowedContexts: ["vault"], requireDocument: true },
  "ente.reauthenticate": { allowedContexts: ["vault"], requireDocument: true },
  "ente.disconnectPreview": { allowedContexts: ["vault"], requireDocument: true },
  "ente.disconnectConfirm": { allowedContexts: ["vault"], requireDocument: true },
} satisfies Readonly<Record<EnteCommandKind, CommandSenderPolicy>>);
const safeCount = z.int().check(z.nonnegative(), z.maximum(10_000));
const safeTime = z.nullable(z.int().check(z.nonnegative(), z.maximum(Number.MAX_SAFE_INTEGER)));
const conflictPreview = z.strictObject({ capability, canKeepBoth: z.boolean() });
export const EnteSafeStateSchema = z.strictObject({
  ...version,
  kind: z.literal("ente.state"),
  state: z.enum([
    "disconnected",
    "legacy-review",
    "connecting",
    "srp-checking",
    "totp-required",
    "initial-sync",
    "syncing-reading",
    "syncing-committing",
    "syncing-writing",
    "syncing",
    "idle",
    "offline",
    "reauth-required",
    "conflict",
    "uncertain",
    "uncertain-create",
    "blocked",
    "limit-reached",
  ]),
  connected: z.boolean(),
  pendingCount: safeCount,
  conflictCount: safeCount,
  uncertainCount: z.optional(z.int().check(z.nonnegative(), z.maximum(1))),
  lastSuccessAt: safeTime,
  nextEligibleAt: z.optional(safeTime),
  maskedEmail: z.optional(z.string().check(z.minLength(3), z.maxLength(320))),
  capability: z.optional(capability),
  writeCategory: z.optional(z.enum(["create", "update", "delete"])),
  conflicts: z.optional(z.array(conflictPreview).check(z.maxLength(10_000))),
  authHandoffPublicKey: z.optional(wireBytes(32, 32)),
  /** The last background cycle that failed, for the panel; cleared by the next success. */
  lastFailure: z.optional(
    z.strictObject({
      code: z.string().check(z.maxLength(64)),
      detail: z.optional(z.string().check(z.maxLength(200))),
      at: z.number().check(z.nonnegative()),
    }),
  ),
});
export type EnteSafeState = z.infer<typeof EnteSafeStateSchema>;
