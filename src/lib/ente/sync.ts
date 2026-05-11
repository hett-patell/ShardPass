import type {
  Account,
  EnteIntegration,
  EntePendingChange,
  Vault,
} from "@/types";
import { log, error as logError, warn as logWarn } from "@/lib/log";
import { normalizeSecret } from "@/lib/totp";
import {
  decryptBlobJSON,
  decryptBoxBytes,
  encryptBlobJSON,
  encryptBox,
  generateAuthenticatorKeyB64,
  toB64,
} from "./crypto";
import {
  EnteApiError,
  createAuthenticatorEntityKey,
  createEntity,
  deleteEntity,
  getAuthenticatorEntityKey,
  getEntityDiff,
  updateEntity,
} from "./api";
import { accountToEnteUri, enteUriToAccountDraft } from "./codec";

const PAGE_SIZE = 2500;

export interface SyncResult {
  pulledNew: number;
  pulledUpdated: number;
  pulledDeleted: number;
  skippedTrashed: number;
  pushedCreate: number;
  pushedUpdate: number;
  pushedDelete: number;
  pushFailures: number;
  needsReauth: boolean;
}

function emptyResult(): SyncResult {
  return {
    pulledNew: 0,
    pulledUpdated: 0,
    pulledDeleted: 0,
    skippedTrashed: 0,
    pushedCreate: 0,
    pushedUpdate: 0,
    pushedDelete: 0,
    pushFailures: 0,
    needsReauth: false,
  };
}

export function isAuthError(e: unknown): boolean {
  return e instanceof EnteApiError && (e.status === 401 || e.status === 403);
}

async function ensureAuthenticatorKey(
  ente: EnteIntegration,
): Promise<string> {
  if (ente.authenticatorKey) return ente.authenticatorKey;
  const remote = await getAuthenticatorEntityKey(ente.serverUrl, ente.authToken);
  if (remote) {
    const keyBytes = await decryptBoxBytes(
      remote.encryptedKey,
      remote.header,
      ente.masterKey,
    );
    const keyB64 = await toB64(keyBytes);
    ente.authenticatorKey = keyB64;
    return keyB64;
  }
  // No authenticator key yet on the server — generate one and upload it.
  log("ente", "no remote authenticator key; generating and uploading new one");
  const keyB64 = await generateAuthenticatorKeyB64();
  const wrapped = await encryptBox(keyB64, ente.masterKey);
  await createAuthenticatorEntityKey(ente.serverUrl, ente.authToken, {
    encryptedKey: wrapped.encryptedData,
    header: wrapped.nonce,
  });
  ente.authenticatorKey = keyB64;
  return keyB64;
}

async function pullEntities(
  ente: EnteIntegration,
  authKey: string,
): Promise<{
  upserts: Map<string, { uri: string; updatedAt: number }>;
  deletes: Set<string>;
  newSinceTime: number;
}> {
  const upserts = new Map<string, { uri: string; updatedAt: number }>();
  const deletes = new Set<string>();
  let sinceTime = ente.lastSync ?? 0;
  let newSinceTime = sinceTime;
  for (;;) {
    const { diff } = await getEntityDiff(
      ente.serverUrl,
      ente.authToken,
      sinceTime,
      PAGE_SIZE,
    );
    if (!diff.length) break;
    for (const change of diff) {
      sinceTime = Math.max(sinceTime, change.updatedAt);
      newSinceTime = Math.max(newSinceTime, change.updatedAt);
      if (change.isDeleted) {
        deletes.add(change.id);
        upserts.delete(change.id);
        continue;
      }
      if (!change.encryptedData || !change.header) continue;
      try {
        const uri = await decryptBlobJSON<string>(
          change.encryptedData,
          change.header,
          authKey,
        );
        if (typeof uri !== "string") {
          logWarn("ente", `entity ${change.id} did not decrypt to a string`);
          continue;
        }
        upserts.set(change.id, { uri, updatedAt: change.updatedAt });
        deletes.delete(change.id);
      } catch (e) {
        logError("ente", `failed to decrypt entity ${change.id}`, e);
      }
    }
    if (diff.length < PAGE_SIZE) break;
  }
  return { upserts, deletes, newSinceTime };
}

