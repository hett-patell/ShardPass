import type {
  BackupRequest,
  BackupResponse,
  EnteRequest,
  EnteSafeState,
  GeneratePasswordRequest,
  GeneratePasswordResponse,
  ItemCrudRequest,
  ItemCrudResponse,
  LoginFillRequest,
  LoginFillResponse,
  OtpFillRequest,
  OtpFillResponse,
  OtpImportRequest,
  OtpImportResponse,
  OtpRequest,
  OtpResponse,
  PasskeyRequest,
  PasskeyResponse,
} from "@shardpass/messaging";
import type { StoragePort } from "@shardpass/storage";
import type { VaultPageTarget } from "./vault-route";

export type ExtensionMessageHandler = (
  payload: unknown,
  senderMetadata: unknown,
) => Promise<unknown>;

interface RuntimeExtensionPlatform {
  readonly extensionId: string;
  onMessage(handler: ExtensionMessageHandler): () => void;
  sendMessage(payload: unknown, transfer?: Transferable[]): Promise<unknown>;
  connectVaultState?(onState: (state: unknown) => void, onDisconnect: () => void): () => void;
  /** Opens the vault page, reusing an already-open vault tab, at `target` when given. */
  openVaultPage(target?: VaultPageTarget): Promise<void>;
}

export interface EnteUiPlatform extends RuntimeExtensionPlatform {
  sendEnteMessage(request: EnteRequest): Promise<EnteSafeState>;
}

export interface BackupUiExtensionPlatform extends RuntimeExtensionPlatform {
  sendBackupMessage(request: BackupRequest): Promise<BackupResponse>;
}

export interface OtpUiExtensionPlatform extends RuntimeExtensionPlatform {
  sendOtpMessage(request: OtpRequest): Promise<OtpResponse>;
  writeAuthoritativeClipboardText(value: Promise<string>): Promise<void>;
}

export interface OtpImportUiExtensionPlatform extends RuntimeExtensionPlatform {
  sendOtpImportMessage(request: OtpImportRequest): Promise<OtpImportResponse>;
}

export interface OtpFillContentPlatform extends RuntimeExtensionPlatform {
  sendOtpFillMessage(request: OtpFillRequest): Promise<OtpFillResponse>;
}

export interface ItemUiPlatform extends RuntimeExtensionPlatform {
  sendItemMessage(request: ItemCrudRequest): Promise<ItemCrudResponse>;
}

export interface LoginFillContentPlatform extends RuntimeExtensionPlatform {
  sendLoginFillMessage(request: LoginFillRequest): Promise<LoginFillResponse>;
}

export interface PasskeyContentPlatform extends RuntimeExtensionPlatform {
  sendPasskeyMessage(request: PasskeyRequest): Promise<PasskeyResponse>;
}

export interface PasswordGenUiPlatform extends RuntimeExtensionPlatform {
  sendPasswordGenMessage(request: GeneratePasswordRequest): Promise<GeneratePasswordResponse>;
}

export interface ExtensionPlatform extends RuntimeExtensionPlatform {
  sendOtpMessage(request: OtpRequest): Promise<OtpResponse>;
  writeAuthoritativeClipboardText(value: Promise<string>): Promise<void>;
  /** The tab the popup was opened over: id and URL, or null when there is none or no access. */
  activeTab(): Promise<Readonly<{ id: number; url: string }> | null>;
  /** Sends a runtime message to a tab's content scripts; rejects when none answers. */
  sendToTab(tabId: number, payload: unknown): Promise<unknown>;
}

export interface BackgroundExtensionPlatform extends RuntimeExtensionPlatform {
  readonly localStorage: StoragePort;
  readonly sessionStorage: StoragePort;
  initializeTrustedStorage(): Promise<void>;
  scheduleAutoLock(minutes: number | null): Promise<void>;
  /** Whether the auto-lock alarm is still armed (Chrome keeps alarms across worker restarts). */
  autoLockPending?(): Promise<boolean>;
  onAutoLock(handler: () => void): () => void;
  scheduleEnteSync?(minutes: 15 | null): Promise<void>;
  onEnteSyncAlarm?(handler: () => void): () => void;
  onUserActivity(handler: () => void): () => void;
  onIdleStateChanged(handler: (state: "active" | "idle" | "locked") => void): () => void;
  onLocalStorageChanged(handler: (changes: Readonly<Record<string, unknown>>) => void): () => void;
  onVaultStatePort(
    handler: (senderMetadata: unknown, send: (state: unknown) => void) => () => void,
  ): () => void;
}
