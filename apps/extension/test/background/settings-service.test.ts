import { FakeStoragePort } from "@shardpass/testing/fake-storage-port";
import { describe, expect, it } from "vitest";

import { SettingsService } from "../../src/background/vault/settings-service";

class FakeLockPlatform {
  alarm: number | null = null;
  pending = false;
  autoLockPending() {
    return Promise.resolve(this.pending);
  }
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

  describe("resumeCountdown", () => {
    it("keeps an alarm Chrome still holds, without starting the countdown over", async () => {
      const platform = new FakeLockPlatform();
      platform.pending = true;
      const service = new SettingsService(new FakeStoragePort(), platform, () => Promise.resolve(), { activityStore: new FakeStoragePort() });
      await service.load();
      await expect(service.resumeCountdown()).resolves.toBe("kept");
      expect(platform.alarm).toBeNull();
    });

    it("re-arms with the time left since the last real activity, and reports an expired countdown", async () => {
      let now = 10 * 60_000;
      const platform = new FakeLockPlatform();
      const activity = new FakeStoragePort();
      const service = new SettingsService(new FakeStoragePort(), platform, () => Promise.resolve(), { activityStore: activity, now: () => now });
      await service.load();
      await service.notePrivilegedActivity();
      expect(platform.alarm).toBe(15);

      platform.alarm = null;
      now += 9 * 60_000;
      await expect(service.resumeCountdown()).resolves.toBe("kept");
      expect(platform.alarm).toBe(6);

      platform.alarm = null;
      now += 7 * 60_000;
      await expect(service.resumeCountdown()).resolves.toBe("expired");
      expect(platform.alarm).toBeNull();
    });

    it("starts one full period when nothing was recorded, and cancels when auto-lock is off", async () => {
      const platform = new FakeLockPlatform();
      const storage = new FakeStoragePort();
      const service = new SettingsService(storage, platform, () => Promise.resolve(), { activityStore: new FakeStoragePort() });
      await service.load();
      await expect(service.resumeCountdown()).resolves.toBe("kept");
      expect(platform.alarm).toBe(15);
      await service.update({ autoLockMinutes: 0, lockOnScreenLock: true });
      await expect(service.resumeCountdown()).resolves.toBe("kept");
      expect(platform.alarm).toBeNull();
    });
  });

  it("decides a screen lock from the stored settings even when the event wakes the worker", async () => {
    const storage = new FakeStoragePort();
    await storage.set({ "shardpass:v1:lock-settings": { autoLockMinutes: 15, lockOnScreenLock: false } });
    const platform = new FakeLockPlatform();
    let locks = 0;
    const service = new SettingsService(storage, platform, () => {
      locks += 1;
      return Promise.resolve();
    });
    // listen() runs before load(), as in the worker's first turn.
    service.listen();
    platform.idleHandler?.("locked");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(locks).toBe(0);
  });
});
