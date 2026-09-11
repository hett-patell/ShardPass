import { DEFAULT_ARGON2ID_PARAMETERS, deriveKeyEncryptionKey } from "@shardpass/crypto";

import { createHarnessKdfExecutor } from "./kdf-worker";

const BENCHMARK_SALT = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

export async function runArgon2idBenchmark(
  parameters = DEFAULT_ARGON2ID_PARAMETERS,
): Promise<number> {
  const started = performance.now();
  const derived = await deriveKeyEncryptionKey(
    createHarnessKdfExecutor(),
    "ShardPass browser benchmark",
    parameters,
    BENCHMARK_SALT,
  );
  if (derived.byteLength !== 32) throw new Error("Argon2id benchmark output length failed.");
  return performance.now() - started;
}

export const runDefaultArgon2idBenchmark = () => runArgon2idBenchmark();
