import type { Account, Vault, EncryptedVault } from "@/types";
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
  createVault,
  getEncryptedVault,
  getSettings,
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
import type { AccountWithCode, LockState, Message, Response } from "@/lib/messages";
import { log, error as logError } from "@/lib/log";

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

async function scheduleAutoLock(): Promise<void> {
  const settings = await getSettings();
  await chrome.alarms.clear(AUTO_LOCK_ALARM);
  if (settings.autoLockMinutes > 0) {
    await chrome.alarms.create(AUTO_LOCK_ALARM, {
      delayInMinutes: settings.autoLockMinutes,
    });
  }
}

function lock(): void {
  session.key = null;
  session.vault = null;
  session.unlockedAt = 0;
  void chrome.alarms.clear(AUTO_LOCK_ALARM);
}

chrome.idle.onStateChanged.addListener(async (newState) => {
  if (newState === "locked" && session.key) {
    const settings = await getSettings();
    if (settings.lockOnScreenLock) {
      lock();
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
      await scheduleAutoLock();
      return { ok: true, data: { state: "unlocked" as LockState } };
    }

    case "unlock": {
      const result = await unlockVault(msg.password);
      if (!result) return { ok: false, error: "Invalid password" };
      session.key = result.key;
      session.vault = result.vault;
      session.unlockedAt = Date.now();
      await scheduleAutoLock();
      return { ok: true, data: { state: "unlocked" as LockState } };
    }

    case "lock": {
      lock();
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
      return { ok: true, data: { duckduckgoConfigured: configured } };
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
  if (alarm.name === AUTO_LOCK_ALARM) lock();
});
