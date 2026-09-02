import { describe, expect, it, vi } from "vitest";

import { StatePublisher } from "../../src/background/state-publisher";

const streamId = "00000000000000000000000000000001";
const input = {
  version: 1 as const,
  kind: "vault.state" as const,
  state: "locked" as const,
  autoLockMinutes: 15 as const,
  lockOnScreenLock: true,
  retryAfterMs: 0,
};

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("StatePublisher", () => {
  it("retries a failed read without another publish request and preserves one stream ordering", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockRejectedValueOnce(new Error("read failed")).mockResolvedValue(input);
    const events: unknown[] = [];
    const publisher = new StatePublisher(streamId, read);
    publisher.subscribe((event) => events.push(event));
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(2);
    expect(events).toEqual([{ ...input, streamId, sequence: 1 }]);
    publisher.dispose();
    vi.useRealTimers();
  });

  it("bounds repeated failures and emits one strict unavailable event without churn", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockRejectedValue(new Error("read failed"));
    const events: unknown[] = [];
    const publisher = new StatePublisher(streamId, read);
    publisher.subscribe((event) => events.push(event));
    await vi.runAllTimersAsync();
    expect(read).toHaveBeenCalledTimes(6);
    expect(events).toEqual([{ version: 1, kind: "vault.stateUnavailable", streamId, sequence: 1 }]);
    await vi.runAllTimersAsync();
    expect(read).toHaveBeenCalledTimes(6);
    publisher.dispose();
    vi.useRealTimers();
  });

  it("accelerates a dirty publish during backoff and disposal cancels pending retry", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockRejectedValueOnce(new Error("read failed")).mockResolvedValue(input);
    const events: unknown[] = [];
    const publisher = new StatePublisher(streamId, read);
    publisher.subscribe((event) => events.push(event));
    await settle();
    publisher.publish();
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
    publisher.dispose();
    await vi.runAllTimersAsync();
    expect(events).toEqual([{ ...input, streamId, sequence: 1 }]);
    expect(read).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("does not deliver a cached state to a subscriber while a dirty refresh is pending", async () => {
    let resolveFresh: ((value: typeof input) => void) | undefined;
    const read = vi
      .fn()
      .mockResolvedValueOnce(input)
      .mockImplementationOnce(
        () => new Promise<typeof input>((resolve) => (resolveFresh = resolve)),
      );
    const publisher = new StatePublisher(streamId, read);
    const first: unknown[] = [];
    const disposeFirst = publisher.subscribe((event) => first.push(event));
    await settle();
    disposeFirst();
    publisher.publish();
    const second: unknown[] = [];
    publisher.subscribe((event) => second.push(event));
    expect(second).toEqual([]);
    resolveFresh?.(input);
    await settle();
    expect(second).toEqual([{ ...input, streamId, sequence: 2 }]);
    publisher.dispose();
  });

  it("caches terminal unavailable, rejects query, then supersedes it with later success", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValueOnce(input).mockRejectedValue(new Error("failed"));
    const publisher = new StatePublisher(streamId, read);
    const first: unknown[] = [];
    const disposeFirst = publisher.subscribe((event) => first.push(event));
    await settle();
    publisher.publish();
    await vi.runAllTimersAsync();
    disposeFirst();
    const second: unknown[] = [];
    publisher.subscribe((event) => second.push(event));
    expect(second).toEqual([{ version: 1, kind: "vault.stateUnavailable", streamId, sequence: 2 }]);
    const queryExpectation = expect(publisher.snapshot()).rejects.toThrow("failed");
    await vi.runAllTimersAsync();
    await queryExpectation;
    read.mockResolvedValueOnce({ ...input, state: "unlocked" as const });
    publisher.publish();
    await settle();
    expect(second.at(-1)).toEqual({ ...input, state: "unlocked", streamId, sequence: 4 });
    publisher.dispose();
    vi.useRealTimers();
  });

  it("returns the exact cached immutable snapshot for query and subscriber", async () => {
    const publisher = new StatePublisher(streamId, () => Promise.resolve(input));
    const events: unknown[] = [];
    publisher.subscribe((event) => events.push(event));
    const queried = await publisher.snapshot();
    await settle();
    expect(events[0]).toBe(queried);
    expect(Object.isFrozen(queried)).toBe(true);
    publisher.dispose();
  });
});
