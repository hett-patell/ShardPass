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
});
