/**
 * A strong password for a sign-up form, made here in the page's isolated world with the
 * browser's own randomness. Deliberately not the vault's generator: that would pull the whole
 * crypto package into every page for one small job. Twenty characters, every class present,
 * look-alikes left out, shuffled so class membership does not leak position.
 */
const CLASSES = [
  "ABCDEFGHJKLMNPQRSTUVWXYZ",
  "abcdefghijkmnopqrstuvwxyz",
  "23456789",
  "!@#$%^&*-_=+?",
] as const;

function pick(alphabet: string, random: Uint32Array, index: number): string {
  return alphabet.charAt(random[index]! % alphabet.length);
}

export function suggestPassword(length = 20): string {
  const random = new Uint32Array(length * 2);
  crypto.getRandomValues(random);
  const pool = CLASSES.join("");
  const characters: string[] = CLASSES.map((alphabet, index) => pick(alphabet, random, index));
  for (let index = characters.length; index < length; index += 1)
    characters.push(pick(pool, random, index));
  // Fisher-Yates with the second half of the randomness.
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = random[length + index]! % (index + 1);
    [characters[index], characters[swap]] = [characters[swap]!, characters[index]!];
  }
  return characters.join("");
}
