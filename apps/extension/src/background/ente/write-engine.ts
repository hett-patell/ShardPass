import { ENTE_SYNC_LIMITS, EnteProtocolError } from "./protocol";
import type { EntePendingOperation } from "./sync-state";

type WriteSnapshot = Readonly<{
  unlocked: boolean;
  connected: boolean;
  needsReauth: boolean;
  conflicts: readonly unknown[];
  pending: readonly EntePendingOperation[];
  uncertain: EntePendingOperation | null;
}>;
export type WriteDisposition = Readonly<{
  kind: "idle" | "blocked" | "complete" | "provisional" | "uncertain";
  operation?: EntePendingOperation;
}>;
export async function executeQueueHead(input: {
  readonly snapshot: WriteSnapshot;
  readonly client: {
    createEntity?(token: string, body: unknown, signal: AbortSignal): Promise<unknown>;
    updateEntity?(token: string, body: unknown, signal: AbortSignal): Promise<void>;
    deleteEntity?(token: string, id: string, signal: AbortSignal): Promise<void>;
  };
  readonly token: string;
  readonly authKey: Uint8Array;
  readonly signal: AbortSignal;
  readonly persistAttempt: (operation: EntePendingOperation) => Promise<void>;
}): Promise<WriteDisposition> {
  const snapshot = input.snapshot;
  if (
    !snapshot.unlocked ||
    !snapshot.connected ||
    snapshot.needsReauth ||
    snapshot.conflicts.length > 0 ||
    snapshot.uncertain !== null
  )
    return { kind: "blocked" };
  const head = snapshot.pending[0];
  if (head === undefined) return { kind: "idle" };
  if (head.attempts >= ENTE_SYNC_LIMITS.maxMutationAttempts)
    return { kind: "blocked", operation: head };
  const attempted: EntePendingOperation = { ...head, attempts: head.attempts + 1 };
  await input.persistAttempt(attempted);
  try {
    if (head.kind === "create") {
      if (!input.client.createEntity) throw new Error();
      await input.client.createEntity(
        input.token,
        { encryptedData: head.desired, header: head.desired },
        input.signal,
      );
      return { kind: "complete", operation: attempted };
    }
    if (head.kind === "update") {
      if (!input.client.updateEntity) throw new Error();
      await input.client.updateEntity(
        input.token,
        { id: head.remoteId, encryptedData: head.desired, header: head.desired },
        input.signal,
      );
      return { kind: "provisional", operation: attempted };
    }
    if (!head.remoteId || !input.client.deleteEntity) throw new EnteProtocolError("ENTE_INVALID");
    await input.client.deleteEntity(input.token, head.remoteId, input.signal);
    return { kind: "provisional", operation: attempted };
  } catch (error) {
    if (error instanceof EnteProtocolError && error.code === "ENTE_REAUTH_REQUIRED")
      return { kind: "blocked", operation: attempted };
    return { kind: "uncertain", operation: attempted };
  }
}
export type ReconciliationDisposition =
  "complete" | "retry" | "conflict" | "blocked-create-uncertain";
export function reconcileUncertain(input: {
  readonly operation: EntePendingOperation;
  readonly beforeSnapshot: ReadonlyMap<string, unknown>;
  readonly fullSnapshot: ReadonlyMap<string, unknown>;
}): ReconciliationDisposition {
  const { operation, beforeSnapshot, fullSnapshot } = input;
  if (operation.kind === "create") return "blocked-create-uncertain";
  const remoteId = operation.remoteId;
  if (remoteId === undefined) return "conflict";
  const before = beforeSnapshot.get(remoteId);
  const after = fullSnapshot.get(remoteId);
  if (operation.kind === "delete")
    return after === undefined ? "complete" : before === after ? "retry" : "conflict";
  if (after === undefined) return "conflict";
  return before === after ? "retry" : "conflict";
}