function localFingerprint(a: Account | Omit<Account, "id" | "createdAt">): string {
  const type = a.type ?? "totp";
  return [
    type,
    normalizeSecret(a.secret),
    (a.issuer || "").toLowerCase(),
    (a.label || "").toLowerCase(),
  ].join("|");
}

function applyPullToVault(
  vault: Vault,
  ente: EnteIntegration,
  upserts: Map<string, { uri: string; updatedAt: number }>,
  deletes: Set<string>,
  result: SyncResult,
): void {
  const accountIdByEnteId = new Map<string, string>();
  const enteIdByAccountId = new Map<string, string>();
  for (const [enteId, accountId] of Object.entries(ente.entityMap)) {
    accountIdByEnteId.set(enteId, accountId);
    enteIdByAccountId.set(accountId, enteId);
  }
  const fingerprintToAccount = new Map<string, Account>();
  for (const a of vault.accounts) {
    fingerprintToAccount.set(localFingerprint(a), a);
  }

  // Deletions first.
  if (deletes.size > 0) {
    const idsToDelete = new Set<string>();
    for (const enteId of deletes) {
      const accId = accountIdByEnteId.get(enteId);
      if (accId) {
        idsToDelete.add(accId);
        delete ente.entityMap[enteId];
      }
    }
    if (idsToDelete.size > 0) {
      const before = vault.accounts.length;
      vault.accounts = vault.accounts.filter((a) => !idsToDelete.has(a.id));
      result.pulledDeleted += before - vault.accounts.length;
    }
  }

  // Upserts.
  for (const [enteId, { uri }] of upserts) {
    const draft = enteUriToAccountDraft(uri);
    if (!draft) {
      result.skippedTrashed += 1;
      // Trashed remote: if we had it locally, remove it.
      const accId = accountIdByEnteId.get(enteId);
      if (accId) {
        const before = vault.accounts.length;
        vault.accounts = vault.accounts.filter((a) => a.id !== accId);
        if (vault.accounts.length < before) result.pulledDeleted += 1;
        delete ente.entityMap[enteId];
      }
      continue;
    }
    const existingId = accountIdByEnteId.get(enteId);
    if (existingId) {
      const idx = vault.accounts.findIndex((a) => a.id === existingId);
      if (idx === -1) {
        // Mapping pointed at a vanished account — recreate.
        const newAcc: Account = {
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          ...draft,
        };
        vault.accounts.push(newAcc);
        ente.entityMap[enteId] = newAcc.id;
        result.pulledNew += 1;
      } else {
        vault.accounts[idx] = {
          ...vault.accounts[idx]!,
          ...draft,
        };
        result.pulledUpdated += 1;
      }
      continue;
    }

    // No mapping — try to adopt an existing local account with same fingerprint.
    const fp = localFingerprint(draft);
    const adopt = fingerprintToAccount.get(fp);
    if (adopt && !enteIdByAccountId.has(adopt.id)) {
      const idx = vault.accounts.findIndex((a) => a.id === adopt.id);
      if (idx !== -1) {
        vault.accounts[idx] = { ...vault.accounts[idx]!, ...draft };
        ente.entityMap[enteId] = adopt.id;
        enteIdByAccountId.set(adopt.id, enteId);
        result.pulledUpdated += 1;
        continue;
      }
    }

    const newAcc: Account = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      ...draft,
    };
    vault.accounts.push(newAcc);
    ente.entityMap[enteId] = newAcc.id;
    enteIdByAccountId.set(newAcc.id, enteId);
    fingerprintToAccount.set(fp, newAcc);
    result.pulledNew += 1;
  }
}

