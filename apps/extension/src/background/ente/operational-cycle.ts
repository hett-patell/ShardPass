import { createEnteResponseBudget, type EnteClient, type EnteResponseBudget } from "./client";
import { mergeEnteOtp } from "./merge";
import { ENTE_SYNC_LIMITS, EnteProtocolError, type EnteOtpProjection } from "./protocol";
import { readRemoteState, type RemoteOtpState } from "./read-engine";
import {
  normalizePendingOperations,
  type EnteOtpSyncState,
  type EntePendingOperation,
} from "./sync-state";
import { diagnostics } from "../../platform/diagnostics";

export type EnteSyncTrigger = "connected" | "restart" | "unlock" | "manual" | "alarm";
export type EnteCycleItem = Readonly<{ localId: string; projection: EnteOtpProjection }>;
export type EnteCycleSnapshot = Readonly<{
  /** Opaque session revision. It is neither a vault root nor a key. */
  sessionEpoch: number;
  state: EnteOtpSyncState;
  items: readonly EnteCycleItem[];
}>;
export type EnteCycleMutation = Readonly<{
  state: EnteOtpSyncState;
  items: readonly EnteCycleItem[];
}>;
export interface EnteCycleRepository {
  read(): Promise<EnteCycleSnapshot>;
  commit(
    expectedSessionEpoch: number,
    mutation: EnteCycleMutation,
  ): Promise<"activated" | "root-changed">;
}
export interface EnteCycleCrypto {
  openCredential(envelope: string): Promise<string>;
  openAuthKey(envelope: string, response: unknown): Promise<Uint8Array>;
  openProjection(envelope: string): Promise<EnteOtpProjection>;
  sealProjection(projection: EnteOtpProjection): Promise<string>;
  digestProjection(projection: EnteOtpProjection): Promise<string>;
  /** `null` for an entity that decrypts fine but is not a code to import (Ente "trashed"). */
  decryptEntity(entity: RemoteOtpState, authKey: Uint8Array): EnteOtpProjection | null;
  encryptEntity(
    projection: EnteOtpProjection,
    authKey: Uint8Array,
  ): Readonly<{ encryptedData: string; header: string }>;
}

export type OperationalClient = Pick<
  EnteClient,
  "getAuthenticatorKey" | "getEntityDiff" | "createEntity" | "updateEntity" | "deleteEntity"
>;
export type OperationalDependencies = Readonly<{
  repository: EnteCycleRepository;
  client: OperationalClient;
  crypto: EnteCycleCrypto;
  now: () => number;
  nextId: () => string;
}>;
type Pulled = Awaited<ReturnType<typeof pull>>;

function assertLive(
  entity: RemoteOtpState,
): asserts entity is Extract<RemoteOtpState, { isDeleted: false }> {
  if (entity.isDeleted)
    throw new EnteProtocolError("ENTE_INVALID", "a deleted entity where a live one was expected");
}
function liveProjection(pulled: Pulled, remoteId: string): EnteOtpProjection | null {
  return pulled.projections.get(remoteId) ?? null;
}
async function equalProjection(
  dependencies: OperationalDependencies,
  left: EnteOtpProjection | null,
  right: EnteOtpProjection | null,
): Promise<boolean> {
  if (left === null || right === null) return left === right;
  return (
    (await dependencies.crypto.digestProjection(left)) ===
    (await dependencies.crypto.digestProjection(right))
  );
}

async function pull(
  dependencies: OperationalDependencies,
  snapshot: EnteCycleSnapshot,
  token: string,
  authKey: Uint8Array,
  signal: AbortSignal,
  forceSnapshot: boolean,
  budget: EnteResponseBudget,
) {
  const result = await readRemoteState({
    client: dependencies.client,
    token,
    authKey,
    sinceTime: snapshot.state.cursor,
    forceSnapshot,
    signal,
    budget,
  });
  const projections = new Map<string, EnteOtpProjection | null>();
  let unreadable = 0;
  for (const [id, entity] of result.entities) {
    if (entity.isDeleted) projections.set(id, null);
    else {
      assertLive(entity);
      let projection: EnteOtpProjection | null;
      try {
        projection = dependencies.crypto.decryptEntity(entity, authKey);
      } catch (error) {
        // One entity this build cannot read (another client's format, a corrupt record)
        // must not stop every other code from syncing. Leaving it out of the remote map
        // makes the planner treat it as unchanged: never imported, never deleted, and a
        // local edit of a mapped one still pushes. The original client skipped these too.
        if (!(error instanceof EnteProtocolError) || error.code !== "ENTE_INVALID") throw error;
        unreadable += 1;
        diagnostics.warn(`[ShardPass] Ente entity ${id} skipped: ${error.detail ?? "unreadable"}`);
        continue;
      }
      // A code Ente has trashed is still a live entity on the server; it is neither imported
      // nor deleted here, exactly as the original client treated it.
      if (projection !== null) projections.set(id, projection);
    }
  }
  if (unreadable > 0)
    diagnostics.warn(`[ShardPass] Ente sync skipped ${unreadable} unreadable ${unreadable === 1 ? "entity" : "entities"}.`);
  return { ...result, projections };
}

