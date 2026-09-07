/// <reference types="chrome" />

import { STORAGE_LIST_PAGE_KEYS, type StorageKeyPage, type StoragePort } from "@shardpass/storage";

/**
 * A key scan is a series of listKeys calls joined by the cursor. Chromium 130+ can list keys
 * without deserialising a single value; older browsers have to read the whole area, which for
 * a vault of thousands of records is expensive enough that it must happen once per scan, not
 * once per page. Either way the snapshot taken at the start of a scan serves every page of
 * it, so pages stay coherent while one owner scans (see StoragePort). A scan starts with an
 * undefined cursor; its snapshot is dropped when it completes or another scan starts.
 */
export function createChromeStoragePort(area: chrome.storage.StorageArea): StoragePort {
  let scan: { prefix: string; keys: readonly string[] } | null = null;
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
    async listKeys(prefix, cursor, limit = STORAGE_LIST_PAGE_KEYS): Promise<StorageKeyPage> {
      let keys: readonly string[];
      if (cursor !== undefined && scan !== null && scan.prefix === prefix) keys = scan.keys;
      else {
        keys = (await readAreaKeys(area)).filter((key) => key.startsWith(prefix)).sort();
        scan = { prefix, keys };
      }
      const start = cursor === undefined ? 0 : firstIndexAfter(keys, cursor);
      const page = keys.slice(start, start + limit);
      if (start + limit >= keys.length) {
        scan = null;
        return { keys: page, complete: true };
      }
      return { keys: page, nextCursor: page.at(-1)!, complete: false };
    },
  };
}

/** `StorageArea.getKeys` exists from Chromium 130; before that the whole area is read. */
async function readAreaKeys(area: chrome.storage.StorageArea): Promise<string[]> {
  const candidate: { getKeys?: () => Promise<string[]> } = area;
  if (typeof candidate.getKeys === "function") return await candidate.getKeys();
  return Object.keys(await area.get(null));
}

/** Index of the first key greater than `cursor` in a sorted list (binary search). */
function firstIndexAfter(keys: readonly string[], cursor: string): number {
  let low = 0;
  let high = keys.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (keys[middle]! <= cursor) low = middle + 1;
    else high = middle;
  }
  return low;
}
