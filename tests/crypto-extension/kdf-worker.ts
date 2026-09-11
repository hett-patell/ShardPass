import { createWorkerKdfExecutor, type KdfExecutor } from "@shardpass/crypto";

/** The harness bundles the package's worker entry itself; production starts it by asset URL. */
export function createHarnessKdfExecutor(): KdfExecutor {
  return createWorkerKdfExecutor(
    () =>
      new Worker(new URL("../../packages/crypto/src/kdf-worker-entry.ts", import.meta.url), {
        type: "module",
      }),
  );
}
