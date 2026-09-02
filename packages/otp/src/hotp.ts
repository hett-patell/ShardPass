import type { OtpItem } from "@shardpass/domain";

import { decodeCanonicalBase32 } from "./base32";
import { OtpError } from "./error";

export type OtpAlgorithm = OtpItem["algorithm"];

export interface OtpCrypto {
  hmac(algorithm: OtpAlgorithm, key: Uint8Array, message: Uint8Array): Promise<Uint8Array>;
}

export const webCryptoOtp: OtpCrypto = {
  async hmac(algorithm, key, message) {
    const cryptoAlgorithm = algorithm.replace("SHA", "SHA-");
    const imported = await globalThis.crypto.subtle.importKey(
      "raw",
      Uint8Array.from(key),
      { name: "HMAC", hash: cryptoAlgorithm },
      false,
      ["sign"],
    );
    return new Uint8Array(
      await globalThis.crypto.subtle.sign("HMAC", imported, Uint8Array.from(message)),
    );
  },
};

export async function generateHotp(
  canonicalSecret: string,
  counter: number,
  digits: number,
  algorithm: OtpAlgorithm,
  crypto: OtpCrypto = webCryptoOtp,
): Promise<string> {
  if (!Number.isSafeInteger(counter) || counter < 0) throw new OtpError("OTP_INVALID_COUNTER");
  if (!Number.isInteger(digits) || digits < 5 || digits > 10)
    throw new OtpError("OTP_INVALID_ITEM");

  const digest = await hmacCounter(canonicalSecret, counter, algorithm, crypto);
  const value = dynamicTruncate(digest);
  return String(value % 10 ** digits).padStart(digits, "0");
}

export async function hmacCounter(
  canonicalSecret: string,
  counter: number,
  algorithm: OtpAlgorithm,
  crypto: OtpCrypto = webCryptoOtp,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(counter) || counter < 0) throw new OtpError("OTP_INVALID_COUNTER");
  const message = new Uint8Array(8);
  let remaining = BigInt(counter);
  for (let index = message.length - 1; index >= 0; index -= 1) {
    message[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return crypto.hmac(algorithm, decodeCanonicalBase32(canonicalSecret), message);
}

export function dynamicTruncate(digest: Uint8Array): number {
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  if (offset + 3 >= digest.length) throw new OtpError("OTP_INVALID_ITEM");
  return (
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!
  );
}
