import { EFF_WORDLIST } from "./wordlist";

const MIN_RANDOM_PASSWORD_LENGTH = 8;
const MAX_RANDOM_PASSWORD_LENGTH = 128;
const MIN_PASSPHRASE_WORD_COUNT = 3;
const MAX_PASSPHRASE_WORD_COUNT = 10;
const DEFAULT_RANDOM_PASSWORD_LENGTH = 20;
const DEFAULT_PASSPHRASE_WORD_COUNT = 4;

// Ambiguous-excluding alphabets omit visually similar characters: 0/O, 1/I/l.
const UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ";
const UPPER_FULL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghjkmnpqrstuvwxyz";
const LOWER_FULL = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "23456789";
const DIGITS_FULL = "0123456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{}|;:,.<>?";

const UINT32_RANGE = 0x1_0000_0000;

/**
 * Returns a uniformly-distributed random integer in [0, max) using rejection
 * sampling over `crypto.getRandomValues()` output. Rejection sampling (rather
 * than `value % max`) avoids modulo bias for ranges that do not evenly divide
 * 2^32.
 */
function secureRandomIndex(max: number): number {
  if (!Number.isInteger(max) || max <= 0 || max > UINT32_RANGE) {
    throw new RangeError("secureRandomIndex requires an integer max in (0, 2^32].");
  }
  const rejectionThreshold = UINT32_RANGE - (UINT32_RANGE % max);
  const array = new Uint32Array(1);
  let value: number;
  do {
    globalThis.crypto.getRandomValues(array);
    value = array[0] as number;
  } while (value >= rejectionThreshold);
  return value % max;
}

/** Fisher-Yates shuffle using unbiased secure random indices, in place. */
function secureShuffle<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = secureRandomIndex(i + 1);
    const a = items[i] as T;
    const b = items[j] as T;
    items[i] = b;
    items[j] = a;
  }
}

export interface RandomPasswordOptions {
  /** Total password length. Must be within [8, 128]. Defaults to 20. */
  readonly length?: number;
  /** Include uppercase letters (A-Z). Defaults to true. */
  readonly uppercase?: boolean;
  /** Include lowercase letters (a-z). Defaults to true. */
  readonly lowercase?: boolean;
  /** Include digits (0-9). Defaults to true. */
  readonly digits?: boolean;
  /** Include symbol characters. Defaults to false. */
  readonly symbols?: boolean;
  /** Exclude visually ambiguous characters (0, O, I, l, 1). Defaults to false. */
  readonly excludeAmbiguous?: boolean;
}

export interface GeneratedSecret {
  readonly password: string;
  readonly entropyBits: number;
}

/**
 * Generates a random password drawn from the enabled character classes.
 *
 * Guarantees at least one character from each enabled class by seeding those
 * characters first, filling the remainder from the combined pool, and then
 * applying a Fisher-Yates shuffle so class membership does not leak position.
 */
export function generateRandomPassword(opts: RandomPasswordOptions = {}): GeneratedSecret {
  const length = opts.length ?? DEFAULT_RANDOM_PASSWORD_LENGTH;
  if (
    !Number.isInteger(length) ||
    length < MIN_RANDOM_PASSWORD_LENGTH ||
    length > MAX_RANDOM_PASSWORD_LENGTH
  ) {
    throw new RangeError(
      `Password length must be an integer between ${MIN_RANDOM_PASSWORD_LENGTH} and ${MAX_RANDOM_PASSWORD_LENGTH}.`,
    );
  }

  const useAmbiguous = !opts.excludeAmbiguous;
  const classes: string[] = [];
  if (opts.uppercase !== false) classes.push(useAmbiguous ? UPPER_FULL : UPPER);
  if (opts.lowercase !== false) classes.push(useAmbiguous ? LOWER_FULL : LOWER);
  if (opts.digits !== false) classes.push(useAmbiguous ? DIGITS_FULL : DIGITS);
  if (opts.symbols) classes.push(SYMBOLS);

  if (classes.length === 0) {
    throw new RangeError("At least one character class must be enabled.");
  }
  // classes.length is at most 4 (upper/lower/digits/symbols) and length is
  // enforced to be at least MIN_RANDOM_PASSWORD_LENGTH (8), so every enabled
  // class can always be seeded before the pool fill loop runs.

  const pool = classes.join("");
  const chars: string[] = [];

  for (const cls of classes) {
    chars.push(cls[secureRandomIndex(cls.length)] as string);
  }
  while (chars.length < length) {
    chars.push(pool[secureRandomIndex(pool.length)] as string);
  }

  secureShuffle(chars);

  const entropyBits = Math.floor(length * Math.log2(pool.length));
  return { password: chars.join(""), entropyBits };
}

export type PassphraseSeparator = "hyphen" | "space" | "period" | "none";

const SEPARATORS: Record<PassphraseSeparator, string> = {
  hyphen: "-",
  space: " ",
  period: ".",
  none: "",
};

export interface PassphraseOptions {
  /** Number of Diceware words. Must be within [3, 10]. Defaults to 4. */
  readonly wordCount?: number;
  /** Separator inserted between words. Defaults to "hyphen". */
  readonly separator?: PassphraseSeparator;
  /** Capitalize the first letter of each word. Defaults to false. */
  readonly capitalize?: boolean;
}

/**
 * Generates a Diceware-style passphrase by drawing `wordCount` words from the
 * EFF large wordlist using unbiased secure random selection.
 */
export function generatePassphrase(opts: PassphraseOptions = {}): GeneratedSecret {
  const wordCount = opts.wordCount ?? DEFAULT_PASSPHRASE_WORD_COUNT;
  if (
    !Number.isInteger(wordCount) ||
    wordCount < MIN_PASSPHRASE_WORD_COUNT ||
    wordCount > MAX_PASSPHRASE_WORD_COUNT
  ) {
    throw new RangeError(
      `Passphrase word count must be an integer between ${MIN_PASSPHRASE_WORD_COUNT} and ${MAX_PASSPHRASE_WORD_COUNT}.`,
    );
  }

  const separator = SEPARATORS[opts.separator ?? "hyphen"];
  const words: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    const word = EFF_WORDLIST[secureRandomIndex(EFF_WORDLIST.length)] as string;
    words.push(opts.capitalize ? (word[0] as string).toUpperCase() + word.slice(1) : word);
  }

  const entropyBits = Math.floor(wordCount * Math.log2(EFF_WORDLIST.length));
  return { password: words.join(separator), entropyBits };
}
