import type { VaultLockSettings, VaultRequest, VaultResponse } from "@shardpass/messaging";

import type { SenderBinding, SessionService } from "./session-service";

type Settings = Readonly<{
  load(): Promise<VaultLockSettings>;
  applyMigrated(settings: VaultLockSettings): Promise<VaultLockSettings>;
  notePrivilegedActivity(): Promise<void>;
  cancelAutoLock(): Promise<void>;
}>;

export class VaultService {
  constructor(
    private readonly sessions: SessionService,
    private readonly settings: Settings,
  ) {}

  async getStateSnapshot() {
    const [state, settings] = await Promise.all([this.sessions.getState(), this.settings.load()]);
    return { version: 1 as const, kind: "vault.state" as const, ...state, ...settings };
  }

  async handle(request: VaultRequest, sender: SenderBinding): Promise<VaultResponse> {
    switch (request.kind) {
      case "vault.getState":
        throw new Error("vault.getState requires the state publisher");
      case "vault.getKdfChallenge": {
        const challenge = await this.sessions.createChallenge(request.purpose, sender);
        return { version: 1, kind: "vault.kdfChallenge", ...challenge };
      }
      case "vault.setup": {
        const outcome = await this.sessions.setup(
          request.challengeId,
          decodeKey(request.keyEncryptionKey),
          sender,
          await this.settings.load(),
        );
        if (outcome.state === "unlocked") {
          try {
            await this.reconcileSettings();
          } catch {
            await this.sessions.lock();
            await this.settings.cancelAutoLock().catch(() => undefined);
            return { version: 1, kind: "vault.ok", committed: true, state: "locked" };
          }
        } else await this.settings.cancelAutoLock();
        return { version: 1, kind: "vault.ok", ...outcome };
      }
      case "vault.unlock":
        await this.sessions.unlock(
          request.challengeId,
          decodeKey(request.keyEncryptionKey),
          sender,
        );
        try {
          await this.reconcileSettings();
        } catch {
          await this.sessions.lock();
          await this.settings.cancelAutoLock().catch(() => undefined);
          throw new Error("settings projection failed");
        }
        return { version: 1, kind: "vault.ok", state: "unlocked" };
      case "vault.lock":
        await this.sessions.lock();
        await this.settings.cancelAutoLock();
        return { version: 1, kind: "vault.ok", state: "locked" };
      case "vault.changePassword": {
        const outcome = await this.sessions.changePassword(
          request.currentChallengeId,
          decodeKey(request.currentKeyEncryptionKey),
          request.newChallengeId,
          decodeKey(request.newKeyEncryptionKey),
          sender,
        );
        if (outcome.state === "unlocked") await this.settings.notePrivilegedActivity();
        else await this.settings.cancelAutoLock();
        return { version: 1, kind: "vault.ok", ...outcome };
      }
      case "vault.updateLockSettings": {
        const requested = {
          autoLockMinutes: request.autoLockMinutes,
          lockOnScreenLock: request.lockOnScreenLock,
        };
        const outcome = await this.sessions.updateLockSettings(requested);
        try {
          await this.settings.applyMigrated(requested);
          await this.settings.notePrivilegedActivity();
        } catch {
          // Authenticated metadata is committed; runtime projection reconciles on a later boundary.
        }
        return { version: 1, kind: "vault.ok", ...outcome };
      }
    }
  }

  private async reconcileSettings(): Promise<void> {
    const authority = await this.sessions.captureBackupSession();
    const snapshot = await this.sessions.readPortableBackupSnapshot(authority, () =>
      this.settings.load(),
    );
    await this.settings.applyMigrated(snapshot.settings);
    await this.settings.notePrivilegedActivity();
  }
}

function decodeKey(value: string): Uint8Array {
  const decoded = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  if (decoded.byteLength !== 32) throw new RangeError("Invalid key length.");
  return decoded;
}
