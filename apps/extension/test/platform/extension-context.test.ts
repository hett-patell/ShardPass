import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reloadWhenContextInvalidated } from "../../src/platform/extension-context";

describe("reloadWhenContextInvalidated", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reloads once the runtime id disappears, and not before", () => {
    const runtime: { id?: string } = { id: "abc" };
    const reload = vi.fn();
    reloadWhenContextInvalidated({ runtime, reload, intervalMs: 100 });
    vi.advanceTimersByTime(1_000);
    expect(reload).not.toHaveBeenCalled();
    delete runtime.id;
    vi.advanceTimersByTime(100);
    expect(reload).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("stops watching when disposed", () => {
    const runtime: { id?: string } = { id: "abc" };
    const reload = vi.fn();
    const stop = reloadWhenContextInvalidated({ runtime, reload, intervalMs: 100 });
    stop();
    delete runtime.id;
    vi.advanceTimersByTime(1_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it("does nothing outside an extension page", () => {
    const reload = vi.fn();
    reloadWhenContextInvalidated({ runtime: undefined, reload, intervalMs: 100 });
    vi.advanceTimersByTime(1_000);
    expect(reload).not.toHaveBeenCalled();
  });
});