async function planMerge(
  dependencies: OperationalDependencies,
  snapshot: EnteCycleSnapshot,
  remote: ReadonlyMap<string, EnteOtpProjection | null>,
  nextCursor: number,
  pullMode: "incremental" | "snapshot",
  complete: boolean,
): Promise<EnteCycleMutation> {
  const state = snapshot.state;
  const local = new Map(snapshot.items.map((item) => [item.localId, item.projection]));
  const mappings = new Map(state.mappings.map((entry) => [entry.localId, entry.remoteId]));
  const mappedRemote = new Set(state.mappings.map((entry) => entry.remoteId));
  const bases = new Map<string, EnteOtpProjection>();
  for (const base of state.bases)
    bases.set(base.localId, await dependencies.crypto.openProjection(base.encryptedBase));
  const pending = [...state.pending];
  const conflicts = [...state.conflicts];

  for (const [localId, remoteId] of mappings) {
    const base = bases.get(localId) ?? null;
    const localProjection = local.get(localId) ?? null;
    const remoteProjection = remote.has(remoteId) ? (remote.get(remoteId) ?? null) : base;
    const plan = mergeEnteOtp({ base, local: localProjection, remote: remoteProjection });
    if (plan.action === "take-remote") {
      if (remoteProjection === null) local.delete(localId);
      else local.set(localId, remoteProjection);
    } else if (
      plan.action === "push-local" &&
      !pending.some((operation) => operation.localId === localId)
    ) {
      pending.push(
        localProjection === null
          ? {
              operationId: dependencies.nextId(),
              kind: "delete",
              localId,
              remoteId,
              ...(base === null
                ? {}
                : { baseDigest: await dependencies.crypto.digestProjection(base) }),
              attempts: 0,
            }
          : {
              operationId: dependencies.nextId(),
              kind: "update",
              localId,
              remoteId,
              baseDigest: await dependencies.crypto.digestProjection(base!),
              desired: await dependencies.crypto.sealProjection(localProjection),
              attempts: 0,
            },
      );
    } else if (plan.action === "conflict") {
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        if (pending[index]?.localId === localId) pending.splice(index, 1);
      }
      conflicts.push({
        conflictId: dependencies.nextId(),
        localId,
        remoteId,
        encryptedBase: base === null ? null : await dependencies.crypto.sealProjection(base),
        encryptedLocal:
          localProjection === null
            ? null
            : await dependencies.crypto.sealProjection(localProjection),
        encryptedRemote:
          remoteProjection === null
            ? null
            : await dependencies.crypto.sealProjection(remoteProjection),
        createdAt: dependencies.now(),
      });
    }
    if (remoteProjection === null && localProjection === null) mappings.delete(localId);
    else if (
      remoteProjection !== null &&
      plan.action !== "push-local" &&
      plan.action !== "conflict"
    )
      bases.set(localId, remoteProjection);
  }

  for (const [remoteId, projection] of remote) {
    if (projection === null || mappedRemote.has(remoteId)) continue;
    const localId = dependencies.nextId();
    local.set(localId, projection);
    mappings.set(localId, remoteId);
    bases.set(localId, projection);
  }
  const acceptedCompleteSnapshot = pullMode === "snapshot" && complete;
  const mayCreateUnmapped =
    acceptedCompleteSnapshot ||
    (state.initialSnapshotEstablished &&
      state.snapshotAccountFingerprint === state.accountFingerprint);
  for (const [localId, projection] of local) {
    if (
      !mayCreateUnmapped ||
      mappings.has(localId) ||
      pending.some((operation) => operation.localId === localId)
    )
      continue;
    pending.push({
      operationId: dependencies.nextId(),
      kind: "create",
      localId,
      desired: await dependencies.crypto.sealProjection(projection),
      attempts: 0,
    });
  }

  const mappingRows = [...mappings].map(([localId, remoteId]) => ({ localId, remoteId }));
  const baseRows = await Promise.all(
    [...bases]
      .flatMap(([localId, projection]) => {
        const remoteId = mappings.get(localId);
        return remoteId === undefined ? [] : [{ localId, remoteId, projection }];
      })
      .map(async ({ localId, remoteId, projection }) => ({
        localId,
        remoteId,
        digest: await dependencies.crypto.digestProjection(projection),
        encryptedBase: await dependencies.crypto.sealProjection(projection),
      })),
  );
  return {
    items: [...local].map(([localId, projection]) => ({ localId, projection })),
    state: {
      ...state,
      mappings: mappingRows,
      bases: baseRows,
      cursor: nextCursor,
      ...(acceptedCompleteSnapshot
        ? {
            initialSnapshotEstablished: true,
            snapshotAccountFingerprint: state.accountFingerprint,
          }
        : {}),
      pending: normalizePendingOperations(pending),
      conflicts,
      scheduler: {
        ...state.scheduler,
        lastAttemptAt: dependencies.now(),
        // A pull that merged is a successful sync from the person's point of view; writes
        // that follow report their own failures.
        lastSuccessAt: dependencies.now(),
      },
    },
  };
}

