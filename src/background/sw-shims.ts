// Minimal globals shim for the MV3 service worker.
//
// Two specific things break sync if we don't shim:
//
// 1. Vite's `__vitePreload` helper has an unguarded `window.dispatchEvent`
//    in its error-reporting path. If a dynamic import ever rejects, that
//    helper runs and crashes with "window is not defined" — masking the
//    real error.
//
// 2. The same helper guards its top-level setup with `typeof document<"u"`,
//    so leaving `document` undefined is correct (do NOT shim document).
//
// We provide just enough on `window` to keep the helper's error path
// non-throwing. Everything else (libsodium, fast-srp-hap, otpauth) uses
// proper `typeof` guards or `globalThis` and runs fine in the SW.
//
// MUST be the first import of the background entry.

const g = globalThis as unknown as { window?: unknown };

if (typeof g.window === "undefined") {
  // We don't proxy this — doing so would also stub things libsodium probes
  // (`globalThis.window` → !! check). A plain object with the methods Vite's
  // preload helper actually calls is safer.
  g.window = {
    dispatchEvent: (_event: unknown): boolean => true,
    addEventListener: (): undefined => undefined,
    removeEventListener: (): undefined => undefined,
  };
}

export {};
