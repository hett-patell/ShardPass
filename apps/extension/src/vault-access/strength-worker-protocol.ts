/** One estimate per message; the worker answers with the same id. */
export type StrengthWorkerRequest = Readonly<{
  version: 1;
  kind: "estimate";
  id: number;
  password: string;
  /** Words an attacker would try first for this vault: the product name, the person's email. */
  userInputs: readonly string[];
}>;

export type StrengthWorkerResponse = Readonly<{
  version: 1;
  kind: "estimate";
  id: number;
  /** zxcvbn's 0 (guessable in seconds) to 4 (out of reach). */
  score: 0 | 1 | 2 | 3 | 4;
  guessesLog10: number;
  crackTime: string;
  warning: string;
  suggestions: readonly string[];
}>;
