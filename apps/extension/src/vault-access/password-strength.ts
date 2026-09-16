/**
 * A rough, honest strength estimate for a master password: how many bits an attacker with
 * the vault file would have to search, from the character classes used and the length,
 * discounted for repeats and for text that is mostly one repeated fragment. Not a substitute
 * for a breach check, and never sent anywhere.
 */
export type StrengthLevel = 0 | 1 | 2 | 3;

export interface PasswordStrength {
  readonly bits: number;
  readonly level: StrengthLevel;
  readonly label: "Too weak" | "Weak" | "Fair" | "Strong";
}

export function passwordStrength(password: string): PasswordStrength {
  const chars = Array.from(password);
  if (chars.length === 0) return { bits: 0, level: 0, label: "Too weak" };
  let pool = 0;
  if (/[a-z]/u.test(password)) pool += 26;
  if (/[A-Z]/u.test(password)) pool += 26;
  if (/\d/u.test(password)) pool += 10;
  if (/[^A-Za-z0-9\s]/u.test(password)) pool += 33;
  if (/\s/u.test(password)) pool += 1;
  if (pool === 0) pool = 10;
  // Distinct characters cap what the length can claim: "aaaaaaaaaaaa" is not twelve choices.
  const distinct = new Set(chars).size;
  const effective = Math.min(chars.length, distinct * 2);
  const bits = effective * Math.log2(pool);
  const level: StrengthLevel = bits < 28 ? 0 : bits < 45 ? 1 : bits < 70 ? 2 : 3;
  return {
    bits: Math.round(bits),
    level,
    label: (["Too weak", "Weak", "Fair", "Strong"] as const)[level],
  };
}
