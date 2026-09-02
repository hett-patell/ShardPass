import { isCanonicalUnpaddedBase32 } from "@shardpass/domain";

import { OtpError } from "./error";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function decodeCanonicalBase32(value: string): Uint8Array {
  if (!isCanonicalUnpaddedBase32(value)) throw new OtpError("OTP_INVALID_SECRET");

  const output = new Uint8Array(Math.floor((value.length * 5) / 8));
  let accumulator = 0;
  let bits = 0;
  let outputIndex = 0;
  for (const character of value) {
    accumulator = (accumulator << 5) | ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output[outputIndex++] = (accumulator >>> bits) & 0xff;
      accumulator &= (1 << bits) - 1;
    }
  }
  return output;
}
