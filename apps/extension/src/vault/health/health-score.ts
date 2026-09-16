export interface HealthScoreInput {
  /** Logins with a password. */
  logins: number;
  weak: number;
  reused: number;
  breached: number;
  unsecured: number;
  withoutTwoFactor: number;
}

export interface HealthScore {
  /** 0 to 100; 100 when nothing is wrong or there is nothing to judge. */
  score: number;
  caption: string;
}

/**
 * One number for the vault: each finding costs a share of the logins it touches, weighted
 * by how much it matters (a breached password most, a missing second factor least). A
 * vault with no password logins scores 100, since there is nothing to fix.
 */
export function computeHealthScore(input: HealthScoreInput): HealthScore {
  if (input.logins <= 0) return { score: 100, caption: "Nothing to judge yet" };
  const penalty =
    input.breached * 1 +
    input.weak * 0.7 +
    input.reused * 0.6 +
    input.unsecured * 0.3 +
    input.withoutTwoFactor * 0.1;
  const score = Math.max(0, Math.min(100, Math.round(100 - (100 * penalty) / input.logins)));
  const caption =
    score >= 90 ? "Excellent" : score >= 80 ? "Good" : score >= 50 ? "Needs attention" : "At risk";
  return { score, caption };
}
