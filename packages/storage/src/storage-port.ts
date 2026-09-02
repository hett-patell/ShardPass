export const MAX_STORAGE_KEYS_PER_OPERATION = 100_000;
export const MAX_STORAGE_KEY_CHARACTERS = 512;
export const MAX_STORAGE_VALUE_BYTES = 16 * 1024 * 1024;
export const STORAGE_BATCH_KEYS = 256;
export const STORAGE_LIST_PAGE_KEYS = 256;

export type StorageValue =
  | null
  | boolean
  | number
  | string
  | StorageValue[]
  | {
      readonly [key: string]: StorageValue;
    };
export type StorageValues = Readonly<Record<string, StorageValue>>;
export interface StorageKeyPage {
  readonly keys: readonly string[];
  readonly nextCursor?: string;
  readonly complete: boolean;
}

/**
 * Each get/set/remove/listKeys call is asynchronous. Task 4 writes immutable generation objects
 * through one-key set calls and does not depend on multi-key atomicity. listKeys returns a bounded,
 * lexicographically sorted page whose cursor is exclusive. An adapter that enumerates and sorts a
 * full browser-storage snapshot per call must keep pages coherent while one owner performs the scan;
 * concurrent external writers can otherwise shift page boundaries.
 *
 * Repository mutations also use an instance-local mutex and recheck the expected root immediately
 * before activation. StoragePort has no compare-and-swap primitive, so one background owner remains
 * mandatory; two independent owners can still race between the recheck and root write. Likewise,
 * authenticated local state detects tampering but cannot detect replay of a complete older snapshot
 * without trusted monotonic state outside this storage boundary.
 */
export interface StoragePort {
  get(keys: readonly string[]): Promise<StorageValues>;
  set(values: StorageValues): Promise<void>;
  remove(keys: readonly string[]): Promise<void>;
  listKeys(prefix: string, cursor?: string, limit?: number): Promise<StorageKeyPage>;
}

export type StorageErrorCode =
  | "DUPLICATE_NONCE"
  | "EXTERNAL_ROOT_CHANGED"
  | "JOURNAL_CURSOR_EXPIRED"
  | "REVISION_CONFLICT"
  | "STORAGE_CAPACITY_EXCEEDED"
  | "STORAGE_CORRUPT"
  | "STORAGE_FAILED"
  | "VAULT_INVALID";

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode) {
    super(code);
    this.name = "StorageError";
    this.code = code;
  }
}

export async function storageGet(
  port: StoragePort,
  keys: readonly string[],
): Promise<StorageValues> {
  assertKeys(keys);
  try {
    return await port.get(keys);
  } catch {
    throw new StorageError("STORAGE_FAILED");
  }
}
export async function storageSet(port: StoragePort, values: StorageValues): Promise<void> {
  const keys = Object.keys(values);
  assertKeys(keys);
  for (const value of Object.values(values)) assertValue(value);
  try {
    await port.set(values);
  } catch {
    throw new StorageError("STORAGE_FAILED");
  }
}
export async function storageRemove(port: StoragePort, keys: readonly string[]): Promise<void> {
  assertKeys(keys);
  try {
    await port.remove(keys);
  } catch {
    throw new StorageError("STORAGE_FAILED");
  }
}
export async function storageListKeys(
  port: StoragePort,
  prefix: string,
  cursor?: string,
  limit = STORAGE_LIST_PAGE_KEYS,
): Promise<StorageKeyPage> {
  assertListRequest(prefix, cursor, limit);
  try {
    const page = await port.listKeys(prefix, cursor, limit);
    assertKeys(page.keys);
    if (
      page.keys.length > limit ||
      page.keys.some((key) => !key.startsWith(prefix) || (cursor !== undefined && key <= cursor)) ||
      !strictlySorted(page.keys)
    ) {
      throw new Error("invalid key listing");
    }
    if (page.complete) {
      if (page.nextCursor !== undefined) throw new Error("complete page has cursor");
    } else if (
      page.keys.length === 0 ||
      page.nextCursor === undefined ||
      page.nextCursor !== page.keys.at(-1)
    ) {
      throw new Error("incomplete page lacks progress");
    }
    return page;
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError("STORAGE_FAILED");
  }
}

function assertListRequest(prefix: string, cursor: string | undefined, limit: number): void {
  if (
    prefix.length === 0 ||
    prefix.length > MAX_STORAGE_KEY_CHARACTERS ||
    (cursor !== undefined &&
      (cursor.length === 0 ||
        cursor.length > MAX_STORAGE_KEY_CHARACTERS ||
        !cursor.startsWith(prefix))) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > STORAGE_LIST_PAGE_KEYS
  ) {
    throw new StorageError("STORAGE_FAILED");
  }
}
function strictlySorted(keys: readonly string[]): boolean {
  return keys.every((key, index) => index === 0 || keys[index - 1]! < key);
}
function assertKeys(keys: readonly string[]): void {
  if (keys.length > MAX_STORAGE_KEYS_PER_OPERATION || new Set(keys).size !== keys.length)
    throw new StorageError("STORAGE_FAILED");
  for (const key of keys)
    if (key.length === 0 || key.length > MAX_STORAGE_KEY_CHARACTERS)
      throw new StorageError("STORAGE_FAILED");
}
function assertValue(value: StorageValue): void {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new StorageError("STORAGE_FAILED");
  }
  if (new TextEncoder().encode(encoded).byteLength > MAX_STORAGE_VALUE_BYTES)
    throw new StorageError("STORAGE_FAILED");
}
