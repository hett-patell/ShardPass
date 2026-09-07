import type { EnteRequest, EnteSafeState, SenderContext } from "@shardpass/messaging";
import { ENTE_SYNC_LIMITS, EnteProtocolError } from "./protocol";
import type { EnteSyncCoordinator } from "./coordinator";
import type { EntePersistedStatus } from "./runtime";

/** Restart-triggered cycles back off after failures: 1, 2, 4 ... up to 60 minutes. */
const MAX_BACKOFF_MINUTES = 60;

export class EnteService {
  private failures = 0;
  private lastFailure: NonNullable<EnteSafeState["lastFailure"]> | undefined;
  private state: EnteSafeState = {
    version: 1,
    kind: "ente.state",
    state: "disconnected",
    connected: false,
    pendingCount: 0,
    conflictCount: 0,
    lastSuccessAt: null,
  };
  constructor(
    private readonly coordinator: EnteSyncCoordinator,
    private readonly resolveConflict?: (
      capability: string,
      choice: "keep-local" | "keep-ente" | "keep-both",
      sender: SenderContext,
    ) => Promise<void>,
    private readonly conflictPreview?: (
      sender: SenderContext,
    ) => Promise<Readonly<NonNullable<EnteSafeState["conflicts"]>>>,
    private readonly setConnected?: (connected: boolean) => Promise<void>,
    private readonly issueSessionHandoff?: (
      sender: SenderContext,
    ) => Promise<Readonly<{ capability: string; publicKey: Uint8Array }>>,
    private readonly activateSession?: (
      capability: string,
      ciphertext: Uint8Array,
      sender: SenderContext,
    ) => Promise<void>,
    private readonly disconnectSession?: () => Promise<void>,
    private readonly readStatus?: () => Promise<EntePersistedStatus | null>,
  ) {}
  snapshot(): EnteSafeState {
    return { ...this.state, ...(this.lastFailure === undefined ? {} : { lastFailure: this.lastFailure }) };
  }

  /** A background cycle failed: the panel gets the code and detail, and restarts back off. */
  noteFailure(error: unknown, now: number): void {
    const candidate = error as { code?: unknown; detail?: unknown } | null;
    const code = typeof candidate?.code === "string" ? candidate.code.slice(0, 64) : "ENTE_UNAVAILABLE";
    const detail = typeof candidate?.detail === "string" ? candidate.detail.slice(0, 200) : undefined;
    this.failures += 1;
    this.lastFailure = { code, ...(detail === undefined ? {} : { detail }), at: now };
  }

  noteSuccess(): void {
    this.failures = 0;
    this.lastFailure = undefined;
  }

  /**
   * Whether a worker restart should run a cycle now. Not when the last attempt is younger
   * than the schedule (browsing wakes the worker on most page loads), and not inside the
   * backoff after a failure.
   */
  async shouldRunOnRestart(now: number): Promise<boolean> {
    const failure = this.lastFailure;
    if (failure !== undefined) {
      const backoffMs = Math.min(MAX_BACKOFF_MINUTES, 2 ** (this.failures - 1)) * 60_000;
      if (now - failure.at < backoffMs) return false;
    }
    const persisted = await this.readStatus?.().catch(() => null);
    const lastAttemptAt = persisted?.lastAttemptAt ?? null;
    if (lastAttemptAt !== null) return now - lastAttemptAt >= ENTE_SYNC_LIMITS.schedulerMinutes * 60_000;
    return true;
  }

