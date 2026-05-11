import "./sw-shims";
import type { Account, Vault, EncryptedVault, EnteIntegration, EntePendingChange } from "@/types";
import {
  base64ToBytes,
  bytesToBase64,
  decryptJSON,
  deriveKey,
  encryptJSON,
  randomBytes,
  CRYPTO_PARAMS,
} from "@/lib/crypto";
import {
  clearSessionKey,
  createVault,
  getEncryptedVault,
  getSettings,
  loadSessionKey,
  persistSessionKey,
  saveVault,
  setEncryptedVault,
  setSettings,
  unlockVault,
} from "@/lib/storage";
import {
  generateCode,
  secondsRemaining,
  normalizeSecret,
  isValidBase32,
} from "@/lib/totp";
import { getDomainParts } from "@/lib/detect";
import type { AccountWithCode, EnteStatus, LockState, Message, Response } from "@/lib/messages";
import { log, error as logError } from "@/lib/log";
// Push-queue is pure logic with no libsodium dependency, so we statically
// import it. The heavy ente auth/sync/api modules (which pull in libsodium,
// fast-srp-hap, buffer, asn1) are dynamic-imported on first use to keep
// them out of the SW boot chunk.
import { enqueuePending } from "@/lib/ente/queue";

log("bg", "service worker booted at", new Date().toISOString());

interface SessionState {
  key: CryptoKey | null;
  vault: Vault | null;
  unlockedAt: number;
}

const session: SessionState = {
  key: null,
  vault: null,
  unlockedAt: 0,
};

const AUTO_LOCK_ALARM = "auth-auto-lock";
const ENTE_SYNC_ALARM = "ente-auto-sync";

/**
 * Temporarily held login continuation for 2FA flows.
 * Typed as `unknown` at rest to avoid importing the concrete type at
 * the top level; narrowed via dynamic import when actually used.
 */
let entePending2FA: {
  email: string;
  serverUrl: string;
  twoFactorSessionID: string;
  derivedKEK: string;
} | null = null;

async function scheduleAutoLock(): Promise<void> {
  const settings = await getSettings();
  await chrome.alarms.clear(AUTO_LOCK_ALARM);
  if (settings.autoLockMinutes > 0) {
    await chrome.alarms.create(AUTO_LOCK_ALARM, {
      delayInMinutes: settings.autoLockMinutes,
    });
  }
}

async function lock(reason: string): Promise<void> {
  log("bg:lock", `lock(): ${reason}`);
  session.key = null;
  session.vault = null;
  session.unlockedAt = 0;
  entePending2FA = null;
  await chrome.alarms.clear(AUTO_LOCK_ALARM);
  await clearSessionKey();
}

/* ── Ente helpers ──────────────────────────────────────────── */

function getEnteStatus(): EnteStatus {
  const ente = session.vault?.integrations?.ente;
  if (entePending2FA) {
    return { connected: false, pending2FA: true, email: entePending2FA.email };
  }
  if (!ente) return { connected: false };
  return {
    connected: true,
    email: ente.email,
    serverUrl: ente.serverUrl,
    lastSync: ente.lastSync,
    lastError: ente.lastError,
    needsReauth: ente.needsReauth,
    accountCount: session.vault!.accounts.length,
  };
}

async function scheduleEnteSync(): Promise<void> {
  const ente = session.vault?.integrations?.ente;
  await chrome.alarms.clear(ENTE_SYNC_ALARM);
  if (ente && !ente.needsReauth) {
    await chrome.alarms.create(ENTE_SYNC_ALARM, { periodInMinutes: 15 });
    log("bg:ente", "scheduled auto-sync every 15 min");
  }
}

async function doEnteSync(): Promise<string | null> {
  if (!session.vault || !session.key) return "Vault is locked";
  const ente = session.vault.integrations?.ente;
  if (!ente) return "Ente not connected";
  try {
    log("bg:ente", "sync starting…");
    const { syncEnte } = await import("@/lib/ente/sync");
    const result = await syncEnte(session.vault);
    log("bg:ente", "sync result", result);
    await saveVault(session.vault, session.key);
    if (result.needsReauth) return "Session expired — please reconnect.";
    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError("bg:ente", "sync failed:", msg);
    ente.lastError = msg;
    await saveVault(session.vault, session.key);
    return msg;
  }
}

