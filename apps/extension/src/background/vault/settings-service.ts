import type { VaultLockSettings } from "@shardpass/messaging";
import type { StoragePort } from "@shardpass/storage";

const SETTINGS_KEY = "shardpass:v1:lock-settings";
const DEFAULT_SETTINGS: VaultLockSettings = {
  autoLockMinutes: 15,
  lockOnScreenLock: true,
};

export interface LockPlatform {
  scheduleAutoLock(minutes: number | null): Promise<void>;
  onUserActivity(handler: () => void): () => void;
  onIdleStateChanged(handler: (state: "active" | "idle" | "locked") => void): () => void;
}

export class SettingsService {
  private settings: VaultLockSettings = DEFAULT_SETTINGS;
  private disposeStarted: (() => void) | null = null;
  private startPromise: Promise<() => void> | null = null;

  constructor(
    private readonly storage: StoragePort,
    private readonly platform: LockPlatform,
    private readonly lock: () => Promise<void>,
  ) {}

  async load(): Promise<VaultLockSettings> {
    const candidate = (await this.storage.get([SETTINGS_KEY]))[SETTINGS_KEY];
    this.settings = isSettings(candidate) ? candidate : DEFAULT_SETTINGS;
    return this.settings;
  }

  snapshot(): VaultLockSettings {
    return { ...this.settings };
  }

  async update(settings: VaultLockSettings): Promise<VaultLockSettings> {
    if (!isSettings(settings)) throw new RangeError("Invalid lock settings.");
    await this.storage.set({ [SETTINGS_KEY]: settings });
    this.settings = settings;
    return settings;
  }

  async applyMigrated(settings: VaultLockSettings): Promise<VaultLockSettings> {
    if (!isSettings(settings)) throw new RangeError("Invalid lock settings.");
    if (
      this.settings.autoLockMinutes !== settings.autoLockMinutes ||
      this.settings.lockOnScreenLock !== settings.lockOnScreenLock
    ) {
      await this.storage.set({ [SETTINGS_KEY]: settings });
      this.settings = settings;
    }
    await this.resetAlarm();
    return this.settings;
  }

  start(): Promise<() => void> {
    if (this.startPromise !== null) return this.startPromise;
    this.startPromise = (async () => {
      await this.load();
      await this.cancelAutoLock();
      const disposers = [
        this.platform.onUserActivity(() => void this.resetAlarm()),
        this.platform.onIdleStateChanged((state) => {
          if (state === "locked" && this.settings.lockOnScreenLock) void this.lock();
        }),
      ];
      let disposed = false;
      this.disposeStarted = () => {
        if (disposed) return;
        disposed = true;
        for (const dispose of disposers) dispose();
      };
      return this.disposeStarted;
    })();
    return this.startPromise;
  }

  dispose(): void {
    this.disposeStarted?.();
  }

  notePrivilegedActivity(): Promise<void> {
    return this.resetAlarm();
  }

  cancelAutoLock(): Promise<void> {
    return this.platform.scheduleAutoLock(null);
  }

  private resetAlarm(): Promise<void> {
    return this.platform.scheduleAutoLock(
      this.settings.autoLockMinutes === 0 ? null : this.settings.autoLockMinutes,
    );
  }
}

function isSettings(value: unknown): value is VaultLockSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { autoLockMinutes?: unknown; lockOnScreenLock?: unknown };
  return (
    Number.isSafeInteger(candidate.autoLockMinutes) &&
    (candidate.autoLockMinutes as number) >= 0 &&
    (candidate.autoLockMinutes as number) <= 1_440 &&
    typeof candidate.lockOnScreenLock === "boolean" &&
    Object.keys(value).length === 2
  );
}
