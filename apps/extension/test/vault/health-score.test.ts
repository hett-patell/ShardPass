import { describe, expect, it } from "vitest";

import { computeHealthScore } from "../../src/vault/health/health-score";

describe("computeHealthScore", () => {
  it("is 100 with nothing to judge or nothing wrong, and falls with weighted findings", () => {
    const clean = { logins: 0, weak: 0, reused: 0, breached: 0, unsecured: 0, withoutTwoFactor: 0 };
    expect(computeHealthScore(clean)).toEqual({ score: 100, caption: "Nothing to judge yet" });
    expect(computeHealthScore({ ...clean, logins: 10 })).toEqual({
      score: 100,
      caption: "Excellent",
    });
    expect(computeHealthScore({ ...clean, logins: 10, withoutTwoFactor: 10 }).score).toBe(90);
    expect(computeHealthScore({ ...clean, logins: 10, reused: 4 }).score).toBe(76);
    expect(computeHealthScore({ ...clean, logins: 10, breached: 6 })).toEqual({
      score: 40,
      caption: "At risk",
    });
    expect(computeHealthScore({ ...clean, logins: 2, breached: 2, weak: 2, reused: 2 }).score).toBe(
      0,
    );
  });
});
