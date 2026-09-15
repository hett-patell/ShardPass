import type { StoragePort, StorageValue } from "@shardpass/storage";
import { describe, expect, it, vi } from "vitest";

import { SettingsService } from "../../src/background/vault/settings-service";

function memoryStorage(
  initial: Record<string, StorageValue> = {},
): StoragePort & { values: Record<string, StorageValue> } {
  const values: Record<string, StorageValue> = { ...initial };
  return {
    values,
    get: (keys) =>
      Promise.resolve(
        Object.fromEntries(
          keys.filter((key) => key in values).map((key) => [key, values[key] as StorageValue]),
        ),
      ),
    set: (next) => {
      Object.assign(values, next);
      return Promise.resolve();
    },
    remove: (keys) => {
      for (const key of keys) delete values[key];
      return Promise.resolve();
    },
    listKeys: () => Promise.resolve({ keys: [], complete: true }),
  };
}

const platform = {
  scheduleAutoLock: vi.fn(() => Promise.resolve()),
  onUserActivity: () => () => undefined,
  onIdleStateChanged: () => () => undefined,
};

describe("lock when ShardPass closes", () => {
  it("is stored beside the timer settings, absent when not chosen, and read back", async () => {
    const storage = memoryStorage();
    const service = new SettingsService(storage, platform, () => Promise.resolve());
    await service.update({ autoLockMinutes: 15, lockOnScreenLock: true, lockWhenClosed: true });
    expect(storage.values["shardpass:v1:lock-settings"]).toEqual({
      autoLockMinutes: 15,
      lockOnScreenLock: true,
      lockWhenClosed: true,
    });
    await service.update({ autoLockMinutes: 15, lockOnScreenLock: true });
    expect(storage.values["shardpass:v1:lock-settings"]).toEqual({
      autoLockMinutes: 15,
      lockOnScreenLock: true,
    });

    const reloaded = new SettingsService(
      memoryStorage({
        "shardpass:v1:lock-settings": {
          autoLockMinutes: 0,
          lockOnScreenLock: false,
          lockWhenClosed: true,
        },
      }),
      platform,
      () => Promise.resolve(),
    );
    expect(await reloaded.load()).toEqual({
      autoLockMinutes: 0,
      lockOnScreenLock: false,
      lockWhenClosed: true,
    });
  });

  it("refuses a record with an unknown key or a non-boolean value", async () => {
    const service = new SettingsService(memoryStorage(), platform, () => Promise.resolve());
    await expect(
      service.update({
        autoLockMinutes: 15,
        lockOnScreenLock: true,
        lockWhenClosed: "yes" as unknown as boolean,
      }),
    ).rejects.toThrow();
    const stray = new SettingsService(
      memoryStorage({
        "shardpass:v1:lock-settings": { autoLockMinutes: 15, lockOnScreenLock: true, other: 1 },
      }),
      platform,
      () => Promise.resolve(),
    );
    expect(await stray.load()).toEqual({ autoLockMinutes: 15, lockOnScreenLock: true });
  });
});