async function finishEnteLogin(signed: {
  status: "connected";
  email: string;
  serverUrl: string;
  authToken: string;
  masterKey: string;
  keyAttributes: unknown;
}): Promise<Response> {
  ensureUnlocked();
  const v = session.vault!;
  if (!v.integrations) v.integrations = {};
  const integration: EnteIntegration = {
    email: signed.email,
    serverUrl: signed.serverUrl,
    authToken: signed.authToken,
    masterKey: signed.masterKey,
    entityMap: {},
  };
  v.integrations.ente = integration;
  await saveVault(v, session.key!);
  // Trigger initial sync
  const syncErr = await doEnteSync();
  await scheduleEnteSync();
  return { ok: true, data: { status: getEnteStatus(), syncError: syncErr } };
}

/** Thin wrapper around the shared `enqueuePending` that resolves the active
 * integration from `session.vault` and skips work when no Ente sync is set
 * up. Kept synchronous so message handlers can enqueue before persisting. */
function enteEnqueue(op: EntePendingChange["op"], accountId: string): void {
  const ente = session.vault?.integrations?.ente;
  if (!ente || ente.needsReauth) return;
  enqueuePending(ente, op, accountId);
}

async function tryRestoreSession(): Promise<void> {
  if (session.key && session.vault) return;
  try {
    const key = await loadSessionKey();
    if (!key) {
      log("bg:restore", "no persisted session key");
      return;
    }
    const enc = await getEncryptedVault();
    if (!enc) {
      log("bg:restore", "no encrypted vault — clearing stale session key");
      await clearSessionKey();
      return;
    }
    const vault = await decryptJSON<Vault>(enc.iv, enc.ciphertext, key);
    session.key = key;
    session.vault = vault;
    session.unlockedAt = Date.now();
    log("bg:restore", `restored session (${vault.accounts.length} accounts)`);
  } catch (e) {
    logError("bg:restore", "failed, clearing session key:", e);
    await clearSessionKey();
  }
}

void tryRestoreSession();

chrome.idle.onStateChanged.addListener(async (newState) => {
  log("bg:idle", `state -> ${newState}`);
  if (newState === "locked" && session.key) {
    const settings = await getSettings();
    if (settings.lockOnScreenLock) {
      await lock("screen lock");
    }
  }
});

async function getLockState(): Promise<LockState> {
  if (session.key && session.vault) return "unlocked";
  const enc = await getEncryptedVault();
  return enc ? "locked" : "no_vault";
}

function ensureUnlocked(): void {
  if (!session.key || !session.vault) {
    throw new Error("Vault is locked");
  }
}

function findMatchesForDomain(vault: Vault, domain: string): Account[] {
  const { full, root } = getDomainParts(domain);
  const labels = root.split(".").filter((l) => l.length >= 4);
  const tokens = new Set<string>([full, root, ...labels]);
  const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9.]/g, "");
  return vault.accounts.filter((acc) => {
    const issuer = norm(acc.issuer);
    const label = norm(acc.label);
    const tags = (acc.tags || []).map(norm);
    for (const t of tokens) {
      const tn = norm(t);
      if (!tn || tn.length < 4) continue;
      if (
        issuer.includes(tn) ||
        label.includes(tn) ||
        tags.some((tag) => tag.includes(tn))
      ) {
        return true;
      }
    }
    return false;
  });
}

function makeAccountWithCode(acc: Account): AccountWithCode {
  return {
    id: acc.id,
    issuer: acc.issuer,
    label: acc.label,
    digits: acc.digits,
    period: acc.period,
    code: generateCode(acc),
    remainingSeconds: secondsRemaining(acc.period),
  };
}

