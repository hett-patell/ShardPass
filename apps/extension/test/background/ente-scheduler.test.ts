import { describe, expect, it, vi } from "vitest";

import type { EnteSyncCoordinator } from "../../src/background/ente/coordinator";
import { EnteSyncScheduler } from "../../src/background/ente/scheduler";

function fixture() {
  const scheduleEnteSync = vi.fn(() => Promise.resolve());
  const trigger = vi.fn(() => Promise.resolve());
  const cancel = vi.fn();
  const lock = vi.fn();
  const dispose = vi.fn();
  const coordinator = { trigger, cancel, lock, dispose } as unknown as EnteSyncCoordinator;
  return {
    scheduleEnteSync,
    trigger,
    cancel,
    lock,
    coordinator,
    scheduler: new EnteSyncScheduler({ scheduleEnteSync }, coordinator),
  };
}

describe("Ente connected and unlocked scheduler", () => {
  it("arms one exact 15-minute alarm and runs first sync only after both conditions", async () => {
    const f = fixture();
    await f.scheduler.setConnected(true);
    expect(f.scheduleEnteSync).not.toHaveBeenCalled();
    await f.scheduler.setUnlocked(true);
    expect(f.scheduleEnteSync).toHaveBeenCalledTimes(1);
    expect(f.scheduleEnteSync).toHaveBeenCalledWith(15);
    expect(f.trigger).toHaveBeenCalledWith("unlock");
    await f.scheduler.setUnlocked(true);
    await f.scheduler.setConnected(true);
    expect(f.scheduleEnteSync).toHaveBeenCalledTimes(1);
  });

  it("cancels on lock/disconnect/error and ignores stale alarm callbacks", async () => {
    const f = fixture();
    await f.scheduler.setUnlocked(true);
    await f.scheduler.setConnected(true);
    const stale = f.scheduler.alarmHandler();
    await f.scheduler.setUnlocked(false);
    stale();
    expect(f.lock).toHaveBeenCalledOnce();
    expect(f.scheduleEnteSync).toHaveBeenLastCalledWith(null);
    expect(f.trigger).toHaveBeenCalledTimes(1);

    await f.scheduler.setUnlocked(true);
    const current = f.scheduler.alarmHandler();
    current();
    expect(f.trigger).toHaveBeenLastCalledWith("alarm");
    await f.scheduler.failed();
    current();
    expect(f.cancel).toHaveBeenCalled();
    expect(f.trigger).toHaveBeenCalledTimes(3);
  });

  it("disarms automatically when the first sync fails", async () => {
    const f = fixture();
    f.trigger.mockRejectedValueOnce(new Error("sync failed"));
    await f.scheduler.setUnlocked(true);
    await expect(f.scheduler.setConnected(true)).rejects.toThrow("sync failed");
    expect(f.scheduleEnteSync).toHaveBeenNthCalledWith(1, 15);
    expect(f.scheduleEnteSync).toHaveBeenNthCalledWith(2, null);
    expect(f.cancel).toHaveBeenCalledOnce();
  });

  it("does not extend the alarm after failed authentication or sync", async () => {
    const f = fixture();
    await f.scheduler.setUnlocked(true);
    await f.scheduler.setConnected(true);
    f.scheduleEnteSync.mockClear();
    await f.scheduler.failed();
    expect(f.scheduleEnteSync).toHaveBeenCalledOnce();
    expect(f.scheduleEnteSync).toHaveBeenCalledWith(null);
  });
});