async function commitMutation(
  dependencies: OperationalDependencies,
  snapshot: EnteCycleSnapshot,
  mutation: EnteCycleMutation,
): Promise<EnteCycleSnapshot> {
  if ((await dependencies.repository.commit(snapshot.sessionEpoch, mutation)) !== "activated")
    throw new EnteProtocolError("ENTE_STORAGE_CHANGED");
  return { sessionEpoch: snapshot.sessionEpoch + 1, ...mutation };
}
async function commitOrRecompute(
  dependencies: OperationalDependencies,
  token: string,
  authKey: Uint8Array,
  signal: AbortSignal,
  forceSnapshot: boolean,
  budget: EnteResponseBudget,
): Promise<EnteCycleSnapshot> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await dependencies.repository.read();
    const remote = await pull(
      dependencies,
      snapshot,
      token,
      authKey,
      signal,
      forceSnapshot,
      budget,
    );
    const mutation = await planMerge(
      dependencies,
      snapshot,
      remote.projections,
      remote.nextCursor,
      remote.mode,
      remote.complete,
    );
    if ((await dependencies.repository.commit(snapshot.sessionEpoch, mutation)) === "activated")
      return { sessionEpoch: snapshot.sessionEpoch + 1, ...mutation };
  }
  throw new EnteProtocolError("ENTE_STORAGE_CHANGED");
}

async function markOperation(
  dependencies: OperationalDependencies,
  snapshot: EnteCycleSnapshot,
  operation: EntePendingOperation,
): Promise<EnteCycleSnapshot> {
  return commitMutation(dependencies, snapshot, {
    items: snapshot.items,
    state: {
      ...snapshot.state,
      pending: snapshot.state.pending.map((entry, index) => (index === 0 ? operation : entry)),
      uncertain: operation,
    },
  });
}

