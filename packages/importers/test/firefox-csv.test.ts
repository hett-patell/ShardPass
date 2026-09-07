import { describe, expect, it } from "vitest";

import { importFirefoxCsv } from "../src";

const HEADER =
  "url,username,password,httpRealm,formActionOrigin,guid,timeCreated,timeLastUsed,timePasswordChanged";

describe("importFirefoxCsv", () => {
  it("parses a standard Firefox logins CSV", () => {
    const csv = `${HEADER}
https://github.com,user@example.com,hunter2,,https://github.com,{guid-1},1700000000000,1700000100000,1700000200000`;
    const result = importFirefoxCsv(csv);
    expect(result.warnings).toHaveLength(0);
    expect(result.items).toHaveLength(1);

    const item = result.items[0]!;
    expect(item.kind).toBe("login");
    if (item.kind !== "login") throw new Error("expected login");
    expect(item.name).toBe("github.com");
    expect(item.username).toBe("user@example.com");
    expect(item.password).toBe("hunter2");
    expect(item.urls).toContain("https://github.com");
    expect(item.createdAt).toBe(new Date(1700000000000).toISOString());
    expect(item.updatedAt).toBe(new Date(1700000200000).toISOString());
  });

  it("skips rows with empty password", () => {
    const csv = `${HEADER}\nhttps://example.com,user,,,https://example.com,{guid-2},,,`;
    const result = importFirefoxCsv(csv);
    expect(result.items).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
  });

  it("falls back to the current time when timestamps are missing or invalid", () => {
    const csv = `${HEADER}\nhttps://example.com,user,pw,,https://example.com,{guid-3},not-a-number,,`;
    const before = Date.now();
    const result = importFirefoxCsv(csv);
    const after = Date.now();
    expect(result.items).toHaveLength(1);
    const createdAtMs = new Date(result.items[0]!.createdAt).getTime();
    expect(createdAtMs).toBeGreaterThanOrEqual(before);
    expect(createdAtMs).toBeLessThanOrEqual(after);
  });

  it("falls back to the raw URL as the name when it cannot be parsed as a URL", () => {
    const csv = `${HEADER}\nnot-a-valid-url,user,pw,,,{guid-4},,,`;
    const result = importFirefoxCsv(csv);
    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    if (item.kind !== "login") throw new Error("expected login");
    expect(item.name).toBe("not-a-valid-url");
  });

  it("truncates an over-long username rather than dropping the login", () => {
    const csv = `${HEADER}\nhttps://example.com,${"u".repeat(300)},pw,,,{guid-5},,,`;
    const result = importFirefoxCsv(csv);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.kind === "login" && result.items[0].username).toHaveLength(256);
    expect(result.warnings).toEqual([
      '"https://example.com": username was longer than 256 characters and was truncated.',
    ]);
  });

  it("routes a password longer than the login limit to a secret with the timestamps kept", () => {
    const csv = `${HEADER}\nhttps://example.com,user,${"p".repeat(4097)},,,{guid-6},1700000000000,,`;
    const result = importFirefoxCsv(csv);
    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    expect(item.kind).toBe("secret");
    expect(item.createdAt).toBe(new Date(1700000000000).toISOString());
  });
});