  /**
   * Folds the persisted sync state into the in-memory one. The worker that ran the last
   * cycle may be gone; without this the panel showed "Disconnected" and "Not yet" after
   * every service-worker restart, and a person reconnected a vault that was still connected.
   */
  private async refresh(): Promise<void> {
    if (this.readStatus === undefined) return;
    const persisted = await this.readStatus().catch(() => null);
    if (persisted === null) {
      if (this.state.connected) this.state = { ...this.state, connected: false, state: "disconnected" };
      return;
    }
    const transient = this.state.state === "connecting" || this.state.state === "syncing";
    const state: EnteSafeState["state"] = !persisted.connected
      ? "disconnected"
      : persisted.needsReauth
        ? "reauth-required"
        : persisted.uncertain
          ? "uncertain"
          : persisted.conflictCount > 0
            ? "conflict"
            : transient
              ? this.state.state
              : "idle";
    this.state = {
      ...this.state,
      state,
      connected: persisted.connected,
      pendingCount: Math.min(persisted.pendingCount, 10_000),
      conflictCount: Math.min(persisted.conflictCount, 10_000),
      uncertainCount: persisted.uncertain ? 1 : 0,
      lastSuccessAt: persisted.lastSuccessAt,
      nextEligibleAt:
        persisted.connected && persisted.lastAttemptAt !== null
          ? persisted.lastAttemptAt + ENTE_SYNC_LIMITS.schedulerMinutes * 60_000
          : null,
    };
  }
  async handle(request: EnteRequest, sender: SenderContext): Promise<EnteSafeState> {
    if (sender.contextKind === "popup" && request.kind !== "ente.status")
      throw new EnteProtocolError("ENTE_PERMISSION_DENIED");
    switch (request.kind) {
      case "ente.status": {
        await this.refresh();
        if (!this.state.connected || this.conflictPreview === undefined) return this.snapshot();
        const conflicts = [...(await this.conflictPreview(sender))];
        this.state = {
          ...this.state,
          state: conflicts.length > 0 ? "conflict" : this.state.state,
          conflictCount: conflicts.length,
        };
        return { ...this.snapshot(), conflicts };
      }
      case "ente.authChallenge": {
        if (this.issueSessionHandoff === undefined) throw new EnteProtocolError("ENTE_UNAVAILABLE");
        const challenge = await this.issueSessionHandoff(sender);
        return {
          ...this.snapshot(),
          capability: challenge.capability,
          authHandoffPublicKey: [...challenge.publicKey],
        };
      }
      case "ente.manualSync": {
        await this.coordinator.trigger("manual");
        await this.refresh();
        if (this.conflictPreview === undefined) return this.snapshot();
        const conflicts = [...(await this.conflictPreview(sender))];
        this.state = {
          ...this.state,
          state: conflicts.length > 0 ? "conflict" : "idle",
          conflictCount: conflicts.length,
        };
        return { ...this.snapshot(), conflicts };
      }
      case "ente.cancel":
        this.coordinator.cancel();
        return this.snapshot();
      case "ente.connect":
        if (this.activateSession === undefined) throw new EnteProtocolError("ENTE_AUTH_FAILED");
        this.state = { ...this.state, state: "connecting" };
        await this.activateSession(request.capability, Uint8Array.from(request.ciphertext), sender);
        await this.setConnected?.(true);
        this.state = { ...this.state, connected: true };
        try {
          await this.coordinator.trigger("connected");
        } catch (error) {
          this.state = { ...this.state, connected: false };
          await this.setConnected?.(false).catch(() => undefined);
          throw error;
        }
        this.state = { ...this.state, state: "idle", connected: true };
        await this.refresh();
        return this.snapshot();
      case "ente.submitTotp2fa":
        this.state = { ...this.state, state: "syncing" };
        return this.snapshot();
      case "ente.resolveConflict": {
        if (this.resolveConflict === undefined) throw new EnteProtocolError("ENTE_UNAVAILABLE");
        await this.resolveConflict(request.capability, request.choice, sender);
        if (this.conflictPreview === undefined) return this.snapshot();
        const conflicts = [...(await this.conflictPreview(sender))];
        this.state = {
          ...this.state,
          state: conflicts.length > 0 ? "conflict" : "idle",
          conflictCount: conflicts.length,
        };
        return { ...this.snapshot(), conflicts };
      }
      case "ente.reauthenticate":
        this.state = { ...this.state, state: "connecting" };
        return this.snapshot();
      case "ente.disconnectPreview":
        return this.snapshot();
      case "ente.disconnectConfirm":
        this.coordinator.cancel();
        if (this.disconnectSession !== undefined) await this.disconnectSession();
        else await this.setConnected?.(false);
        this.state = {
          version: 1,
          kind: "ente.state",
          state: "disconnected",
          connected: false,
          pendingCount: 0,
          conflictCount: 0,
          lastSuccessAt: null,
        };
        return this.snapshot();
    }
  }
  lock(): void {
    this.coordinator.lock();
  }
  dispose(): void {
    this.coordinator.dispose();
  }
}
