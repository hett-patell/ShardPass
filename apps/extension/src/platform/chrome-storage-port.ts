/// <reference types="chrome" />

import type { StorageKeyPage, StoragePort } from "@shardpass/storage";

export function createChromeStoragePort(area: chrome.storage.StorageArea): StoragePort {
  return {
    async get(keys) {
      return await area.get([...keys]);
    },
    async set(values) {
      await area.set(values);
    },
    async remove(keys) {
      await area.remove([...keys]);
    },
    async listKeys(prefix, cursor, limit = 256): Promise<StorageKeyPage> {
      const all = await area.get(null);
      const matches = Object.keys(all)
        .filter((key) => key.startsWith(prefix) && (cursor === undefined || key > cursor))
        .sort();
      const keys = matches.slice(0, limit);
      if (matches.length <= limit) return { keys, complete: true };
      return { keys, nextCursor: keys.at(-1)!, complete: false };
    },
  };
}
