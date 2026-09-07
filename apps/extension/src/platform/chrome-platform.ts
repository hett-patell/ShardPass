/// <reference types="chrome" />

import {
  EnteSafeStateSchema,
  parseBackupResponseForRequest,
  parseLoginFillResponseForRequest,
  parsePasskeyResponseForRequest,
  parseOtpFillResponseForRequest,
  parseOtpImportResponseForRequest,
  parseOtpResponseForRequest,
  type BackupRequest,
  type BackupResponse,
  type EnteRequest,
  type EnteSafeState,
  type LoginFillRequest,
  type PasskeyRequest,
  type PasskeyResponse,
  type LoginFillResponse,
  type OtpFillRequest,
  type OtpFillResponse,
  type OtpImportRequest,
  type OtpImportResponse,
  type OtpRequest,
  type OtpResponse,
  type RawSenderMetadata,
} from "@shardpass/messaging";
import { toSafeError, type SafeErrorCode } from "@shardpass/security";

import { createChromeStoragePort } from "./chrome-storage-port";
import type {
  BackgroundExtensionPlatform,
  ExtensionPlatform,
  BackupUiExtensionPlatform,
  EnteUiPlatform,
  LoginFillContentPlatform,
  OtpFillContentPlatform,
  OtpImportUiExtensionPlatform,
  OtpUiExtensionPlatform,
  PasskeyContentPlatform,
} from "./extension-platform";
import { diagnostics } from "./diagnostics";
import { vaultPageHash } from "./vault-route";

const AUTO_LOCK_ALARM = "shardpass:auto-lock";
const ENTE_SYNC_ALARM = "shardpass:ente-otp-sync:v1";
const VAULT_STATE_PORT = "shardpass:v1:vault-state";

type AccessLevelCapableArea = chrome.storage.StorageArea & {
  setAccessLevel?: (options: { accessLevel: "TRUSTED_CONTEXTS" }) => Promise<void>;
};

/** An Ente failure for the panel: `code` names it, `detail` (when known) says where. */
function enteFailure(code: string, detail?: string): Error & { code: string; detail?: string } {
  const error = new Error("Ente request failed") as Error & { code: string; detail?: string };
  error.code = code;
  if (detail !== undefined) error.detail = detail;
  return error;
}

/** Restricts an area to trusted contexts where the browser supports it; warns where it does not. */
async function setTrustedAccess(area: chrome.storage.StorageArea, label: string): Promise<void> {
  const capable = area as AccessLevelCapableArea;
  if (typeof capable.setAccessLevel !== "function") {
    diagnostics.warn(`[ShardPass] ${label}.setAccessLevel is unavailable; keeping default access.`);
    return;
  }
  try {
    await capable.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  } catch (error) {
    diagnostics.warn(`[ShardPass] ${label}.setAccessLevel failed; keeping default access.`, error);
  }
}

function runtimeError(): Error | null {
  const message = chrome.runtime.lastError?.message;
  return message === undefined ? null : new Error(message);
}

const safeErrorCodes = new Set<SafeErrorCode>([
  "BACKUP_INVALID",
  "BACKUP_AUTH_FAILED",
  "BACKUP_EXPIRED",
  "BACKUP_CHANGED",
  "BACKUP_CAPACITY",
  "BACKUP_UNAVAILABLE",
  "CHALLENGE_INVALID",
  "INVALID_CREDENTIALS",
  "INVALID_MESSAGE",
  "OTP_INVALID",
  "OTP_IMPORT_INVALID",
  "OTP_IMPORT_LIMIT",
  "OTP_IMPORT_EXPIRED",
  "OTP_IMPORT_CAPACITY",
  "OTP_IMPORT_UNAVAILABLE",
  "OTP_NOT_FOUND",
  "OTP_CONFLICT",
  "OTP_HOTP_REQUIRED",
  "OTP_RESERVATION_INVALID",
  "OTP_RESERVATION_STALE",
  "OTP_RESERVATION_UNCERTAIN",
  "OTP_FILL_INVALID",
  "OTP_FILL_UNAVAILABLE",
  "OTP_FILL_EXPIRED",
  "OTP_FILL_FIELD_CHANGED",
  "OTP_FILL_ITEM_CHANGED",
  "OTP_FILL_CANCELLED",
  "OTP_FILL_UNCERTAIN",
  "LOGIN_FILL_INVALID",
  "LOGIN_FILL_UNAVAILABLE",
  "LOGIN_FILL_NOT_FOUND",
  "LOGIN_FILL_ITEM_CHANGED",
  "CLIPBOARD_UNAVAILABLE",
  "THROTTLED",
  "UNAUTHORIZED_SENDER",
  "UNSUPPORTED_CONTEXT",
  "VAULT_ALREADY_CONFIGURED",
  "VAULT_LOCKED",
  "VAULT_NOT_CONFIGURED",
  "VAULT_UNAVAILABLE",
  "UNEXPECTED",
]);

