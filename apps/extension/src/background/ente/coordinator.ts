import { ENTE_SYNC_LIMITS } from "./protocol";

export type EnteSyncTrigger = "connected" | "restart" | "unlock" | "manual" | "alarm";

export class EnteSyncCoordinator {
  private controller: AbortController | null = null;
  private running = false;
  private followup = false;
  private disposed = false;
  constructor(
    private readonly cycle: (trigger: EnteSyncTrigger, signal: AbortSignal) => Promise<void>,
    private readonly isAuthorized: () => boolean,
  ) {}
  async trigger(trigger: EnteSyncTrigger): Promise<void> {
    if (this.disposed || !this.isAuthorized()) return;
    if (this.running) {
      this.followup = true;
      return;
    }
    this.running = true;
    try {
      let next = trigger;
      do {
        this.followup = false;
        this.controller = new AbortController();
        const timeout = setTimeout(() => this.controller?.abort(), ENTE_SYNC_LIMITS.cycleTimeoutMs);
        try {
          await this.cycle(next, this.controller.signal);
        } finally {
          clearTimeout(timeout);
        }
        next = "manual";
      } while (this.followup && !this.disposed && this.isAuthorized());
    } finally {
      this.controller = null;
      this.running = false;
    }
  }
  /** Whether a cycle is in flight right now (a trigger during one only queues a follow-up). */
  isRunning(): boolean {
    return this.running;
  }
  cancel(): void {
    this.followup = false;
    this.controller?.abort();
  }
  lock(): void {
    this.cancel();
  }
  dispose(): void {
    this.disposed = true;
    this.cancel();
  }
}
