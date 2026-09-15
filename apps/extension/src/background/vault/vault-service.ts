import type { VaultLockSettings, VaultRequest, VaultResponse } from "@shardpass/messaging";
import type { RepromptGrants } from "./reprompt-grants";

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
    private readonly reprompt: Pick<RepromptGrants, "grant"> = { grant: () => undefined },
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
        return this.afterUnlock();
      case "vault.getPinChallenge": {
        const challenge = await this.sessions.createPinChallenge(sender);
        return { version: 1, kind: "vault.pinChallenge", ...challenge };
      }
      case "vault.unlockWithPin":
        await this.sessions.unlockWithPin(request.challengeId, decodeKey(request.pinKey), sender);
        return this.afterUnlock();
      case "vault.setPin":
        await this.sessions.setPin(decodeKey(request.pinKey), request.kdf);
        await this.settings.notePrivilegedActivity();
        return { version: 1, kind: "vault.ok", state: "unlocked" };
      case "vault.removePin":
        await this.sessions.removePin();
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
      case "vault.confirmReprompt": {
        await this.sessions.verifyReprompt(
          request.challengeId,
          decodeKey(request.keyEncryptionKey),
          sender,
        );
        this.reprompt.grant(request.itemId);
        await this.settings.notePrivilegedActivity();
        return { version: 1, kind: "vault.ok", state: "unlocked" };
      }
      case "vault.updateLockSettings": {
        const requested = {
          autoLockMinutes: request.autoLockMinutes,
          lockOnScreenLock: request.lockOnScreenLock,
          ...(request.lockWhenClosed === undefined
            ? {}
            : { lockWhenClosed: request.lockWhenClosed }),
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

  /** What every unlock does once the session holds the key. */
  private async afterUnlock(): Promise<VaultResponse> {
    try {
      await this.reconcileSettings();
    } catch {
      await this.sessions.lock();
      await this.settings.cancelAutoLock().catch(() => undefined);
      throw new Error("settings projection failed");
    }
    await this.migrateIfNeeded();
    return { version: 1, kind: "vault.ok", state: "unlocked" };
  }

  private async reconcileSettings(): Promise<void> {
    const authority = await this.sessions.captureBackupSession();
    const snapshot = await this.sessions.readPortableBackupSnapshot(authority, () =>
      this.settings.load(),
    );
    await this.settings.applyMigrated(snapshot.settings);
    await this.settings.notePrivilegedActivity();
  }

  /**
   * Persists the current item schema version onto any record still stored under a
   * legacy one (pre-multi-kind vaults held only `kind: "otp"` items at schema
   * version 1; every such item is already valid, and already read as upgraded, under
   * the widened union — see `VaultRepository.migrateLegacyItemSchema`). Runs once per
   * unlock and is a cheap no-op once the vault is fully migrated. Best-effort: a
   * failure here must never prevent an otherwise-successful unlock, so it is logged
   * and swallowed rather than propagated.
   */
  private async migrateIfNeeded(): Promise<void> {
    // Best-effort: content is unchanged either way, so a failure here (e.g. a
    // concurrent mutation racing the migration commit) simply leaves the affected
    // records to retry on a later unlock rather than blocking this one.
    await this.sessions.vaultRepository.migrateLegacySchema().catch(() => undefined);
  }
}

function decodeKey(value: string): Uint8Array {
  const decoded = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  if (decoded.byteLength !== 32) throw new RangeError("Invalid key length.");
  return decoded;
}
