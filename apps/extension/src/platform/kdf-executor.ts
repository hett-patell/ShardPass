import { createWorkerKdfExecutor, type KdfExecutor } from "@shardpass/crypto";

/**
 * Built as its own entry (see vite.config.ts) so it shares the single audited libsodium
 * module. The URL is a literal on purpose: the executable policy accepts static worker
 * sources only.
 */
export function createKdfWorker(): Worker {
  return new Worker("/assets/kdf-worker-entry.js", { type: "module" });
}

/** Derives the key-encryption key on a fresh worker per request; the page thread stays free. */
export function createPageKdfExecutor(): KdfExecutor {
  return createWorkerKdfExecutor(createKdfWorker);
}
