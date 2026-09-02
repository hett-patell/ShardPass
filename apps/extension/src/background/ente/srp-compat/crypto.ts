import { sha256 } from "@noble/hashes/sha2.js";
import { Buffer } from "./buffer";

type HashInput = Uint8Array;

class Sha256Hash {
  readonly #hash = sha256.create();
  #digested = false;

  update(value: HashInput): this {
    if (this.#digested) throw new Error("Digest already called");
    if (!(value instanceof Uint8Array)) throw new TypeError("Hash update requires bytes");
    this.#hash.update(value);
    return this;
  }

  digest(): Buffer {
    if (this.#digested) throw new Error("Digest already called");
    this.#digested = true;
    return Buffer.from(this.#hash.digest());
  }
}

export function createHash(algorithm: string): Sha256Hash {
  if (algorithm !== "sha256") throw new Error("Unsupported hash algorithm");
  return new Sha256Hash();
}

export default { createHash };
