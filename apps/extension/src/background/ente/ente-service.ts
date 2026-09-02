import type { EnteRequest, EnteSafeState, SenderContext } from "@shardpass/messaging";
import { EnteProtocolError } from "./protocol";
import type { EnteSyncCoordinator } from "./coordinator";

export class EnteService {
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
  ) {}
  snapshot(): EnteSafeState {
    return { ...this.state };
  }
  async handle(request: EnteRequest, sender: SenderContext): Promise<EnteSafeState> {
    if (sender.contextKind === "popup" && request.kind !== "ente.status")
      throw new EnteProtocolError("ENTE_PERMISSION_DENIED");
    switch (request.kind) {
      case "ente.status": {
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
