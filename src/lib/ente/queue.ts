import type { EnteIntegration, EntePendingChange } from "@/types";

/**
 * Single source of truth for the Ente push queue.
 *
 * Lives in its own module — deliberately with NO libsodium imports — so the
 * MV3 service worker can statically import enqueue logic without pulling
 * crypto/buffer/asn1 into the SW's main chunk. The heavy sync engine (which
 * does need libsodium) is dynamic-imported by callers.
 */

/**
 * Enqueue a pending push for an account.
 *
 * Behavior:
 * - Coalesces repeated edits on the same accountId into one queue entry.
 * - If deleting an account that's only ever been a local-pending create
 *   (never reached the server), drops both queue entries instead of pushing
 *   a delete the server doesn't know about.
 * - For deletes, looks up the corresponding Ente entity ID from
 *   `ente.entityMap` when not supplied.
 */
export function enqueuePending(
  ente: EnteIntegration,
  op: EntePendingChange["op"],
  accountId: string,
  enteId?: string,
): void {
  if (!ente.pending) ente.pending = [];
  const filtered = ente.pending.filter((c) => c.accountId !== accountId);

  if (op === "delete" && !enteId) {
    for (const [id, accId] of Object.entries(ente.entityMap)) {
      if (accId === accountId) {
        enteId = id;
        break;
      }
    }
  }

  const hadPendingCreate = ente.pending.some(
    (c) => c.accountId === accountId && c.op === "create",
  );
  if (op === "delete" && hadPendingCreate && !enteId) {
    ente.pending = filtered;
    return;
  }

  filtered.push({
    op,
    accountId,
    enteId,
    enqueuedAt: Date.now(),
    attempts: 0,
  });
  ente.pending = filtered;
}

export function findEnteIdForAccount(
  ente: EnteIntegration,
  accountId: string,
): string | undefined {
  for (const [enteId, accId] of Object.entries(ente.entityMap)) {
    if (accId === accountId) return enteId;
  }
  return undefined;
}
