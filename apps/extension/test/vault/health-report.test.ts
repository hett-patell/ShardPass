import type { LoginItem } from "@shardpass/domain";
import { describe, expect, it } from "vitest";

import { computeHealth } from "../../src/vault/health/health-report";

let counter = 0;
const login = (overrides: Partial<LoginItem>): LoginItem => ({
  id: `10000000-0000-4000-8000-0000000000${String(++counter).padStart(2, "0")}`,
  schemaVersion: 2,
  revision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  favorite: false,
  tags: [],
  kind: "login",
  name: "Site",
  username: "me",
  password: "unique-" + counter,
  urls: ["https://site.test"],
  notes: "",
  ...overrides,
});

describe("computeHealth", () => {
  it("groups shared passwords, flags plain http sites and logins with no second factor, and counts withheld ones", () => {
    const shared1 = login({ name: "A", password: "same" });
    const shared2 = login({ name: "B", password: "same" });
    const plain = login({ name: "C", urls: ["http://old.test/login"] });
    const withCode = login({ name: "D", totp: "JBSWY3DPEHPK3PXP" });
    const linked = login({ name: "E", linkedOtpId: "10000000-0000-4000-8000-0000000000ff" });
    const provider = login({ name: "F", password: "", signInWith: "google" });
    const archived = login({ name: "G", password: "same", archivedAt: "2026-02-01T00:00:00.000Z" });
    const withheld = login({ name: "H", password: "" });
    const report = computeHealth(
      [shared1, shared2, plain, withCode, linked, provider, archived, withheld],
      new Set([withheld.id]),
    );
    expect(report.logins.map((item) => item.name)).toEqual(["A", "B", "C", "D", "E"]);
    expect(report.reused.map((group) => group.logins.map((item) => item.name))).toEqual([
      ["A", "B"],
    ]);
    expect(report.unsecured.map((item) => item.name)).toEqual(["C"]);
    expect(report.withoutTwoFactor.map((item) => item.name)).toEqual(["A", "B", "C"]);
    expect(report.skipped).toBe(1);
  });
});
