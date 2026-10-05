/**
 * Recovery codes: 120 random bits as 24 Base32 letters, shown in six groups of four. Long
 * enough that guessing is out of the question even before the key derivation, short enough
 * to write down by hand. Read back forgivingly: case, spaces and dashes do not matter, and
 * the digits people write for the letters that look like them are taken as those letters.
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const CODE_BYTES = 15;
export const RECOVERY_CODE_LENGTH = 24;

/** A new code, from the browser's own CSPRNG, unformatted. */
export function generateRecoveryCode(
  random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): string {
  const bytes = random(new Uint8Array(CODE_BYTES));
  let bits = 0;
  let value = 0;
  let code = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      code += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  bytes.fill(0);
  return code;
}

/** "ABCDEFGH…" as "ABCD-EFGH-…", for showing and printing. */
export function formatRecoveryCode(code: string): string {
  return code.match(/.{1,4}/gu)?.join("-") ?? code;
}

/**
 * What the person typed, as the code it stands for, or null when it cannot be one. The key
 * is derived from this canonical form, so "abcd efgh" and "ABCD-EFGH" open the same vault.
 */
export function normalizeRecoveryCode(typed: string): string | null {
  const code = typed
    .toUpperCase()
    .replace(/[\s-]/gu, "")
    .replace(/0/gu, "O")
    .replace(/1/gu, "I")
    .replace(/8/gu, "B");
  return code.length === RECOVERY_CODE_LENGTH && /^[A-Z2-7]+$/u.test(code) ? code : null;
}
