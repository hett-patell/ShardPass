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
  private epoch = 0;

  constructor(
    private readonly port: EnteAlarmPort,
    private readonly coordinator: EnteSyncCoordinator,
  ) {}

  async setConnected(connected: boolean): Promise<void> {
    const becameAuthorized = connected && !this.connected && this.unlocked;
    this.connected = connected;
    await this.reconcile();
    if (becameAuthorized)
      try {
        await this.coordinator.trigger("connected");
      } catch (error) {
        await this.failed();
        throw error;
      }
  }

  async setUnlocked(unlocked: boolean): Promise<void> {
    const becameAuthorized = unlocked && !this.unlocked && this.connected;
    this.unlocked = unlocked;
    if (!unlocked) this.coordinator.lock();
    await this.reconcile();
    if (becameAuthorized)
      try {
        await this.coordinator.trigger("unlock");
      } catch (error) {
        await this.failed();
        throw error;
      }
  }

  async failed(): Promise<void> {
    this.coordinator.cancel();
    await this.disarm();
  }

  alarmHandler(): () => void {
    const issuedEpoch = this.epoch;
    return () => {
      if (!this.armed || issuedEpoch !== this.epoch || !this.connected || !this.unlocked) return;
      void this.coordinator.trigger("alarm").catch(() => undefined);
    };
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
        this.epoch += 1;
        this.armed = true;
        await this.port.scheduleEnteSync(ENTE_SYNC_LIMITS.schedulerMinutes);
      }
    } else await this.disarm();
  }

  private async disarm(): Promise<void> {
    this.epoch += 1;
    if (!this.armed) return;
    this.armed = false;
    await this.port.scheduleEnteSync(null);
  }
}
