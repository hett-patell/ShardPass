import sodium from "libsodium-wrappers-sumo";

import { KEY_ENCRYPTION_KEY_BYTES, type KdfRequestData } from "./kdf";

/**
 * Argon2id through libsodium's WebAssembly build: the same RFC 9106 function (version 0x13)
 * as the pure-JS primitive, bit for bit, in about a tenth of the time. libsodium runs a
 * single lane, which is what every ShardPass vault uses; other lane counts stay with the
 * pure-JS primitive.
 */
export function sodiumDerives(parameters: KdfRequestData["parameters"]): boolean {
  return parameters.parallelism === 1;
}

export async function deriveArgon2idWithSodium(request: KdfRequestData): Promise<Uint8Array> {
  const { parameters } = request;
  if (!sodiumDerives(parameters)) {
    throw new RangeError("libsodium derives single-lane Argon2id only.");
  }
  await sodium.ready;
  const result = sodium.crypto_pwhash(
    KEY_ENCRYPTION_KEY_BYTES,
    request.password,
    request.salt,
    parameters.iterations,
    parameters.memoryKiB * 1024,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  return Uint8Array.from(result);
}
