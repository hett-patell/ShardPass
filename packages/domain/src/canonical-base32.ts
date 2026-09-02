const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TERMINAL_UNUSED_BITS: Readonly<Record<number, number>> = Object.freeze({
  0: 0,
  2: 2,
  4: 4,
  5: 1,
  7: 3,
});

export function isCanonicalUnpaddedBase32(value: string): boolean {
  if (value.length === 0 || !/^[A-Z2-7]+$/u.test(value)) return false;

  const unusedBits = TERMINAL_UNUSED_BITS[value.length % 8];
  if (unusedBits === undefined) return false;

  const terminalValue = BASE32_ALPHABET.indexOf(value[value.length - 1] ?? "");
  return terminalValue >= 0 && (terminalValue & ((1 << unusedBits) - 1)) === 0;
}