function safeUiFailure(
  candidate: unknown,
  fallback: SafeErrorCode,
): Error & {
  code: SafeErrorCode;
} {
  let code = fallback;
  if (typeof candidate === "object" && candidate !== null && "error" in candidate) {
    const error = (candidate as { error?: unknown }).error;
    if (typeof error === "object" && error !== null && "code" in error) {
      const candidateCode = (error as { code?: unknown }).code;
      if (typeof candidateCode === "string" && safeErrorCodes.has(candidateCode as SafeErrorCode))
        code = candidateCode as SafeErrorCode;
    }
  }
  const safe = toSafeError(undefined, code);
  return Object.assign(new Error(safe.message), safe);
}

function rawSenderMetadata(sender: chrome.runtime.MessageSender): RawSenderMetadata | null {
  if (sender.id === undefined || sender.url === undefined) {
    return null;
  }

  const metadata: Record<string, unknown> = {
    extensionId: sender.id,
    senderUrl: sender.url,
  };

  if (sender.tab?.id !== undefined) {
    metadata.tabId = sender.tab.id;
  }
  if (sender.frameId !== undefined) {
    metadata.frameId = sender.frameId;
  }
  if (sender.documentId !== undefined) {
    metadata.documentId = sender.documentId;
  }

  return metadata as RawSenderMetadata;
}

type ExtensionContextLike = { contextType?: string; documentUrl?: string; tabId?: number; windowId?: number };

/**
 * Finds the open vault tab, if any. `chrome.runtime.getContexts` (Chromium 116+) needs no
 * permission and sees every page of this extension; older runtimes fall back to
 * `tabs.query`, which can read this extension's own URLs without the tabs permission.
 */
function findVaultTab(base: string, done: (tab: { id: number; windowId: number } | undefined) => void): void {
  const runtime = chrome.runtime as { getContexts?: (filter: object, callback: (contexts: ExtensionContextLike[]) => void) => void };
  const fromContexts = (contexts: ExtensionContextLike[]) =>
    contexts.find(
      (context) =>
        context.contextType === "TAB" &&
        typeof context.tabId === "number" &&
        context.tabId >= 0 &&
        typeof context.windowId === "number" &&
        (context.documentUrl ?? "").startsWith(base),
    );
  if (typeof runtime.getContexts === "function") {
    // Not `new URL(base).origin`: outside Chrome the extension scheme is opaque and reads "null".
    const origin = base.slice(0, base.indexOf("/", "chrome-extension://".length));
    runtime.getContexts({ contextTypes: ["TAB"], documentOrigins: [origin] }, (contexts) => {
      if (runtimeError() !== null) {
        done(undefined);
        return;
      }
      const found = fromContexts(contexts);
      done(found === undefined ? undefined : { id: found.tabId as number, windowId: found.windowId as number });
    });
    return;
  }
  if (typeof chrome.tabs.query !== "function") {
    done(undefined);
    return;
  }
  chrome.tabs.query({ url: `${base}*` }, (tabs) => {
    if (runtimeError() !== null) {
      done(undefined);
      return;
    }
    const found = tabs.find((tab) => tab.id !== undefined);
    done(found?.id === undefined ? undefined : { id: found.id, windowId: found.windowId });
  });
}

