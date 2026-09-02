import { z } from "zod/mini";

import { ENTE_API_ORIGIN, ENTE_PROTOCOL_PIN, ENTE_SYNC_LIMITS } from "./protocol";

const uuid = z.uuid().check(z.refine((value) => value === value.toLowerCase()));
const digest = z.string().check(z.regex(/^[A-Za-z0-9+/]{43}=$/u));
const envelope = z.string().check(z.minLength(1), z.maxLength(ENTE_SYNC_LIMITS.maxBase64TextBytes));
const safeTime = z.int().check(z.nonnegative(), z.maximum(ENTE_SYNC_LIMITS.maxSafeTimestamp));
const base = z.strictObject({ localId: uuid, remoteId: uuid, digest, encryptedBase: envelope });
const mapping = z.strictObject({ localId: uuid, remoteId: uuid });
const attempts = z.int().check(z.nonnegative(), z.maximum(ENTE_SYNC_LIMITS.maxMutationAttempts));
const createOperation = z.strictObject({
  operationId: uuid,
  kind: z.literal("create"),
  localId: uuid,
  desired: envelope,
  attempts,
  /** Remote identities observed immediately before dispatch; encrypted with this state. */
  beforeRemoteIds: z.optional(
    z.array(uuid).check(z.maxLength(ENTE_SYNC_LIMITS.maxLiveRemoteEntities)),
  ),
  /** Strict server-returned identity awaiting full-snapshot observation. */
  observedRemoteId: z.optional(uuid),
});
const updateOperation = z.strictObject({
  operationId: uuid,
  kind: z.literal("update"),
  localId: uuid,
  remoteId: uuid,
  baseDigest: digest,
  desired: envelope,
  attempts,
});
const deleteOperation = z.strictObject({
  operationId: uuid,
  kind: z.literal("delete"),
  localId: uuid,
  remoteId: z.optional(uuid),
  baseDigest: z.optional(digest),
  attempts,
});
export const EntePendingOperationSchema = z.discriminatedUnion("kind", [
  createOperation,
  updateOperation,
  deleteOperation,
]);
export type EntePendingOperation = z.infer<typeof EntePendingOperationSchema>;
const conflict = z.strictObject({
  conflictId: uuid,
  localId: uuid,
  remoteId: z.nullable(uuid),
  encryptedBase: z.nullable(envelope),
  encryptedLocal: z.nullable(envelope),
  encryptedRemote: z.nullable(envelope),
  createdAt: safeTime,
});
export const EnteOtpSyncStateSchema = z.strictObject({
  version: z.literal(1),
  protocolPin: z.literal(ENTE_PROTOCOL_PIN),
  origin: z.literal(ENTE_API_ORIGIN),
  accountFingerprint: digest,
  snapshotAccountFingerprint: z.nullable(digest),
  initialSnapshotEstablished: z.boolean(),
  credentialEnvelope: envelope,
  masterKeyEnvelope: z.optional(envelope),
  authKeyEnvelope: envelope,
  mappings: z.array(mapping).check(z.maxLength(ENTE_SYNC_LIMITS.maxLocalMappedItems)),
  bases: z.array(base).check(z.maxLength(ENTE_SYNC_LIMITS.maxLocalMappedItems)),
  cursor: safeTime,
  pending: z
    .array(EntePendingOperationSchema)
    .check(z.maxLength(ENTE_SYNC_LIMITS.maxPendingOperations)),
  uncertain: z.nullable(EntePendingOperationSchema),
  conflicts: z.array(conflict).check(z.maxLength(ENTE_SYNC_LIMITS.maxConflicts)),
  scheduler: z.strictObject({
    connected: z.boolean(),
    lastAttemptAt: z.nullable(safeTime),
    lastSuccessAt: z.nullable(safeTime),
  }),
  needsReauth: z.boolean(),
});
export type EnteOtpSyncState = z.infer<typeof EnteOtpSyncStateSchema>;

export function parseEnteOtpSyncState(input: unknown): EnteOtpSyncState {
  const state = EnteOtpSyncStateSchema.parse(input);
  if (
    (!state.initialSnapshotEstablished && state.snapshotAccountFingerprint !== null) ||
    (state.initialSnapshotEstablished &&
      state.snapshotAccountFingerprint !== state.accountFingerprint)
  )
    throw new TypeError("Invalid Ente snapshot binding");
  const local = new Set<string>();
  const remote = new Set<string>();
  for (const entry of state.mappings) {
    if (local.has(entry.localId) || remote.has(entry.remoteId))
      throw new TypeError("Invalid Ente sync mapping");
    local.add(entry.localId);
    remote.add(entry.remoteId);
  }
  for (const entry of state.bases)
    if (!local.has(entry.localId) || !remote.has(entry.remoteId))
      throw new TypeError("Invalid Ente sync base");
  if (new Set(state.pending.map((entry) => entry.operationId)).size !== state.pending.length)
    throw new TypeError("Invalid Ente queue");
  return state;
}

export function normalizePendingOperations(
  input: readonly EntePendingOperation[],
): EntePendingOperation[] {
  const output: EntePendingOperation[] = [];
  for (const candidate of input.map((item) => EntePendingOperationSchema.parse(item))) {
    const index = output.findIndex((item) => item.localId === candidate.localId);
    if (index < 0) {
      output.push(candidate);
      continue;
    }
    const previous = output[index]!;
    if (previous.kind === "create" && candidate.kind === "delete" && previous.attempts === 0) {
      output.splice(index, 1);
      continue;
    }
    if (previous.kind === "create" && candidate.kind === "update") {
      output[index] = { ...previous, desired: candidate.desired };
      continue;
    }
    if (previous.kind === "update" && candidate.kind === "update") {
      output[index] = { ...previous, desired: candidate.desired };
      continue;
    }
    if (previous.kind === "update" && candidate.kind === "delete") {
      output[index] = {
        ...candidate,
        remoteId: previous.remoteId,
        baseDigest: previous.baseDigest,
      };
      continue;
    }
    output.push(candidate);
  }
  if (output.length > ENTE_SYNC_LIMITS.maxPendingOperations)
    throw new TypeError("Ente queue limit");
  return output;
}
