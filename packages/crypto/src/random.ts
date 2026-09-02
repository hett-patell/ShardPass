export interface RandomSource {
  randomBytes(length: number): Uint8Array;
}

const MAX_GET_RANDOM_VALUES_BYTES = 65_536;

export const webCryptoRandomSource: RandomSource = Object.freeze({
  randomBytes(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new RangeError("Random byte length must be a non-negative safe integer.");
    }
    const output = new Uint8Array(length);
    for (let offset = 0; offset < output.length; offset += MAX_GET_RANDOM_VALUES_BYTES) {
      globalThis.crypto.getRandomValues(
        output.subarray(offset, Math.min(offset + MAX_GET_RANDOM_VALUES_BYTES, output.length)),
      );
    }
    return output;
  },
});

export function createDeterministicRandomSource(bytes: Uint8Array): RandomSource {
  const fixture = bytes.slice();
  let offset = 0;
  return Object.freeze({
    randomBytes(length: number): Uint8Array {
      if (!Number.isSafeInteger(length) || length < 0 || offset + length > fixture.length) {
        throw new RangeError("Deterministic random source is exhausted.");
      }
      const output = fixture.slice(offset, offset + length);
      offset += length;
      return output;
    },
  });
}