async function reconcile(
  dependencies: OperationalDependencies,
  snapshot: EnteCycleSnapshot,
  pulled: Pulled,
): Promise<EnteCycleSnapshot | "unresolved"> {
  const operation = snapshot.state.uncertain;
  if (operation === null) return snapshot;
  const desired =
    operation.kind === "delete"
      ? null
      : await dependencies.crypto.openProjection(operation.desired);
  let disposition: "complete" | "retry" | "conflict" | "unresolved" = "unresolved";
  let remoteId = operation.kind === "create" ? operation.observedRemoteId : operation.remoteId;
  let observed: EnteOtpProjection | null =
    remoteId === undefined ? null : liveProjection(pulled, remoteId);

  if (operation.kind === "create") {
    if (remoteId !== undefined) {
      disposition = (await equalProjection(dependencies, desired, observed))
        ? "complete"
        : "conflict";
    } else {
      const before = new Set(operation.beforeRemoteIds ?? []);
      const matches: string[] = [];
      for (const [id, projection] of pulled.projections)
        if (
          !before.has(id) &&
          projection !== null &&
          (await equalProjection(dependencies, desired, projection))
        )
          matches.push(id);
      if (matches.length === 1) {
        remoteId = matches[0];
        observed = pulled.projections.get(remoteId!)!;
        disposition = "complete";
      } else if (matches.length === 0 && operation.beforeRemoteIds !== undefined)
        disposition = "retry";
      else disposition = matches.length > 1 ? "conflict" : "unresolved";
    }
  } else if (operation.kind === "delete") {
    if (observed === null) disposition = "complete";
    else if (
      operation.baseDigest !== undefined &&
      (await dependencies.crypto.digestProjection(observed)) === operation.baseDigest
    )
      disposition = "retry";
    else disposition = "conflict";
  } else if (observed === null) disposition = "conflict";
  else if (await equalProjection(dependencies, desired, observed)) disposition = "complete";
  else if ((await dependencies.crypto.digestProjection(observed)) === operation.baseDigest)
    disposition = "retry";
  else disposition = "conflict";

  if (disposition === "unresolved") return "unresolved";
  const pending = snapshot.state.pending.filter((entry) =>
    disposition === "retry" ? true : entry.operationId !== operation.operationId,
  );
  const mappings = [...snapshot.state.mappings];
  const bases = [...snapshot.state.bases];
  const conflicts = [...snapshot.state.conflicts];
  if (disposition === "complete") {
    if (operation.kind === "create" && remoteId !== undefined && observed !== null) {
      mappings.push({ localId: operation.localId, remoteId });
      bases.push({
        localId: operation.localId,
        remoteId,
        digest: await dependencies.crypto.digestProjection(observed),
        encryptedBase: await dependencies.crypto.sealProjection(observed),
      });
    } else if (operation.kind === "update" && observed !== null) {
      const index = bases.findIndex((entry) => entry.localId === operation.localId);
      const next = {
        localId: operation.localId,
        remoteId: operation.remoteId,
        digest: await dependencies.crypto.digestProjection(observed),
        encryptedBase: await dependencies.crypto.sealProjection(observed),
      };
      if (index < 0) bases.push(next);
      else bases[index] = next;
    } else if (operation.kind === "delete") {
      const mappingIndex = mappings.findIndex((entry) => entry.localId === operation.localId);
      if (mappingIndex >= 0) mappings.splice(mappingIndex, 1);
      const baseIndex = bases.findIndex((entry) => entry.localId === operation.localId);
      if (baseIndex >= 0) bases.splice(baseIndex, 1);
    }
  } else if (disposition === "conflict") {
    const baseRow = snapshot.state.bases.find((entry) => entry.localId === operation.localId);
    const localProjection =
      snapshot.items.find((entry) => entry.localId === operation.localId)?.projection ?? null;
    const baseProjection =
      baseRow === undefined
        ? null
        : await dependencies.crypto.openProjection(baseRow.encryptedBase);
    conflicts.push({
      conflictId: dependencies.nextId(),
      localId: operation.localId,
      remoteId: remoteId ?? null,
      encryptedBase:
        baseProjection === null ? null : await dependencies.crypto.sealProjection(baseProjection),
      encryptedLocal:
        localProjection === null ? null : await dependencies.crypto.sealProjection(localProjection),
      encryptedRemote:
        observed === null ? null : await dependencies.crypto.sealProjection(observed),
      createdAt: dependencies.now(),
    });
  }
  return commitMutation(dependencies, snapshot, {
    items: snapshot.items,
    state: {
      ...snapshot.state,
      cursor: pulled.nextCursor,
      mappings,
      bases,
      pending,
      uncertain: null,
      conflicts,
      scheduler: { ...snapshot.state.scheduler, lastSuccessAt: dependencies.now() },
    },
  });
}

/** How many queued writes one cycle sends before handing back; the alarm continues. */
const MAX_WRITES_PER_CYCLE = 25;

/**
 * Sends queued writes until the queue is empty, a limit is reached, or the cycle is
 * cancelled. One write per cycle meant a vault with fifty local codes needed fifty
 * fifteen-minute alarms to finish its first upload.
 */
async function executeHead(
  dependencies: OperationalDependencies,
  snapshot: EnteCycleSnapshot,
  token: string,
  authKey: Uint8Array,
  signal: AbortSignal,
  budget: EnteResponseBudget,
): Promise<void> {
  let current = snapshot;
  for (let sent = 0; sent < MAX_WRITES_PER_CYCLE && !signal.aborted; sent += 1) {
    const next = await executeOne(dependencies, current, token, authKey, signal, budget);
    if (next === null) return;
    current = next;
  }
}

