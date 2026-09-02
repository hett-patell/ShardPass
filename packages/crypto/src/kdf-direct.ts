import { argon2id } from "@noble/hashes/argon2.js";
import { MAX_ARGON2_MEMORY_KIB } from "@shardpass/storage";

import { KEY_ENCRYPTION_KEY_BYTES, type KdfRequestData } from "./kdf";

/** Package-internal blocking primitive. Import only from the worker entry or crypto tests. */
export function deriveArgon2idDirect(request: KdfRequestData): Uint8Array {
  const { parameters } = request;
  return argon2id(request.password, request.salt, {
    version: 19,
    m: parameters.memoryKiB,
    t: parameters.iterations,
    p: parameters.parallelism,
    dkLen: KEY_ENCRYPTION_KEY_BYTES,
    maxmem: MAX_ARGON2_MEMORY_KIB * 1024 + 1024 * 1024,
  });
}
