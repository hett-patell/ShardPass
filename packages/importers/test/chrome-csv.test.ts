import { describe, expect, it } from "vitest";

import { importChromeCsv } from "../src";

describe("importChromeCsv", () => {
  it("parses a standard Chrome password CSV", () => {
    const csv = `name,url,username,password,note
GitHub,https://github.com,user@example.com,hunter2,
AWS Console,https://aws.amazon.com,admin,s3cret,production account`;
    const result = importChromeCsv(csv);
    expect(result.warnings).toHaveLength(0);
    expect(result.items).toHaveLength(2);

    const github = result.items[0]!;
    expect(github.kind).toBe("login");
    if (github.kind !== "login") throw new Error("expected login");
    expect(github.name).toBe("GitHub");
    expect(github.username).toBe("user@example.com");
    expect(github.password).toBe("hunter2");
    expect(github.urls).toContain("https://github.com");
    expect(github.notes).toBe("");
    expect(github.schemaVersion).toBe(2);
    expect(github.revision).toBe(1);
    expect(github.id).toMatch(/^[0-9a-f-]{36}$/u);

    const aws = result.items[1]!;
    if (aws.kind !== "login") throw new Error("expected login");
    expect(aws.notes).toBe("production account");
  });

  it("skips rows with empty password", () => {
    const csv = `name,url,username,password,note\nEmpty,,user,,`;
    const result = importChromeCsv(csv);
    expect(result.items).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Empty");
  });

  it("falls back to the URL when the name column is blank", () => {
    const csv = `name,url,username,password,note\n,https://example.com,user,pw,`;
    const result = importChromeCsv(csv);
    expect(result.items).toHaveLength(1);
    const fallback = result.items[0]!;
    if (fallback.kind !== "login") throw new Error("expected login");
    expect(fallback.name).toBe("https://example.com");
  });

  it("handles quoted fields containing commas", () => {
    const csv = `name,url,username,password,note\n"Acme, Inc.",https://acme.example,user,pw,"note, with comma"`;
    const result = importChromeCsv(csv);
    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    if (item.kind !== "login") throw new Error("expected login");
    expect(item.name).toBe("Acme, Inc.");
    expect(item.notes).toBe("note, with comma");
  });

  it("returns no items for an empty document", () => {
    const result = importChromeCsv("");
    expect(result.items).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("truncates over-long name, username, URL and note instead of dropping the row", () => {
    const csv = `name,url,username,password,note\n${"n".repeat(300)},https://example.test/${"p".repeat(2100)},${"u".repeat(300)},pw,${"x".repeat(9000)}`;
    const result = importChromeCsv(csv);
    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    if (item.kind !== "login") throw new Error("expected login");
    expect(item.name).toHaveLength(256);
    expect(item.username).toHaveLength(256);
    expect(item.urls[0]).toHaveLength(2048);
    expect(item.notes).toHaveLength(8192);
    expect(result.warnings).toHaveLength(4);
    for (const warning of result.warnings) expect(warning).toContain("truncated");
  });

  it("imports a password longer than a login can hold as a secret, keeping the site", () => {
    const key = "-----BEGIN OPENSSH PRIVATE KEY-----\n" + "k".repeat(5000) + "\n-----END OPENSSH PRIVATE KEY-----";
    const csv = `name,url,username,password,note\nDeploy key,https://git.example,deploy,"${key}",`;
    const result = importChromeCsv(csv);
    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    if (item.kind !== "secret") throw new Error("expected secret");
    expect(item.secretType).toBe("ssh_key");
    expect(item.value).toBe(key);
    expect(item.metadata).toEqual({ username: "deploy", url: "https://git.example" });
    expect(result.warnings).toEqual([
      '"Deploy key": the password is longer than a login can hold, so it was imported as a secret.',
    ]);
  });

  it("names the field that failed when a row still cannot be imported", () => {
    const csv = `name,url,username,password,note\nBroken,https://example.test,user\ud800,pw,`;
    const result = importChromeCsv(csv);
    expect(result.items).toHaveLength(0);
    expect(result.warnings).toEqual([
      'Skipped "Broken": invalid login item (username did not pass validation).',
    ]);
  });
});
