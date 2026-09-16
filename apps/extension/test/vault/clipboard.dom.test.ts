import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CLIPBOARD_CLEAR_GRACE_MS,
  CLIPBOARD_CLEAR_MS,
  clearClipboardIfDue,
  scheduleClipboardClear,
} from "../../src/vault/components/detail/clipboard";

const PENDING_KEY = "shardpass:clipboard:clearAt";

function stubClipboard(): { writeText: ReturnType<typeof vi.fn> } {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return { writeText };
}

beforeEach(() => {
  localStorage.removeItem(PENDING_KEY);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.removeItem(PENDING_KEY);
});

describe("clipboard auto-clear", () => {
  it("clears on its own timer while the document lives, and forgets the pending clear", async () => {
    const { writeText } = stubClipboard();
    vi.useFakeTimers();
    scheduleClipboardClear();
    expect(localStorage.getItem(PENDING_KEY)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS + 10);
    expect(writeText).toHaveBeenCalledWith("");
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("finishes a clear the closed popup could not: the next focused document does it", async () => {
    const { writeText } = stubClipboard();
    // A popup copied, then was destroyed before its timer ran: only the due time is left.
    localStorage.setItem(PENDING_KEY, String(Date.now() - 5_000));
    await clearClipboardIfDue();
    expect(writeText).toHaveBeenCalledWith("");
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("drops a clear that is far past due instead of wiping what was copied since", async () => {
    const { writeText } = stubClipboard();
    localStorage.setItem(PENDING_KEY, String(Date.now() - CLIPBOARD_CLEAR_GRACE_MS - 1_000));
    await clearClipboardIfDue();
    expect(writeText).not.toHaveBeenCalled();
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("takes over a clear that is not due yet rather than clearing early", async () => {
    const { writeText } = stubClipboard();
    vi.useFakeTimers();
    const due = Date.now() + 20_000;
    localStorage.setItem(PENDING_KEY, String(due));
    await clearClipboardIfDue();
    expect(writeText).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_010);
    expect(writeText).toHaveBeenCalledWith("");
  });

  it("writes nothing while the document is not focused, and keeps no pending clear", async () => {
    const { writeText } = stubClipboard();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    localStorage.setItem(PENDING_KEY, String(Date.now() - 1_000));
    await clearClipboardIfDue();
    expect(writeText).not.toHaveBeenCalled();
  });
});
