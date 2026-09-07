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

describe("Ente periodic alarm scheduler", () => {
  it("clears a stale alarm once on a fresh instance, arms once both conditions hold, never runs a cycle", async () => {
    const f = fixture();
    await f.scheduler.setConnected(true);
    // A previous worker may have left the alarm armed; a fresh instance clears it once.
    expect(f.scheduleEnteSync).toHaveBeenCalledTimes(1);
    expect(f.scheduleEnteSync).toHaveBeenCalledWith(null);
    await f.scheduler.setUnlocked(true);
    expect(f.scheduleEnteSync).toHaveBeenCalledTimes(2);
    expect(f.scheduleEnteSync).toHaveBeenLastCalledWith(15);
    await f.scheduler.setUnlocked(true);
    await f.scheduler.setConnected(true);
    expect(f.scheduleEnteSync).toHaveBeenCalledTimes(2);
    expect(f.trigger).not.toHaveBeenCalled();
  });

  it("disarms on lock, disconnect and failure, and stays quiet while already disarmed", async () => {
    const f = fixture();
    await f.scheduler.setUnlocked(true);
    await f.scheduler.setConnected(true);
    expect(f.scheduleEnteSync).toHaveBeenLastCalledWith(15);
    await f.scheduler.setUnlocked(false);
    expect(f.lock).toHaveBeenCalledOnce();
    expect(f.scheduleEnteSync).toHaveBeenLastCalledWith(null);
    const calls = f.scheduleEnteSync.mock.calls.length;
    await f.scheduler.setConnected(false);
    await f.scheduler.setUnlocked(false);
    expect(f.scheduleEnteSync).toHaveBeenCalledTimes(calls);

    await f.scheduler.setUnlocked(true);
    await f.scheduler.setConnected(true);
    expect(f.scheduleEnteSync).toHaveBeenLastCalledWith(15);
    await f.scheduler.failed();
    expect(f.cancel).toHaveBeenCalledOnce();
    expect(f.scheduleEnteSync).toHaveBeenLastCalledWith(null);
  });

  it("does not extend the alarm after a failure", async () => {
    const f = fixture();
    await f.scheduler.setUnlocked(true);
    await f.scheduler.setConnected(true);
    f.scheduleEnteSync.mockClear();
    await f.scheduler.failed();
    expect(f.scheduleEnteSync).toHaveBeenCalledOnce();
    expect(f.scheduleEnteSync).toHaveBeenCalledWith(null);
  });
});