export function createChromePlatform(): BackgroundExtensionPlatform &
  BackupUiExtensionPlatform &
  EnteUiPlatform &
  OtpUiExtensionPlatform &
  OtpImportUiExtensionPlatform &
  OtpFillContentPlatform &
  LoginFillContentPlatform &
  PasskeyContentPlatform &
  ExtensionPlatform {
  const activePorts = new Set<chrome.runtime.Port>();
  const portDisposers = new Map<chrome.runtime.Port, () => void>();
  return {
    extensionId: chrome.runtime.id,
    localStorage: createChromeStoragePort(chrome.storage.local),
    sessionStorage: createChromeStoragePort(chrome.storage.session),

    // StorageArea.setAccessLevel() on chrome.storage.local only exists in Chromium >= 132;
    // forks that lag upstream (Brave, Vivaldi, older Edge) do not expose it. Hardening is
    // therefore best-effort rather than required: chrome.storage.local holds only encrypted
    // records — the DEK lives in session storage and memory — and chrome.storage.session
    // already defaults to TRUSTED_CONTEXTS. Throwing here would brick the whole service
    // worker on those browsers, which is strictly worse than losing one layer of defence.
    async initializeTrustedStorage() {
      await setTrustedAccess(chrome.storage.local, "chrome.storage.local");
      await setTrustedAccess(chrome.storage.session, "chrome.storage.session");
    },

    async scheduleAutoLock(minutes) {
      await chrome.alarms.clear(AUTO_LOCK_ALARM);
      if (minutes !== null)
        await chrome.alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: minutes });
    },

    async autoLockPending() {
      if (typeof chrome.alarms.get !== "function") return false;
      const alarm = await chrome.alarms.get(AUTO_LOCK_ALARM);
      return alarm !== undefined && alarm !== null;
    },

    onAutoLock(handler) {
      const listener = (alarm: chrome.alarms.Alarm) => {
        if (alarm.name === AUTO_LOCK_ALARM) handler();
      };
      chrome.alarms.onAlarm.addListener(listener);
      return () => chrome.alarms.onAlarm.removeListener(listener);
    },

    async scheduleEnteSync(minutes) {
      await chrome.alarms.clear(ENTE_SYNC_ALARM);
      if (minutes !== null)
        await chrome.alarms.create(ENTE_SYNC_ALARM, { periodInMinutes: minutes });
    },

    onEnteSyncAlarm(handler) {
      const listener = (alarm: chrome.alarms.Alarm) => {
        if (alarm.name === ENTE_SYNC_ALARM) handler();
      };
      chrome.alarms.onAlarm.addListener(listener);
      return () => chrome.alarms.onAlarm.removeListener(listener);
    },

    onUserActivity() {
      // Runtime-message routing calls SettingsService.notePrivilegedActivity explicitly.
      return () => undefined;
    },

    onIdleStateChanged(handler) {
      chrome.idle.onStateChanged.addListener(handler);
      return () => chrome.idle.onStateChanged.removeListener(handler);
    },

    onLocalStorageChanged(handler) {
      const listener = (
        changes: Record<string, chrome.storage.StorageChange>,
        areaName: string,
      ) => {
        if (areaName !== "local") return;
        handler(
          Object.fromEntries(
            Object.entries(changes).map(([key, change]) => [key, change.newValue]),
          ),
        );
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    },

    onVaultStatePort(handler) {
      const listener = (port: chrome.runtime.Port) => {
        if (port.name !== VAULT_STATE_PORT) return;
        activePorts.add(port);
        const disposeSubscription = handler(
          port.sender === undefined ? null : rawSenderMetadata(port.sender),
          (state) => port.postMessage(state),
        );
        let done = false;
        const dispose = () => {
          if (done) return;
          done = true;
          disposeSubscription();
          port.onDisconnect.removeListener(dispose);
          activePorts.delete(port);
          portDisposers.delete(port);
        };
        portDisposers.set(port, dispose);
        port.onDisconnect.addListener(dispose);
      };
      chrome.runtime.onConnect.addListener(listener);
      return () => {
        chrome.runtime.onConnect.removeListener(listener);
        for (const port of [...activePorts]) {
          portDisposers.get(port)?.();
          try {
            port.disconnect();
          } catch {
            // The browser may already have invalidated the port.
          }
        }
      };
    },

    onMessage(handler) {
      const listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (
        payload,
        sender,
        sendResponse,
      ) => {
        void handler(payload, rawSenderMetadata(sender)).then(
          (response) => {
            sendResponse(response);
          },
          () => {
            sendResponse(undefined);
          },
        );
        return true;
      };

      chrome.runtime.onMessage.addListener(listener);
      let disposed = false;
      return () => {
        if (!disposed) {
          chrome.runtime.onMessage.removeListener(listener);
          disposed = true;
        }
      };
    },

    connectVaultState(onState, onDisconnect) {
      const port = chrome.runtime.connect({ name: VAULT_STATE_PORT });
      port.onMessage.addListener(onState);
      port.onDisconnect.addListener(onDisconnect);
      return () => {
        port.onMessage.removeListener(onState);
        port.onDisconnect.removeListener(onDisconnect);
        port.disconnect();
      };
    },

    sendMessage(payload) {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(payload, (response: unknown) => {
          const error = runtimeError();
          if (error === null) {
            resolve(response);
          } else {
            reject(error);
          }
        });
      });
    },

    async sendEnteMessage(request: EnteRequest): Promise<EnteSafeState> {
      let candidate: unknown;
      try {
        candidate = await this.sendMessage(request);
      } catch (failure) {
        // No reply at all: the port closed, or the worker was gone. Chrome's own wording
        // ("The message port closed before a response was received.") is the useful part.
        const why = failure instanceof Error ? failure.message.slice(0, 120) : "";
        throw enteFailure("ENTE_UNAVAILABLE", `no reply from the background${why ? ` (${why})` : ""}`);
      }
      const parsed = EnteSafeStateSchema.safeParse(candidate);
      if (parsed.success) return parsed.data;
      // The background's error envelope. Its code and detail are the whole diagnosis of a
      // failed cycle; flattening them to "unavailable" left every sync failure unreadable.
      const envelope = candidate as { kind?: unknown; error?: { code?: unknown; detail?: unknown } } | null;
      if (envelope?.kind === "error" && typeof envelope.error?.code === "string")
        throw enteFailure(
          envelope.error.code,
          typeof envelope.error.detail === "string" ? envelope.error.detail : undefined,
        );
      throw enteFailure("ENTE_UNAVAILABLE", "unexpected reply shape from the background");
    },

    async sendBackupMessage(request: BackupRequest): Promise<BackupResponse> {
      let candidate: unknown;
      try {
        candidate = await this.sendMessage(request);
      } catch {
        throw safeUiFailure(undefined, "BACKUP_UNAVAILABLE");
      }
      const parsed = parseBackupResponseForRequest(request, candidate);
      if (parsed.success) return parsed.data;
      throw safeUiFailure(candidate, "BACKUP_UNAVAILABLE");
    },

    async sendOtpMessage(request: OtpRequest): Promise<OtpResponse> {
      let candidate: unknown;
      try {
        candidate = await this.sendMessage(request);
      } catch {
        throw safeUiFailure(undefined, "VAULT_UNAVAILABLE");
      }
      const parsed = parseOtpResponseForRequest(request, candidate);
      if (parsed.success) return parsed.data;
      throw safeUiFailure(candidate, "VAULT_UNAVAILABLE");
    },

    async sendOtpFillMessage(request: OtpFillRequest): Promise<OtpFillResponse> {
      let candidate: unknown;
      try {
        candidate = await this.sendMessage({ ...request });
      } catch {
        throw safeUiFailure(undefined, "OTP_FILL_UNAVAILABLE");
      }
      const parsed = parseOtpFillResponseForRequest(request, candidate);
      if (parsed.success) return parsed.data;
      throw safeUiFailure(candidate, "OTP_FILL_UNAVAILABLE");
    },

    async sendLoginFillMessage(request: LoginFillRequest): Promise<LoginFillResponse> {
      let candidate: unknown;
      try {
        candidate = await this.sendMessage({ ...request });
      } catch {
        throw safeUiFailure(undefined, "LOGIN_FILL_UNAVAILABLE");
      }
      const parsed = parseLoginFillResponseForRequest(request, candidate);
      if (parsed.success) return parsed.data;
      throw safeUiFailure(candidate, "LOGIN_FILL_UNAVAILABLE");
    },

    async sendPasskeyMessage(request: PasskeyRequest): Promise<PasskeyResponse> {
      let candidate: unknown;
      try {
        candidate = await this.sendMessage({ ...request });
      } catch {
        throw safeUiFailure(undefined, "PASSKEY_INVALID");
      }
      const parsed = parsePasskeyResponseForRequest(request, candidate);
      if (parsed.success) return parsed.data;
      throw safeUiFailure(candidate, "PASSKEY_INVALID");
    },

    sendOtpImportMessage(request: OtpImportRequest): Promise<OtpImportResponse> {
      const kind = request.kind;
      const pairingRequest =
        kind === "otp.importPreview"
          ? ({ version: 1, kind, format: request.format, candidates: [] } as OtpImportRequest)
          : { ...request };
      const transportRequest: OtpImportRequest =
        kind === "otp.importPreview"
          ? {
              version: 1,
              kind,
              format: request.format,
              candidates: request.candidates.map((candidate) => ({
                ...candidate,
                tags: [...candidate.tags],
              })),
            }
          : { ...request };
      let pending: Promise<unknown>;
      try {
        pending = this.sendMessage(transportRequest);
      } catch {
        return Promise.reject(safeUiFailure(undefined, "OTP_IMPORT_UNAVAILABLE"));
      }
      return pending.then(
        (candidate) => {
          const parsed = parseOtpImportResponseForRequest(pairingRequest, candidate);
          if (parsed.success) return parsed.data;
          throw safeUiFailure(candidate, "OTP_IMPORT_UNAVAILABLE");
        },
        () => Promise.reject(safeUiFailure(undefined, "OTP_IMPORT_UNAVAILABLE")),
      );
    },

    writeAuthoritativeClipboardText(value: Promise<string>): Promise<void> {
      try {
        if (typeof ClipboardItem !== "function" || typeof navigator.clipboard?.write !== "function")
          return Promise.reject(safeUiFailure(undefined, "CLIPBOARD_UNAVAILABLE"));
        const text = value.then(
          (authoritative) => new Blob([authoritative], { type: "text/plain" }),
        );
        return navigator.clipboard
          .write([new ClipboardItem({ "text/plain": text })])
          .catch(() => Promise.reject(safeUiFailure(undefined, "CLIPBOARD_UNAVAILABLE")));
      } catch {
        return Promise.reject(safeUiFailure(undefined, "CLIPBOARD_UNAVAILABLE"));
      }
    },

    activeTab() {
      return new Promise((resolve) => {
        try {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];
            // Without activeTab access the URL is undefined; that is "no tab" for the popup.
            if (runtimeError() !== null || tab?.id === undefined || typeof tab.url !== "string")
              resolve(null);
            else resolve({ id: tab.id, url: tab.url });
          });
        } catch {
          resolve(null);
        }
      });
    },

    sendToTab(tabId, payload) {
      return new Promise((resolve, reject) => {
        try {
          chrome.tabs.sendMessage(tabId, payload, (response: unknown) => {
            const error = runtimeError();
            if (error !== null) reject(error);
            else resolve(response);
          });
        } catch (error) {
          reject(error instanceof Error ? error : new Error("tab message failed"));
        }
      });
    },

    openVaultPage(target) {
      const base = chrome.runtime.getURL("vault/index.html");
      const url = base + vaultPageHash(target);
      return new Promise((resolve, reject) => {
        const settle = () => {
          const error = runtimeError();
          if (error === null) resolve();
          else reject(error);
        };
        const create = () => chrome.tabs.create({ url }, settle);
        // A vault tab that is already open is focused (and moved, when there is a target)
        // rather than duplicated. Without a target only `active` changes: navigating a tab
        // to the URL it already shows is a full reload, which would throw away a half-filled
        // form. Anything odd falls back to a new tab.
        findVaultTab(base, (existing) => {
          if (existing === undefined) {
            create();
            return;
          }
          chrome.tabs.update(existing.id, target === undefined ? { active: true } : { url, active: true }, () => {
            if (runtimeError() !== null) {
              create();
              return;
            }
            if (typeof chrome.windows?.update === "function") {
              chrome.windows.update(existing.windowId, { focused: true }, () => {
                runtimeError();
                resolve();
              });
            } else resolve();
          });
        });
      });
    },
  };
}
