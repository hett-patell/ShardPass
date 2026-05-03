import type { Account } from "@/types";
import { log, error as logError } from "@/lib/log";

export type LockState = "no_vault" | "locked" | "unlocked";

export interface AccountWithCode {
  id: string;
  issuer: string;
  label: string;
  digits: number;
  period: number;
  code: string;
  remainingSeconds: number;
}

export type Message =
  | { kind: "getState" }
  | { kind: "setup"; password: string }
  | { kind: "unlock"; password: string }
  | { kind: "lock" }
  | { kind: "listAccounts" }
  | { kind: "addAccount"; account: Omit<Account, "id" | "createdAt"> }
  | { kind: "deleteAccount"; id: string }
  | {
      kind: "updateAccount";
      id: string;
      patch: Partial<Omit<Account, "id" | "createdAt">>;
    }
  | { kind: "getCode"; id: string }
  | { kind: "findForDomain"; domain: string }
  | { kind: "exportVault" }
  | { kind: "importVault"; data: string; password: string }
  | { kind: "bulkAddAccounts"; accounts: Omit<Account, "id" | "createdAt">[] }
  | { kind: "getSettings" }
  | { kind: "updateSettings"; autoLockMinutes?: number; lockOnScreenLock?: boolean }
  | { kind: "getIntegrationStatus" }
  | { kind: "setDuckToken"; token: string }
  | { kind: "clearDuckToken" }
  | { kind: "generateDuckAlias" };

export interface IntegrationStatus {
  duckduckgoConfigured: boolean;
}

export type Response<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

let nextSeq = 1;

export function send<T = unknown>(msg: Message): Promise<Response<T>> {
  const seq = nextSeq++;
  const t0 = performance.now();
  log("send", `→ #${seq} ${msg.kind}`, summarize(msg));
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        const ms = (performance.now() - t0).toFixed(1);
        if (chrome.runtime.lastError) {
          const err = chrome.runtime.lastError.message ?? "send failed";
          logError("send", `✗ #${seq} ${msg.kind} (${ms}ms) lastError:`, err);
          resolve({ ok: false, error: err });
          return;
        }
        if (!res || typeof res !== "object") {
          logError("send", `✗ #${seq} ${msg.kind} (${ms}ms) empty response`, res);
          resolve({ ok: false, error: "No response from background — try again" });
          return;
        }
        const typed = res as Response<T>;
        if (typed.ok) {
          log("send", `← #${seq} ${msg.kind} (${ms}ms) ok`, summarizeResponse(typed.data));
        } else {
          logError("send", `← #${seq} ${msg.kind} (${ms}ms) error:`, typed.error);
        }
        resolve(typed);
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      logError("send", `✗ #${seq} ${msg.kind} threw:`, errMsg);
      resolve({ ok: false, error: errMsg });
    }
  });
}

function summarize(msg: Message): unknown {
  if (msg.kind === "setup" || msg.kind === "unlock") {
    return { passwordLen: msg.password.length };
  }
  if (msg.kind === "importVault") {
    return { dataLen: msg.data.length, passwordLen: msg.password.length };
  }
  if (msg.kind === "bulkAddAccounts") {
    return { count: msg.accounts.length, sample: msg.accounts.slice(0, 2).map(redactSecret) };
  }
  if (msg.kind === "addAccount") {
    return { account: redactSecret(msg.account) };
  }
  return msg;
}

function redactSecret(a: { secret?: string; issuer?: string; label?: string }) {
  return {
    issuer: a.issuer,
    label: a.label,
    secretLen: a.secret?.length,
    secretHead: a.secret?.slice(0, 4),
  };
}

function summarizeResponse(data: unknown): unknown {
  if (Array.isArray(data)) return { length: data.length };
  if (typeof data === "string") return { length: data.length };
  return data;
}
