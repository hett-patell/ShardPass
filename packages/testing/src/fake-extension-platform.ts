import { FakeStoragePort } from "./fake-storage-port";

type MessageHandler = (payload: unknown, senderMetadata: unknown) => Promise<unknown>;

export class FakeExtensionPlatform {
  readonly sentMessages: unknown[] = [];
  readonly localStorage = new FakeStoragePort();
  readonly sessionStorage = new FakeStoragePort();
  autoLockMinutes: number | null = null;
  enteSyncMinutes: 15 | null = null;
  readonly enteSyncSchedules: (15 | null)[] = [];
  openVaultPageCallCount = 0;
  clipboardWriteCallCount = 0;
  clipboardCompletedWriteCount = 0;
  clipboardWriteShouldFail = false;

  readonly extensionId: string;
  private readonly listeners = new Set<MessageHandler>();
  private readonly sendResponses: unknown[] = [];
  private autoLockHandler: (() => void) | null = null;
  private enteSyncHandler: (() => void) | null = null;
  private idleHandler: ((state: "active" | "idle" | "locked") => void) | null = null;
  private storageHandler: ((changes: Readonly<Record<string, unknown>>) => void) | null = null;
  private portHandler:
    ((senderMetadata: unknown, send: (state: unknown) => void) => () => void) | null = null;
  private readiness: Promise<void> = Promise.resolve();

  constructor(extensionId: string) {
    this.extensionId = extensionId;
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  initializeTrustedStorage(): Promise<void> {
    return this.readiness;
  }
  deferReadiness(promise: Promise<void>): void {
    this.readiness = promise;
  }
  scheduleAutoLock(minutes: number | null): Promise<void> {
    this.autoLockMinutes = minutes;
    return Promise.resolve();
  }
  onAutoLock(handler: () => void): () => void {
    this.autoLockHandler = handler;
    return () => {
      if (this.autoLockHandler === handler) this.autoLockHandler = null;
    };
  }
  scheduleEnteSync(minutes: 15 | null): Promise<void> {
    this.enteSyncMinutes = minutes;
    this.enteSyncSchedules.push(minutes);
    return Promise.resolve();
  }
  onEnteSyncAlarm(handler: () => void): () => void {
    this.enteSyncHandler = handler;
    return () => {
      if (this.enteSyncHandler === handler) this.enteSyncHandler = null;
    };
  }
  onUserActivity(): () => void {
    return () => undefined;
  }
  onIdleStateChanged(handler: (state: "active" | "idle" | "locked") => void): () => void {
    this.idleHandler = handler;
    return () => {
      if (this.idleHandler === handler) this.idleHandler = null;
    };
  }
  onLocalStorageChanged(handler: (changes: Readonly<Record<string, unknown>>) => void): () => void {
    this.storageHandler = handler;
    return () => {
      if (this.storageHandler === handler) this.storageHandler = null;
    };
  }
  onVaultStatePort(
    handler: (senderMetadata: unknown, send: (state: unknown) => void) => () => void,
  ): () => void {
    this.portHandler = handler;
    return () => {
      if (this.portHandler === handler) this.portHandler = null;
    };
  }
  connectVaultState(): () => void {
    return () => undefined;
  }

  onMessage(handler: MessageHandler): () => void {
    this.listeners.add(handler);
    let disposed = false;

    return () => {
      if (!disposed) {
        this.listeners.delete(handler);
        disposed = true;
      }
    };
  }

  sendMessage(payload: unknown): Promise<unknown> {
    this.sentMessages.push(payload);
    return Promise.resolve(this.sendResponses.shift());
  }

  sendEnteMessage<T>(request: unknown): Promise<T> {
    this.sentMessages.push(request);
    const next = this.sendResponses[0];
    if (
      typeof next === "object" &&
      next !== null &&
      "kind" in next &&
      (next as { kind?: unknown }).kind === "ente.state"
    )
      return Promise.resolve(this.sendResponses.shift() as T);
    return Promise.resolve({
      version: 1,
      kind: "ente.state",
      state: "disconnected",
      connected: false,
      pendingCount: 0,
      conflictCount: 0,
      lastSuccessAt: null,
    } as T);
  }

  sendBackupMessage<T>(request: unknown): Promise<T> {
    return this.sendMessage(request) as Promise<T>;
  }

  sendOtpMessage<T>(request: unknown): Promise<T> {
    return this.sendMessage(request) as Promise<T>;
  }

  sendPasskeyMessage<T>(request: unknown): Promise<T> {
    return this.sendMessage(request) as Promise<T>;
  }

  sendOtpImportMessage<T>(request: unknown): Promise<T> {
    return this.sendMessage(request) as Promise<T>;
  }

  writeAuthoritativeClipboardText(value: Promise<string>): Promise<void> {
    this.clipboardWriteCallCount += 1;
    if (this.clipboardWriteShouldFail) return Promise.reject(new Error("CLIPBOARD_UNAVAILABLE"));
    return value.then(() => {
      this.clipboardCompletedWriteCount += 1;
    });
  }

  openVaultPage(): Promise<void> {
    this.openVaultPageCallCount += 1;
    return Promise.resolve();
  }

  /** What `activeTab()` answers; null (the default) means no tab or no access. */
  activeTabValue: Readonly<{ id: number; url: string }> | null = null;
  readonly tabMessages: { tabId: number; payload: unknown }[] = [];
  readonly tabResponses: unknown[] = [];

  activeTab(): Promise<Readonly<{ id: number; url: string }> | null> {
    return Promise.resolve(this.activeTabValue);
  }

  sendToTab(tabId: number, payload: unknown): Promise<unknown> {
    this.tabMessages.push({ tabId, payload });
    return Promise.resolve(this.tabResponses.shift());
  }

  queueSendResponse(response: unknown): void {
    this.sendResponses.push(response);
  }
  triggerAutoLock(): void {
    this.autoLockHandler?.();
  }
  triggerEnteSyncAlarm(): void {
    this.enteSyncHandler?.();
  }
  triggerIdle(state: "active" | "idle" | "locked"): void {
    this.idleHandler?.(state);
  }
  triggerStorageChange(changes: Readonly<Record<string, unknown>>): void {
    this.storageHandler?.(changes);
  }
  connectBackgroundPort(senderMetadata: unknown, send: (state: unknown) => void): () => void {
    if (this.portHandler === null) throw new Error("No vault state port listener is installed.");
    return this.portHandler(senderMetadata, send);
  }

  async dispatchMessage(payload: unknown, senderMetadata: unknown): Promise<unknown> {
    const listener = this.listeners.values().next().value;
    if (listener === undefined) {
      throw new Error("No extension message listener is installed.");
    }
    return listener(payload, senderMetadata);
  }
}
