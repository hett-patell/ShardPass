export interface ContextWatchOptions {
  intervalMs?: number;
  /** The extension runtime to watch; defaults to `chrome.runtime`. Absent means nothing to watch. */
  runtime?: { id?: string } | undefined;
  /** What to do once the runtime is gone; defaults to reloading the page. */
  reload?: () => void;
}

/**
 * An extension page outlives an extension reload: its `chrome.runtime.id` goes away, every
 * message throws "Extension context invalidated", and the page is left blank. Watch for
 * that and reload the page, which comes back on the new runtime at the same URL.
 */
export function reloadWhenContextInvalidated(options: ContextWatchOptions = {}): () => void {
  const runtime =
    "runtime" in options
      ? options.runtime
      : (globalThis as { chrome?: { runtime?: { id?: string } } }).chrome?.runtime;
  if (runtime === undefined) return () => undefined;
  const reload = options.reload ?? (() => globalThis.location.reload());
  const timer = setInterval(() => {
    if (runtime.id === undefined) {
      clearInterval(timer);
      reload();
    }
  }, options.intervalMs ?? 1_500);
  return () => clearInterval(timer);
}
