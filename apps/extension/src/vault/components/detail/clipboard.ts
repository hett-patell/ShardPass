/** How long a copied secret stays on the clipboard before it is cleared. */
export const CLIPBOARD_CLEAR_MS = 30_000;
/**
 * How long after the due time a clear is still carried out. The extension cannot read the
 * clipboard (no permission, deliberately), so a very late clear would blindly wipe whatever
 * the person copied since; past this the pending clear is dropped instead.
 */
export const CLIPBOARD_CLEAR_GRACE_MS = 10 * 60_000;
/** Shared by the popup and the vault page: both are documents of this extension's origin. */
const PENDING_KEY = "shardpass:clipboard:clearAt";

let pendingClear: ReturnType<typeof setTimeout> | undefined;

function rememberDue(at: number | null): void {
  try {
    if (at === null) globalThis.localStorage?.removeItem(PENDING_KEY);
    else globalThis.localStorage?.setItem(PENDING_KEY, String(at));
  } catch {
    // Storage is unavailable (a private window, or a test): the in-document timer is all there is.
  }
}

function dueAt(): number | null {
  try {
    const raw = globalThis.localStorage?.getItem(PENDING_KEY);
    if (raw === null || raw === undefined) return null;
    const at = Number(raw);
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

/**
 * Clears the clipboard after a delay if nothing else has been copied through here since.
 *
 * The delay is restarted by every copy, so only the latest copy's timer survives. A popup is
 * destroyed the moment it loses focus, which takes its timer with it, so the due time is
 * written down as well: the next ShardPass surface to open or regain focus finishes the job
 * through `clearClipboardIfDue`. A write is only permitted while the document is focused, and
 * the extension holds no clipboard-read permission, so it can never check what is there.
 */
export function scheduleClipboardClear(delayMs: number = CLIPBOARD_CLEAR_MS): void {
  if (pendingClear !== undefined) clearTimeout(pendingClear);
  rememberDue(Date.now() + delayMs);
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
  rememberDue(null);
  try {
    if (typeof document !== "undefined" && !document.hasFocus()) return;
    await navigator.clipboard?.writeText("");
  } catch {
    // Not permitted right now; nothing more can be done without a read permission.
  }
}

/**
 * Finishes a clear that fell due while no ShardPass document was open. Called when the popup
 * opens and when the vault page regains focus. A clear that is not yet due keeps its timer
 * here so this document can carry it out itself.
 */
export async function clearClipboardIfDue(now: number = Date.now()): Promise<void> {
  const at = dueAt();
  if (at === null) return;
  if (now < at) {
    if (pendingClear === undefined) {
      pendingClear = setTimeout(() => {
        pendingClear = undefined;
        void clearClipboardNow();
      }, at - now);
    }
    return;
  }
  // Too late to be sure the secret is still the thing on the clipboard: forget it instead.
  if (now - at > CLIPBOARD_CLEAR_GRACE_MS) {
    rememberDue(null);
    return;
  }
  await clearClipboardNow();
}

/** Copies `value` and schedules the clear. */
export async function copyWithAutoClear(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
  scheduleClipboardClear();
}
