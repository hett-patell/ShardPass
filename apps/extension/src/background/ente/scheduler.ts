import { ENTE_SYNC_LIMITS } from "./protocol";
import type { EnteSyncCoordinator } from "./coordinator";

export interface EnteAlarmPort {
  scheduleEnteSync(minutes: 15 | null): Promise<void>;
}

/** Owns the single connected+unlocked periodic alarm and rejects stale alarm events. */
export class EnteSyncScheduler {
  private connected = false;
  private unlocked = false;
  private armed = false;
  /** Whether a persisted alarm from an earlier worker instance has been cleared. */
  private cleared = false;

  constructor(
    private readonly port: EnteAlarmPort,
    private readonly coordinator: EnteSyncCoordinator,
  ) {}

  /**
   * Arms or disarms the periodic alarm. Running a cycle is the caller's decision (main.ts
   * orchestrates it from the session state), so a transition here never blocks a reply.
   */
  async setConnected(connected: boolean): Promise<void> {
    this.connected = connected;
    await this.reconcile();
  }

  async setUnlocked(unlocked: boolean): Promise<void> {
    this.unlocked = unlocked;
    if (!unlocked) this.coordinator.lock();
    await this.reconcile();
  }

  async failed(): Promise<void> {
    this.coordinator.cancel();
    await this.disarm();
  }

  async dispose(): Promise<void> {
    this.connected = false;
    this.unlocked = false;
    this.coordinator.dispose();
    await this.disarm();
  }

  private async reconcile(): Promise<void> {
    if (this.connected && this.unlocked) {
      if (!this.armed) {
        this.armed = true;
        this.cleared = false;
        await this.port.scheduleEnteSync(ENTE_SYNC_LIMITS.schedulerMinutes);
      }
    } else await this.disarm();
  }

  private async disarm(): Promise<void> {
    // After a worker restart `armed` is false while the persisted alarm may still exist, so
    // the first disarm of an instance always clears; later ones only when armed.
    if (!this.armed && this.cleared) return;
    this.armed = false;
    this.cleared = true;
    await this.port.scheduleEnteSync(null);
  }
}