async function flushPendingPushes(
  vault: Vault,
  ente: EnteIntegration,
  authKey: string,
  result: SyncResult,
): Promise<void> {
  if (!ente.pending || ente.pending.length === 0) return;
  const remaining: EntePendingChange[] = [];
  for (const change of ente.pending) {
    try {
      if (change.op === "delete") {
        const enteId = change.enteId;
        if (enteId) {
          await deleteEntity(ente.serverUrl, ente.authToken, enteId);
          // Remove from entityMap if still present.
          for (const [id, accId] of Object.entries(ente.entityMap)) {
            if (id === enteId || accId === change.accountId) delete ente.entityMap[id];
          }
        }
        result.pushedDelete += 1;
        continue;
      }
      const account = vault.accounts.find((a) => a.id === change.accountId);
      if (!account) {
        // Account was removed locally between enqueue and flush — drop.
        continue;
      }
      const uri = accountToEnteUri(account);
      const blob = await encryptBlobJSON(uri, authKey);
      if (change.op === "create") {
        const { id } = await createEntity(ente.serverUrl, ente.authToken, {
          encryptedData: blob.encryptedData,
          header: blob.header,
        });
        ente.entityMap[id] = account.id;
        result.pushedCreate += 1;
      } else {
        // update
        let enteId = change.enteId;
        if (!enteId) {
          for (const [id, accId] of Object.entries(ente.entityMap)) {
            if (accId === account.id) {
              enteId = id;
              break;
            }
          }
        }
        if (!enteId) {
          // No remote — promote to create.
          const { id } = await createEntity(ente.serverUrl, ente.authToken, {
            encryptedData: blob.encryptedData,
            header: blob.header,
          });
          ente.entityMap[id] = account.id;
          result.pushedCreate += 1;
        } else {
          await updateEntity(ente.serverUrl, ente.authToken, {
            id: enteId,
            encryptedData: blob.encryptedData,
            header: blob.header,
          });
          result.pushedUpdate += 1;
        }
      }
    } catch (e) {
      if (isAuthError(e)) {
        result.needsReauth = true;
        // Keep this and all remaining pending changes for retry post-reauth.
        remaining.push(change);
        continue;
      }
      const next = { ...change, attempts: (change.attempts ?? 0) + 1 };
      result.pushFailures += 1;
      if (next.attempts < 5) remaining.push(next);
      else logError("ente", `dropping pending change after 5 attempts`, change);
    }
  }
  ente.pending = remaining;
}

export async function syncEnte(
  vault: Vault,
  serverTimeOffsetSetter?: (offsetMs: number) => void,
): Promise<SyncResult> {
  const ente = vault.integrations?.ente;
  if (!ente) throw new Error("Ente sync is not configured");
  const result = emptyResult();
  if (ente.needsReauth) {
    result.needsReauth = true;
    return result;
  }
  let authKey: string;
  try {
    authKey = await ensureAuthenticatorKey(ente);
  } catch (e) {
    if (isAuthError(e)) {
      ente.needsReauth = true;
      result.needsReauth = true;
      return result;
    }
    throw e;
  }

  // Push first so locally-known intents reach the server before we resolve diffs.
  await flushPendingPushes(vault, ente, authKey, result);

  if (result.needsReauth) {
    ente.needsReauth = true;
    return result;
  }

  let pullOutcome: Awaited<ReturnType<typeof pullEntities>>;
  try {
    pullOutcome = await pullEntities(ente, authKey);
  } catch (e) {
    if (isAuthError(e)) {
      ente.needsReauth = true;
      result.needsReauth = true;
      return result;
    }
    throw e;
  }

  applyPullToVault(vault, ente, pullOutcome.upserts, pullOutcome.deletes, result);
  ente.lastSync = pullOutcome.newSinceTime || ente.lastSync || Date.now();
  ente.lastError = undefined;
  if (serverTimeOffsetSetter) serverTimeOffsetSetter(0);
  return result;
}

export function enqueuePending(
  ente: EnteIntegration,
  op: EntePendingChange["op"],
  accountId: string,
  enteId?: string,
): void {
  if (!ente.pending) ente.pending = [];
  // De-duplicate by accountId + op: collapse repeated edits, supersede creates with deletes, etc.
  const filtered = ente.pending.filter((c) => c.accountId !== accountId);
  if (op === "delete" && !enteId) {
    // No remote ID known — locating by accountId via entityMap on flush.
    for (const [id, accId] of Object.entries(ente.entityMap)) {
      if (accId === accountId) {
        enteId = id;
        break;
      }
    }
  }
  // If deleting an account that was only ever a local-pending create, just drop both.
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
