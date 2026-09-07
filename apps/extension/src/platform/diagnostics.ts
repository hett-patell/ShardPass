/// <reference types="vite/client" />

/**
 * Development-only console output. Vite replaces `import.meta.env.DEV` with a constant in a
 * production build and the dead branch is dropped, so shipped bundles carry no console
 * transport at all -- which the build scanner insists on for a password manager.
 */
export const diagnostics = {
  warn(...args: unknown[]): void {
    if (import.meta.env.DEV) console.warn(...args);
  },
  error(...args: unknown[]): void {
    if (import.meta.env.DEV) console.error(...args);
  },
};