async function executeOne(
  dependencies: OperationalDependencies,
  snapshot: EnteCycleSnapshot,
  token: string,
  authKey: Uint8Array,
  signal: AbortSignal,
  budget: EnteResponseBudget,
): Promise<EnteCycleSnapshot | null> {
  const head = snapshot.state.pending[0];
  if (head === undefined || snapshot.state.conflicts.length > 0 || snapshot.state.needsReauth)
    return null;
  if (head.attempts >= ENTE_SYNC_LIMITS.maxMutationAttempts) return null;
  const attempted: EntePendingOperation = {
    ...head,
    attempts: head.attempts + 1,
    ...(head.kind === "create"
      ? { beforeRemoteIds: snapshot.state.mappings.map((entry) => entry.remoteId) }
      : {}),
  };
  let persisted = await markOperation(dependencies, snapshot, attempted);
  try {
    if (attempted.kind === "create") {
      const desired = await dependencies.crypto.openProjection(attempted.desired);
      const response = (await dependencies.client.createEntity(
        token,
        dependencies.crypto.encryptEntity(desired, authKey),
        signal,
        budget,
      )) as { id?: unknown };
      if (typeof response.id !== "string") throw new EnteProtocolError("ENTE_PROTOCOL_DRIFT");
      const observed = { ...attempted, observedRemoteId: response.id };
      persisted = await markOperation(dependencies, persisted, observed);
    } else if (attempted.kind === "update") {
      const desired = await dependencies.crypto.openProjection(attempted.desired);
      await dependencies.client.updateEntity(
        token,
        { id: attempted.remoteId, ...dependencies.crypto.encryptEntity(desired, authKey) },
        signal,
        budget,
      );
    } else {
      if (attempted.remoteId === undefined) throw new EnteProtocolError("ENTE_INVALID");
      await dependencies.client.deleteEntity(token, attempted.remoteId, signal, budget);
    }
  } catch (error) {
    if (error instanceof EnteProtocolError && error.code === "ENTE_REAUTH_REQUIRED") {
      await commitMutation(dependencies, persisted, {
        items: persisted.items,
        state: { ...persisted.state, needsReauth: true },
      });
      throw error;
    }
    throw new EnteProtocolError(
      attempted.kind === "create" ? "ENTE_CREATE_UNCERTAIN" : "ENTE_WRITE_UNCERTAIN",
    );
  }
  const full = await pull(dependencies, persisted, token, authKey, signal, true, budget);
  const result = await reconcile(dependencies, persisted, full);
  if (result === "unresolved")
    throw new EnteProtocolError(
      attempted.kind === "create" ? "ENTE_CREATE_UNCERTAIN" : "ENTE_WRITE_UNCERTAIN",
    );
  return result;
}

export function createEnteOperationalCycle(dependencies: OperationalDependencies) {
  return async (_trigger: EnteSyncTrigger, signal: AbortSignal): Promise<void> => {
    const initial = await dependencies.repository.read();
    if (!initial.state.scheduler.connected) return;
    const budget = createEnteResponseBudget();
    const token = await dependencies.crypto.openCredential(initial.state.credentialEnvelope);
    let authKey: Uint8Array | undefined;
    try {
      const keyResponse = await dependencies.client.getAuthenticatorKey(token, signal, budget);
      authKey = await dependencies.crypto.openAuthKey(initial.state.authKeyEnvelope, keyResponse);
      if (initial.state.uncertain !== null) {
        const uncertain = initial.state.uncertain;
        const full = await pull(dependencies, initial, token, authKey, signal, true, budget);
        const reconciled = await reconcile(dependencies, initial, full);
        if (reconciled === "unresolved")
          throw new EnteProtocolError(
            uncertain.kind === "create" ? "ENTE_CREATE_UNCERTAIN" : "ENTE_WRITE_UNCERTAIN",
          );
        // A proved-absent operation is retry-authorized, never retried in the
        // reconciliation cycle that made that decision.
        if (reconciled.state.pending.some((entry) => entry.operationId === uncertain.operationId))
          throw new EnteProtocolError(
            uncertain.kind === "create" ? "ENTE_CREATE_UNCERTAIN" : "ENTE_WRITE_UNCERTAIN",
          );
        return;
      }
      const merged = await commitOrRecompute(
        dependencies,
        token,
        authKey,
        signal,
        !initial.state.initialSnapshotEstablished ||
          initial.state.snapshotAccountFingerprint !== initial.state.accountFingerprint ||
          initial.state.cursor === 0,
        budget,
      );
      await executeHead(dependencies, merged, token, authKey, signal, budget);
    } catch (error) {
      // An expired Ente session found on the read path was never recorded before, so
      // background sync failed forever while the panel said "idle". Record it once, with
      // the attempt time, so the panel asks the person to sign in again.
      if (error instanceof EnteProtocolError && error.code === "ENTE_REAUTH_REQUIRED") {
        const latest = await dependencies.repository.read().catch(() => null);
        if (latest !== null && !latest.state.needsReauth)
          await commitMutation(dependencies, latest, {
            items: latest.items,
            state: {
              ...latest.state,
              needsReauth: true,
              scheduler: { ...latest.state.scheduler, lastAttemptAt: dependencies.now() },
            },
          }).catch(() => undefined);
      }
      throw error;
    } finally {
      authKey?.fill(0);
    }
  };
}
