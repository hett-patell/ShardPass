import type { StorageKeyPage, StoragePort, StorageValues } from "../../storage/src/storage-port";

type Operation = "get" | "listKeys" | "remove" | "set";
type FailurePhase = "before" | "after" | "partial";
type PauseBoundary = `${Operation}:before` | `${Operation}:after`;

export interface RecordedStorageWrite {
  readonly keys: readonly string[];
  readonly values: StorageValues;
}
export interface RecordedStorageRemoval {
  readonly keys: readonly string[];
}
export interface FakeStorageOptions {
  readonly listPageLimit?: number;
  readonly repeatListCursor?: boolean;
}

export class FakeStoragePort implements StoragePort {
  readonly writes: RecordedStorageWrite[] = [];
  readonly removals: RecordedStorageRemoval[] = [];
  operationCount = 0;
  writeCount = 0;
  removeCount = 0;

  private values: Record<string, unknown>;
  private pause: { boundary: PauseBoundary; callback: () => void | Promise<void> } | null = null;
  private failure: {
    at?: number;
    error: Error;
    operation?: Operation;
    phase: FailurePhase;
    partialCount?: number;
    writeAt?: number;
    removeAt?: number;
    keySuffix?: string;
  } | null = null;

  constructor(
    initial: StorageValues = {},
    private readonly options: FakeStorageOptions = {},
  ) {
    this.values = clone(initial);
  }

  async get(keys: readonly string[]): Promise<StorageValues> {
    await this.before("get");
    const output: Record<string, unknown> = {};
    for (const key of keys)
      if (Object.hasOwn(this.values, key)) output[key] = clone(this.values[key]);
    await this.after("get");
    return output as StorageValues;
  }

  async listKeys(prefix: string, cursor?: string, limit = 256): Promise<StorageKeyPage> {
    await this.before("listKeys");
    const effectiveLimit = Math.min(limit, this.options.listPageLimit ?? limit);
    const matching = Object.keys(this.values)
      .filter((key) => key.startsWith(prefix) && (cursor === undefined || key > cursor))
      .sort();
    const keys = matching.slice(0, effectiveLimit);
    const complete = matching.length <= effectiveLimit;
    if (complete) {
      await this.after("listKeys");
      return { keys, complete: true };
    }
    const nextCursor =
      this.options.repeatListCursor && cursor !== undefined ? cursor : keys.at(-1)!;
    await this.after("listKeys");
    return { keys, nextCursor, complete: false };
  }

  async set(values: StorageValues): Promise<void> {
    this.operationCount += 1;
    this.writeCount += 1;
    await this.pauseAt("set:before");
    const failure = this.match("set", Object.keys(values));
    if (failure?.phase === "before") throw failure.error;
    const entries = Object.entries(values);
    const applied =
      failure?.phase === "partial" ? entries.slice(0, failure.partialCount ?? 1) : entries;
    for (const [key, value] of applied) this.values[key] = clone(value);
    this.writes.push({ keys: applied.map(([key]) => key), values: Object.fromEntries(applied) });
    await this.pauseAt("set:after");
    if (failure !== null) throw failure.error;
  }

  async remove(keys: readonly string[]): Promise<void> {
    this.operationCount += 1;
    this.removeCount += 1;
    await this.pauseAt("remove:before");
    const failure = this.match("remove");
    if (failure?.phase === "before") throw failure.error;
    const applied = failure?.phase === "partial" ? keys.slice(0, failure.partialCount ?? 1) : keys;
    for (const key of applied) delete this.values[key];
    this.removals.push({ keys: [...applied] });
    await this.pauseAt("remove:after");
    if (failure !== null) throw failure.error;
  }

  failAtOperation(at: number, error: Error): void {
    this.failure = { at, error, phase: "before" };
  }
  failNext(operation: Operation, error: Error): void {
    this.failure = { operation, error, phase: "before" };
  }
  /**
   * Fails the write that touches a key ending in `suffix` -- "root", "manifest", "verified".
   * A test that wants "the write that activates the generation" says so, instead of counting
   * writes: the count changes whenever the store batches differently, and a stale count
   * silently stops injecting the failure the test was written to inject.
   */
  failWriteToKeyEnding(suffix: string, phase: FailurePhase, error: Error): void {
    this.failure = { keySuffix: suffix, phase, error };
  }

  failWriteAt(writeAt: number, phase: FailurePhase, error: Error, partialCount?: number): void {
    this.failure = {
      writeAt,
      phase,
      error,
      ...(partialCount === undefined ? {} : { partialCount }),
    };
  }
  failRemoveAt(removeAt: number, phase: FailurePhase, error: Error, partialCount?: number): void {
    this.failure = {
      removeAt,
      phase,
      error,
      ...(partialCount === undefined ? {} : { partialCount }),
    };
  }
  clearFailure(): void {
    this.failure = null;
  }
  pauseNext(boundary: PauseBoundary, callback: () => void | Promise<void>): void {
    this.pause = { boundary, callback };
  }
  resetOperationCount(): void {
    this.operationCount = 0;
    this.writeCount = 0;
    this.removeCount = 0;
  }
  snapshot(): Promise<StorageValues> {
    return Promise.resolve(clone(this.values) as StorageValues);
  }

  private async before(operation: Operation): Promise<void> {
    this.operationCount += 1;
    await this.pauseAt(`${operation}:before`);
    const failure = this.match(operation);
    if (failure !== null) throw failure.error;
  }
  private after(operation: Operation): Promise<void> {
    return this.pauseAt(`${operation}:after`);
  }
  private async pauseAt(boundary: PauseBoundary): Promise<void> {
    if (this.pause?.boundary !== boundary) return;
    const pause = this.pause;
    this.pause = null;
    await pause.callback();
  }
  private match(operation: Operation, keys: readonly string[] = []) {
    const failure = this.failure;
    const suffix = failure?.keySuffix;
    if (
      failure !== null &&
      (failure.at === this.operationCount ||
        failure.operation === operation ||
        (operation === "set" && failure.writeAt === this.writeCount) ||
        (operation === "set" && suffix !== undefined && keys.some((key) => key.endsWith(suffix))) ||
        (operation === "remove" && failure.removeAt === this.removeCount))
    ) {
      this.failure = null;
      return failure;
    }
    return null;
  }
}
function clone<T>(value: T): T {
  return structuredClone(value);
}