async function handle(msg: Message): Promise<Response> {
  await tryRestoreSession();
  switch (msg.kind) {
    case "getState": {
      const state = await getLockState();
      const settings = await getSettings();
      return { ok: true, data: { state, settings } };
    }

    case "setup": {
      if (!msg.password || msg.password.length < 12) {
        return {
          ok: false,
          error: "Password must be at least 12 characters",
        };
      }
      const existing = await getEncryptedVault();
      if (existing) return { ok: false, error: "Vault already exists" };
      const { vault, key } = await createVault(msg.password);
      session.key = key;
      session.vault = vault;
      session.unlockedAt = Date.now();
      await persistSessionKey(key);
      await scheduleAutoLock();
      return { ok: true, data: { state: "unlocked" as LockState } };
    }

    case "unlock": {
      const result = await unlockVault(msg.password);
      if (!result) return { ok: false, error: "Invalid password" };
      session.key = result.key;
      session.vault = result.vault;
      session.unlockedAt = Date.now();
      await persistSessionKey(result.key);
      await scheduleAutoLock();
      return { ok: true, data: { state: "unlocked" as LockState } };
    }

    case "lock": {
      await lock("user");
      return { ok: true, data: null };
    }

    case "listAccounts": {
      ensureUnlocked();
      const accounts = session.vault!.accounts.map(makeAccountWithCode);
      return { ok: true, data: accounts };
    }

    case "addAccount": {
      ensureUnlocked();
      const { account } = msg;
      if (!isValidBase32(account.secret)) {
        return { ok: false, error: "Invalid base32 secret" };
      }
      const newAcc: Account = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        ...account,
        secret: normalizeSecret(account.secret),
      };
      session.vault!.accounts.push(newAcc);
      // Enqueue BEFORE persisting so the pending push survives an SW restart.
      enteEnqueue("create", newAcc.id);
      await saveVault(session.vault!, session.key!);
      await scheduleAutoLock();
      return { ok: true, data: makeAccountWithCode(newAcc) };
    }

    case "bulkAddAccounts": {
      ensureUnlocked();
      const vault = session.vault!;
      log("bg:bulk", `received ${msg.accounts.length} drafts; vault currently has ${vault.accounts.length}`);
      const seenKeys = new Set(
        vault.accounts.map(
          (a) =>
            `${normalizeSecret(a.secret)}|${a.issuer}|${a.label}`.toLowerCase(),
        ),
      );
      let added = 0;
      let skippedDuplicates = 0;
      let skippedInvalid = 0;
      const nowBase = Date.now();
      let i = 0;
      for (const draft of msg.accounts) {
        if (!isValidBase32(draft.secret)) {
          skippedInvalid++;
          log("bg:bulk", `skip invalid secret`, {
            issuer: draft.issuer,
            label: draft.label,
            secretLen: draft.secret?.length,
            secretHead: draft.secret?.slice(0, 4),
          });
          continue;
        }
        const norm = normalizeSecret(draft.secret);
        const fingerprint = `${norm}|${draft.issuer}|${draft.label}`.toLowerCase();
        if (seenKeys.has(fingerprint)) {
          skippedDuplicates++;
          log("bg:bulk", `skip duplicate`, { issuer: draft.issuer, label: draft.label });
          continue;
        }
        seenKeys.add(fingerprint);
        const newAcc: Account = {
          id: crypto.randomUUID(),
          createdAt: nowBase + i++,
          ...draft,
          secret: norm,
          tags: draft.tags ?? [],
        };
        vault.accounts.push(newAcc);
        added++;
      }
      log("bg:bulk", `processed: added=${added} dups=${skippedDuplicates} invalid=${skippedInvalid}; vault now has ${vault.accounts.length}`);
      if (added > 0) {
        try {
          await saveVault(vault, session.key!);
          log("bg:bulk", `saveVault ok; persisted ${vault.accounts.length} accounts`);
        } catch (e) {
          logError("bg:bulk", `saveVault failed`, e);
          throw e;
        }
        await scheduleAutoLock();
      }
      return {
        ok: true,
        data: {
          added,
          skippedDuplicates,
          skippedInvalid,
          totalProcessed: msg.accounts.length,
        },
      };
    }

    case "deleteAccount": {
      ensureUnlocked();
      enteEnqueue("delete", msg.id);
      session.vault!.accounts = session.vault!.accounts.filter((a) => a.id !== msg.id);
      await saveVault(session.vault!, session.key!);
      await scheduleAutoLock();
      return { ok: true, data: null };
    }

    case "updateAccount": {
      ensureUnlocked();
      const idx = session.vault!.accounts.findIndex((a) => a.id === msg.id);
      if (idx === -1) return { ok: false, error: "Account not found" };
      const merged: Account = { ...session.vault!.accounts[idx], ...msg.patch };
      if (msg.patch.secret && !isValidBase32(msg.patch.secret)) {
        return { ok: false, error: "Invalid base32 secret" };
      }
      if (msg.patch.secret) merged.secret = normalizeSecret(msg.patch.secret);
      session.vault!.accounts[idx] = merged;
      // Enqueue BEFORE persisting so the pending push survives an SW restart.
      enteEnqueue("update", msg.id);
      await saveVault(session.vault!, session.key!);
      await scheduleAutoLock();
      return { ok: true, data: makeAccountWithCode(merged) };
    }

    case "getCode": {
      ensureUnlocked();
      const acc = session.vault!.accounts.find((a) => a.id === msg.id);
      if (!acc) return { ok: false, error: "Account not found" };
      return { ok: true, data: makeAccountWithCode(acc) };
    }

    case "findForDomain": {
      if (!session.vault) {
        return { ok: true, data: { locked: true, matches: [] as AccountWithCode[] } };
      }
      const matches = findMatchesForDomain(session.vault, msg.domain).map(
        makeAccountWithCode,
      );
      return { ok: true, data: { locked: false, matches } };
    }

    case "exportVault": {
      ensureUnlocked();
      const enc = await getEncryptedVault();
      if (!enc) return { ok: false, error: "No vault" };
      const blob = JSON.stringify({
        type: "shardpass-export",
        ...enc,
      });
      return { ok: true, data: blob };
    }

    case "importVault": {
      try {
        const parsed = JSON.parse(msg.data) as Record<string, unknown>;
        if (parsed.type !== "shardpass-export" && parsed.type !== "chrome-authenticator-export") {
          return { ok: false, error: "Unrecognized export file" };
        }
        const salt = base64ToBytes(String(parsed.salt));
        const key = await deriveKey(
          msg.password,
          salt,
          Number(parsed.iterations) || CRYPTO_PARAMS.PBKDF2_ITERATIONS,
        );
        const vault = await decryptJSON<Vault>(
          String(parsed.iv),
          String(parsed.ciphertext),
          key,
        );
        if (session.key && session.vault) {
          const existingIds = new Set(session.vault.accounts.map((a) => a.id));
          for (const acc of vault.accounts) {
            if (!existingIds.has(acc.id)) session.vault.accounts.push(acc);
          }
          await saveVault(session.vault, session.key);
          return {
            ok: true,
            data: { merged: true, count: vault.accounts.length },
          };
        }
        const newSalt = randomBytes(CRYPTO_PARAMS.SALT_BYTES);
        const newKey = await deriveKey(msg.password, newSalt);
        const { iv, ciphertext } = await encryptJSON(vault, newKey);
        const ev: EncryptedVault = {
          version: 1,
          salt: bytesToBase64(newSalt),
          iv,
          ciphertext,
          iterations: CRYPTO_PARAMS.PBKDF2_ITERATIONS,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await setEncryptedVault(ev);
        session.key = newKey;
        session.vault = vault;
        session.unlockedAt = Date.now();
        await persistSessionKey(newKey);
        await scheduleAutoLock();
        return {
          ok: true,
          data: { merged: false, count: vault.accounts.length },
        };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "Import failed",
        };
      }
    }

    case "getSettings": {
      const settings = await getSettings();
      return { ok: true, data: settings };
    }

    case "updateSettings": {
      const patch: Partial<{ autoLockMinutes: number; lockOnScreenLock: boolean }> = {};
      if (msg.autoLockMinutes !== undefined) patch.autoLockMinutes = msg.autoLockMinutes;
      if (msg.lockOnScreenLock !== undefined) patch.lockOnScreenLock = msg.lockOnScreenLock;
      const next = await setSettings(patch);
      if (session.key) await scheduleAutoLock();
      return { ok: true, data: next };
    }

    case "getIntegrationStatus": {
      const configured = !!session.vault?.integrations?.duckduckgo?.token;
      return { ok: true, data: { duckduckgoConfigured: configured, ente: getEnteStatus() } };
    }

    case "setDuckToken": {
      ensureUnlocked();
      const token = msg.token.trim();
      if (!token) return { ok: false, error: "Token cannot be empty" };
      const v = session.vault!;
      if (!v.integrations) v.integrations = {};
      v.integrations.duckduckgo = { token };
      await saveVault(v, session.key!);
      log("bg:ddg", `token set (length=${token.length})`);
      return { ok: true, data: { duckduckgoConfigured: true } };
    }

    case "clearDuckToken": {
      ensureUnlocked();
      const v = session.vault!;
      if (v.integrations?.duckduckgo) {
        delete v.integrations.duckduckgo;
        await saveVault(v, session.key!);
        log("bg:ddg", `token cleared`);
      }
      return { ok: true, data: { duckduckgoConfigured: false } };
    }

    /* ── Ente Auth handlers ─────────────────────────────────── */

    case "enteLogin": {
      ensureUnlocked();
      entePending2FA = null;
      try {
        const [{ normalizeServerUrl }, { fetchSrpAttributes, loginWithPassword }] =
          await Promise.all([
            import("@/lib/ente/api"),
            import("@/lib/ente/auth"),
          ]);
        const serverUrl = normalizeServerUrl(msg.serverUrl);
        const attrs = await fetchSrpAttributes(serverUrl, msg.email);
        if (!attrs) {
          return { ok: false, error: "No SRP attributes found for this email. Check the email or server URL." };
        }
        const outcome = await loginWithPassword({
          serverUrl,
          email: msg.email,
          password: msg.password,
          attrs,
        });
        if (outcome.status === "passkey-only") {
          return { ok: false, error: outcome.message };
        }
        if (outcome.status === "twofa") {
          entePending2FA = outcome;
          return { ok: true, data: { status: getEnteStatus() } };
        }
        return await finishEnteLogin(outcome);
      } catch (e) {
        const msg2 = e instanceof Error ? e.message : String(e);
        logError("bg:ente", "login failed:", msg2);
        return { ok: false, error: msg2 };
      }
    }

    case "enteSubmit2FA": {
      ensureUnlocked();
      if (!entePending2FA) {
        return { ok: false, error: "No pending 2FA session." };
      }
      try {
        const { completeTwoFactor } = await import("@/lib/ente/auth");
        const signed = await completeTwoFactor({
          serverUrl: entePending2FA.serverUrl,
          email: entePending2FA.email,
          twoFactorSessionID: entePending2FA.twoFactorSessionID,
          code: msg.code,
          derivedKEK: entePending2FA.derivedKEK,
        });
        entePending2FA = null;
        return await finishEnteLogin(signed);
      } catch (e) {
        const msg2 = e instanceof Error ? e.message : String(e);
        logError("bg:ente", "2FA failed:", msg2);
        return { ok: false, error: msg2 };
      }
    }

    case "enteDisconnect": {
      ensureUnlocked();
      entePending2FA = null;
      const v = session.vault!;
      if (v.integrations?.ente) {
        delete v.integrations.ente;
        await saveVault(v, session.key!);
        await chrome.alarms.clear(ENTE_SYNC_ALARM);
        log("bg:ente", "disconnected");
      }
      return { ok: true, data: { status: getEnteStatus() } };
    }

    case "enteSyncNow": {
      ensureUnlocked();
      const err = await doEnteSync();
      return err
        ? { ok: false, error: err }
        : { ok: true, data: { status: getEnteStatus() } };
    }

    case "generateDuckAlias": {
      ensureUnlocked();
      const token = session.vault!.integrations?.duckduckgo?.token;
      if (!token) {
        return {
          ok: false,
          error: "DuckDuckGo not configured — add a token in Settings.",
        };
      }
      try {
        log("bg:ddg", "generating alias…");
        const res = await fetch(
          "https://quack.duckduckgo.com/api/email/addresses",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          },
        );
        if (res.status === 401 || res.status === 403) {
          return {
            ok: false,
            error: "DuckDuckGo token is invalid or expired.",
          };
        }
        if (res.status === 429) {
          return {
            ok: false,
            error: "DuckDuckGo rate-limited the request. Wait a moment.",
          };
        }
        if (!res.ok) {
          return {
            ok: false,
            error: `DuckDuckGo error: ${res.status} ${res.statusText}`,
          };
        }
        const json = (await res.json()) as { address?: string };
        if (!json.address) {
          return { ok: false, error: "Unexpected response from DuckDuckGo." };
        }
        const alias = `${json.address}@duck.com`;
        log("bg:ddg", `alias generated`);
        return { ok: true, data: { alias } };
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : "Network error";
        logError("bg:ddg", `generateDuckAlias failed:`, errMsg);
        return { ok: false, error: errMsg };
      }
    }

    default:
      return { ok: false, error: "Unknown message" };
  }
}

chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
  const t0 = performance.now();
  log("bg:rx", `← ${msg?.kind ?? "unknown"} from`, sender?.url || sender?.id || "popup");
  void handle(msg)
    .then((res) => {
      const ms = (performance.now() - t0).toFixed(1);
      if (res.ok) {
        log("bg:tx", `→ ${msg?.kind ?? "unknown"} ok (${ms}ms)`);
      } else {
        logError("bg:tx", `→ ${msg?.kind ?? "unknown"} error (${ms}ms):`, res.error);
      }
      sendResponse(res);
    })
    .catch((e) => {
      const ms = (performance.now() - t0).toFixed(1);
      logError("bg:tx", `→ ${msg?.kind ?? "unknown"} threw (${ms}ms):`, e);
      sendResponse({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    });
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_LOCK_ALARM) void lock("auto-lock alarm");
  if (alarm.name === ENTE_SYNC_ALARM) {
    log("bg:ente", "auto-sync alarm fired");
    void doEnteSync();
  }
});
