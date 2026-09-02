import type { VaultStateResponse } from "@shardpass/messaging";

export type StateSnapshotInput = Omit<VaultStateResponse, "streamId" | "sequence">;
export type StateUnavailableEvent = Readonly<{
  version: 1;
  kind: "vault.stateUnavailable";
  streamId: string;
  sequence: number;
}>;
export type VaultStateEvent = VaultStateResponse | StateUnavailableEvent;

type Subscriber = (event: VaultStateEvent) => void;
type Timer = ReturnType<typeof setTimeout>;

const RETRY_DELAYS_MS = [100, 250, 500, 1_000, 2_000] as const;

export class StatePublisher {
  private readonly subscribers = new Map<number, Subscriber>();
  private readonly waiters = new Set<{
    resolve(snapshot: VaultStateResponse): void;
    reject(error: unknown): void;
  }>();
  private latest: VaultStateEvent | null = null;
  private dirty = false;
  private disposed = false;
  private reading = false;
  private retryAttempt = 0;
  private retryTimer: Timer | null = null;
  private nextSubscriberId = 0;
  private sequence = 0;

  constructor(
    private readonly streamId: string,
    private readonly readState: () => Promise<StateSnapshotInput>,
    private readonly schedule: (handler: () => void, delayMs: number) => Timer = setTimeout,
    private readonly cancel: (timer: Timer) => void = clearTimeout,
  ) {}

  subscribe(send: Subscriber): () => void {
    if (this.disposed) return () => undefined;
    const id = ++this.nextSubscriberId;
    this.subscribers.set(id, send);
    if (!this.dirty && !this.reading && this.retryTimer === null && this.latest !== null)
      this.deliver(id, send, this.latest);
    else {
      this.dirty = true;
      this.pump();
    }
    return () => this.subscribers.delete(id);
  }

  publish(): void {
    if (this.disposed) return;
    this.dirty = true;
    this.retryAttempt = 0;
    if (this.retryTimer !== null) {
      this.cancel(this.retryTimer);
      this.retryTimer = null;
    }
    this.pump();
  }

  snapshot(): Promise<VaultStateResponse> {
    if (this.disposed) return Promise.reject(new Error("publisher disposed"));
    if (this.latest?.kind === "vault.state" && !this.dirty && !this.reading)
      return Promise.resolve(this.latest);
    return new Promise((resolve, reject) => {
      this.waiters.add({ resolve, reject });
      this.dirty = true;
      this.retryAttempt = 0;
      if (this.retryTimer !== null) {
        this.cancel(this.retryTimer);
        this.retryTimer = null;
      }
      this.pump();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dirty = false;
    if (this.retryTimer !== null) this.cancel(this.retryTimer);
    this.retryTimer = null;
    this.subscribers.clear();
    for (const waiter of this.waiters) waiter.reject(new Error("publisher disposed"));
    this.waiters.clear();
  }

  private pump(): void {
    if (this.disposed || this.reading || !this.dirty || this.retryTimer !== null) return;
    if (this.subscribers.size === 0 && this.waiters.size === 0) return;
    this.reading = true;
    this.dirty = false;
    void this.readState().then(
      (input) => {
        this.reading = false;
        if (this.disposed) return;
        this.retryAttempt = 0;
        const snapshot = Object.freeze({
          ...input,
          streamId: this.streamId,
          sequence: ++this.sequence,
        }) satisfies VaultStateResponse;
        this.latest = snapshot;
        for (const [id, send] of [...this.subscribers]) this.deliver(id, send, snapshot);
        for (const waiter of this.waiters) waiter.resolve(snapshot);
        this.waiters.clear();
        this.pump();
      },
      (error: unknown) => {
        this.reading = false;
        if (this.disposed) return;
        this.dirty = true;
        if (
          this.retryAttempt < RETRY_DELAYS_MS.length &&
          (this.subscribers.size > 0 || this.waiters.size > 0)
        ) {
          const delay = RETRY_DELAYS_MS[this.retryAttempt++]!;
          this.retryTimer = this.schedule(() => {
            this.retryTimer = null;
            this.pump();
          }, delay);
          return;
        }
        const unavailable = Object.freeze({
          version: 1 as const,
          kind: "vault.stateUnavailable" as const,
          streamId: this.streamId,
          sequence: ++this.sequence,
        });
        this.latest = unavailable;
        for (const [id, send] of [...this.subscribers]) this.deliver(id, send, unavailable);
        for (const waiter of this.waiters) waiter.reject(error);
        this.waiters.clear();
        this.dirty = false;
      },
    );
  }

  private deliver(id: number, send: Subscriber, event: VaultStateEvent): void {
    try {
      send(event);
    } catch {
      this.subscribers.delete(id);
    }
  }
}
