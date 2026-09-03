/** How long a copied secret stays on the clipboard before it is cleared. */
export const CLIPBOARD_CLEAR_MS = 30_000;

let pendingClear: ReturnType<typeof setTimeout> | undefined;

/**
 * Clears the clipboard after a delay if nothing else has been copied through here since.
 *
 * Best-effort by design: the extension holds no clipboard-read permission (deliberately), so
 * it cannot check whether the user copied something else in the meantime, and a write is only
 * permitted while this document is focused. The delay is restarted by every copy, so only the
 * latest copy's timer survives, and a page that has lost focus simply leaves the value.
 */
export function scheduleClipboardClear(delayMs: number = CLIPBOARD_CLEAR_MS): void {
  if (pendingClear !== undefined) clearTimeout(pendingClear);
  pendingClear = setTimeout(() => {
    pendingClear = undefined;
    void clearClipboardNow();
  }, delayMs);
}

/** Overwrites the clipboard with an empty string if this document may do so. */
export async function clearClipboardNow(): Promise<void> {
  if (pendingClear !== undefined) {
    clearTimeout(pendingClear);
    pendingClear = undefined;
  }
  try {
    if (typeof document !== "undefined" && !document.hasFocus()) return;
    await navigator.clipboard?.writeText("");
  } catch {
    // Not permitted right now; nothing more can be done without a read permission.
  }
}

/** Copies `value` and schedules the clear. */
export async function copyWithAutoClear(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
  scheduleClipboardClear();
}
