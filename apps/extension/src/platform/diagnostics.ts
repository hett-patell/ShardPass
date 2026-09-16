/// <reference types="vite/client" />

/**
 * Development-only console output. Vite replaces `import.meta.env.DEV` with a constant in a
 * production build and the dead branch is dropped, so nothing here reaches a shipped bundle.
 * The build scanner (scripts/scan-build.mjs) forbids console.log/info/debug and a bare
 * `console` reference in shipped code; console.warn/error are not forbidden there, because
 * third-party production bundles (React DOM) legitimately contain console.error.
 */
export const diagnostics = {
  warn(...args: unknown[]): void {
    if (import.meta.env.DEV) console.warn(...args);
  },
  error(...args: unknown[]): void {
    if (import.meta.env.DEV) console.error(...args);
  },
};
