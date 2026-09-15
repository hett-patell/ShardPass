import type { VaultLockSettings } from "@shardpass/messaging";
import type { StoragePort } from "@shardpass/storage";

const SETTINGS_KEY = "shardpass:v1:lock-settings";
/** When the vault was last used on purpose; session-scoped, so it dies with the browser. */
const ACTIVITY_KEY = "shardpass:v1:last-activity";
const DEFAULT_SETTINGS: VaultLockSettings = {
  autoLockMinutes: 15,
  lockOnScreenLock: true,
};

export interface LockPlatform {
  scheduleAutoLock(minutes: number | null): Promise<void>;
  /** Whether the auto-lock alarm is still armed from an earlier worker instance. */
  autoLockPending?(): Promise<boolean>;
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
    private readonly options: Readonly<{ activityStore?: StoragePort; now?: () => number }> = {},
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
    await this.storage.set({ [SETTINGS_KEY]: storable(settings) });
    this.settings = settings;
    return settings;
  }

  async applyMigrated(settings: VaultLockSettings): Promise<VaultLockSettings> {
    if (!isSettings(settings)) throw new RangeError("Invalid lock settings.");
    if (
      this.settings.autoLockMinutes !== settings.autoLockMinutes ||
      this.settings.lockOnScreenLock !== settings.lockOnScreenLock ||
      (this.settings.lockWhenClosed ?? false) !== (settings.lockWhenClosed ?? false)
    ) {
      await this.storage.set({ [SETTINGS_KEY]: storable(settings) });
      this.settings = settings;
    }
    await this.resetAlarm();
    return this.settings;
  }

  /**
   * Registers the activity and idle listeners. Must run synchronously in the worker's first
   * turn: Chrome only wakes a dormant service worker for events whose listeners were
   * registered before the first await, and lock-on-screen-lock depends on the idle event.
   */
  listen(): () => void {
    if (this.disposeStarted !== null) return this.disposeStarted;
    const disposers = [
      this.platform.onUserActivity(() => void this.resetAlarm()),
      this.platform.onIdleStateChanged((state) => {
        if (state !== "locked") return;
        // The event may be what woke the worker: decide from the stored settings, not the
        // defaults that stand in until they are loaded.
        void (this.startPromise ?? this.start()).then(() => {
          if (this.settings.lockOnScreenLock) return this.lock();
          return undefined;
        });
      }),
    ];
    let disposed = false;
    this.disposeStarted = () => {
      if (disposed) return;
      disposed = true;
      for (const dispose of disposers) dispose();
    };
    return this.disposeStarted;
  }

  start(): Promise<() => void> {
    if (this.startPromise !== null) return this.startPromise;
    this.startPromise = (async () => {
      await this.load();
      // The alarm is left as it was: a restored session keeps its countdown, and the
      // caller cancels it when the session did not survive the restart.
      return this.listen();
    })();
    return this.startPromise;
  }

  dispose(): void {
    this.disposeStarted?.();
  }

  async notePrivilegedActivity(): Promise<void> {
    await this.resetAlarm();
    try {
      await this.options.activityStore?.set({ [ACTIVITY_KEY]: this.now() });
    } catch {
      // The alarm still counts down; only the restart bookkeeping is missing.
    }
  }

  /**
   * After a worker restart with a session to reopen: the countdown continues rather than
   * starting over. Chrome keeps the alarm across restarts; when it is gone, the remaining
   * time is computed from the last real activity, and "expired" tells the caller to lock.
   */
  async resumeCountdown(): Promise<"kept" | "expired"> {
    const minutes = this.settings.autoLockMinutes;
    if (minutes === 0) {
      await this.cancelAutoLock();
      return "kept";
    }
    if ((await this.platform.autoLockPending?.().catch(() => false)) === true) return "kept";
    let last: unknown;
    try {
      last = (await this.options.activityStore?.get([ACTIVITY_KEY]))?.[ACTIVITY_KEY];
    } catch {
      last = undefined;
    }
    if (typeof last !== "number" || !Number.isFinite(last)) {
      // Nothing recorded (an older worker, a cleared session): one full period, once.
      await this.notePrivilegedActivity();
      return "kept";
    }
    const remainingMs = minutes * 60_000 - (this.now() - last);
    if (remainingMs <= 0) return "expired";
    await this.platform.scheduleAutoLock(Math.max(1, Math.ceil(remainingMs / 60_000)));
    return "kept";
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
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

/** The record as written: an absent third setting is left out, never stored as undefined. */
function storable(settings: VaultLockSettings): {
  autoLockMinutes: number;
  lockOnScreenLock: boolean;
  lockWhenClosed?: boolean;
} {
  return {
    autoLockMinutes: settings.autoLockMinutes,
    lockOnScreenLock: settings.lockOnScreenLock,
    ...(settings.lockWhenClosed === undefined ? {} : { lockWhenClosed: settings.lockWhenClosed }),
  };
}

function isSettings(value: unknown): value is VaultLockSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as {
    autoLockMinutes?: unknown;
    lockOnScreenLock?: unknown;
    lockWhenClosed?: unknown;
  };
  const keys = Object.keys(value);
  return (
    Number.isSafeInteger(candidate.autoLockMinutes) &&
    (candidate.autoLockMinutes as number) >= 0 &&
    (candidate.autoLockMinutes as number) <= 1_440 &&
    typeof candidate.lockOnScreenLock === "boolean" &&
    (candidate.lockWhenClosed === undefined || typeof candidate.lockWhenClosed === "boolean") &&
    keys.every(
      (key) => key === "autoLockMinutes" || key === "lockOnScreenLock" || key === "lockWhenClosed",
    )
  );
}
