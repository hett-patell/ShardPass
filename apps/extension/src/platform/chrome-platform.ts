/// <reference types="chrome" />

import {
  EnteSafeStateSchema,
  parseBackupResponseForRequest,
  parseOtpFillResponseForRequest,
  parseOtpImportResponseForRequest,
  parseOtpResponseForRequest,
  type BackupRequest,
  type BackupResponse,
  type EnteRequest,
  type EnteSafeState,
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
  BackupUiExtensionPlatform,
  EnteUiPlatform,
  OtpFillContentPlatform,
  OtpImportUiExtensionPlatform,
  OtpUiExtensionPlatform,
} from "./extension-platform";

const AUTO_LOCK_ALARM = "shardpass:auto-lock";
const ENTE_SYNC_ALARM = "shardpass:ente-otp-sync:v1";
const VAULT_STATE_PORT = "shardpass:v1:vault-state";

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

export function createChromePlatform(): BackgroundExtensionPlatform &
  BackupUiExtensionPlatform &
  EnteUiPlatform &
  OtpUiExtensionPlatform &
  OtpImportUiExtensionPlatform &
  OtpFillContentPlatform {
  const activePorts = new Set<chrome.runtime.Port>();
  const portDisposers = new Map<chrome.runtime.Port, () => void>();
  return {
    extensionId: chrome.runtime.id,
    localStorage: createChromeStoragePort(chrome.storage.local),
    sessionStorage: createChromeStoragePort(chrome.storage.session),

    async initializeTrustedStorage() {
      const local = chrome.storage.local as chrome.storage.StorageArea & {
        setAccessLevel?: (options: { accessLevel: "TRUSTED_CONTEXTS" }) => Promise<void>;
      };
      if (typeof local.setAccessLevel !== "function")
        throw new Error("Trusted local storage access is unavailable.");
      await local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
      await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    },

    async scheduleAutoLock(minutes) {
      await chrome.alarms.clear(AUTO_LOCK_ALARM);
      if (minutes !== null)
        await chrome.alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: minutes });
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
      } catch {
        throw new Error("Ente request unavailable");
      }
      const parsed = EnteSafeStateSchema.safeParse(candidate);
      if (parsed.success) return parsed.data;
      throw new Error("Ente request unavailable");
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

    openVaultPage() {
      return new Promise((resolve, reject) => {
        chrome.tabs.create({ url: chrome.runtime.getURL("vault/index.html") }, () => {
          const error = runtimeError();
          if (error === null) {
            resolve();
          } else {
            reject(error);
          }
        });
      });
    },
  };
}
