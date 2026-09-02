import { dynamicTruncate, hmacCounter, type OtpCrypto } from "./hotp";

const STEAM_ALPHABET = "23456789BCDFGHJKMNPQRTVWXY";

export async function generateSteamCode(
  canonicalSecret: string,
  counter: number,
  crypto?: OtpCrypto,
): Promise<string> {
  let value = dynamicTruncate(await hmacCounter(canonicalSecret, counter, "SHA1", crypto));
  let code = "";
  for (let index = 0; index < 5; index += 1) {
    code += STEAM_ALPHABET[value % STEAM_ALPHABET.length];
    value = Math.floor(value / STEAM_ALPHABET.length);
  }
  return code;
}
