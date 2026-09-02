import { FakeStoragePort } from "@shardpass/testing/fake-storage-port";
import { describe, expect, it } from "vitest";

import { SettingsService } from "../../src/background/vault/settings-service";

class FakeLockPlatform {
  alarm: number | null = null;
  activityHandler: (() => void) | null = null;
  idleHandler: ((state: "active" | "idle" | "locked") => void) | null = null;
  scheduleAutoLock(minutes: number | null) {
    this.alarm = minutes;
    return Promise.resolve();
  }
  onUserActivity(handler: () => void) {
    this.activityHandler = handler;
    return () => undefined;
  }
  onIdleStateChanged(handler: (state: "active" | "idle" | "locked") => void) {
    this.idleHandler = handler;
    return () => undefined;
  }
}

describe("SettingsService", () => {
  it("defaults to 15 minutes and screen lock, persists valid settings, and schedules alarm", async () => {
    const storage = new FakeStoragePort();
    const platform = new FakeLockPlatform();
    const lock = () => Promise.resolve();
    const service = new SettingsService(storage, platform, lock);
    await expect(service.load()).resolves.toEqual({ autoLockMinutes: 15, lockOnScreenLock: true });
    await expect(service.update({ autoLockMinutes: 30, lockOnScreenLock: false })).resolves.toEqual(
      { autoLockMinutes: 30, lockOnScreenLock: false },
    );
    expect(platform.alarm).toBeNull();
    await service.notePrivilegedActivity();
    expect(platform.alarm).toBe(30);
    const restarted = new SettingsService(storage, platform, lock);
    await expect(restarted.load()).resolves.toEqual({
      autoLockMinutes: 30,
      lockOnScreenLock: false,
    });
  });

  it("applies exact migrated whole-minute settings idempotently and schedules fixture value 7", async () => {
    const storage = new FakeStoragePort();
    const platform = new FakeLockPlatform();
    const service = new SettingsService(storage, platform, () => Promise.resolve());
    await service.start();
    await expect(
      service.applyMigrated({ autoLockMinutes: 7, lockOnScreenLock: false }),
    ).resolves.toEqual({ autoLockMinutes: 7, lockOnScreenLock: false });
    expect(platform.alarm).toBe(7);
    const writes = storage.writeCount;
    await service.applyMigrated({ autoLockMinutes: 7, lockOnScreenLock: false });
    expect(storage.writeCount).toBe(writes);
    for (const autoLockMinutes of [-1, 7.5, 1441, Number.NaN])
      await expect(
        service.applyMigrated({ autoLockMinutes, lockOnScreenLock: false }),
      ).rejects.toBeInstanceOf(RangeError);
  });

  it("locks on configured screen lock and resets activity alarm only for privileged activity", async () => {
    const storage = new FakeStoragePort();
    const platform = new FakeLockPlatform();
    let locks = 0;
    const service = new SettingsService(storage, platform, () => {
      locks += 1;
      return Promise.resolve();
    });
    await service.start();
    platform.activityHandler?.();
    expect(platform.alarm).toBe(15);
    platform.idleHandler?.("locked");
    await Promise.resolve();
    expect(locks).toBe(1);
  });
});
