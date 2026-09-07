import { describe, expect, it } from "vitest";

import { importOnePasswordCsv } from "../src";

describe("importOnePasswordCsv", () => {
  it("parses the common login export (Title, Username, Password, URL, Notes)", () => {
    const csv = `Title,Username,Password,URL,Notes
GitHub,user@example.com,hunter2,https://github.com,personal account
AWS Console,admin,s3cret,https://aws.amazon.com,`;
    const result = importOnePasswordCsv(csv);
    expect(result.warnings).toHaveLength(0);
    expect(result.items).toHaveLength(2);

    const github = result.items[0]!;
    expect(github.kind).toBe("login");
    if (github.kind !== "login") throw new Error("expected login");
    expect(github.name).toBe("GitHub");
    expect(github.username).toBe("user@example.com");
    expect(github.password).toBe("hunter2");
    expect(github.urls).toEqual(["https://github.com"]);
    expect(github.notes).toBe("personal account");
  });

  it("keeps a login without a password and says so", () => {
    const csv = `Title,Username,Password,URL,Notes\nEmpty,user,,https://example.com,`;
    const result = importOnePasswordCsv(csv);
    expect(result.items).toHaveLength(1);
    expect(result.warnings).toEqual(['"Empty": imported without a password (the export has none).']);
  });

  it("reads the columns 1Password 8 writes: OTPAuth, Favorite, Archived and Tags", () => {
    const csv = `Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes
GitHub,https://github.com,octo,pw,otpauth://totp/GitHub:octo?secret=JBSWY3DPEHPK3PXP&issuer=GitHub,true,false,"work, code",
Old site,https://old.example,me,pw2,,false,true,,gone`;
    const result = importOnePasswordCsv(csv);
    expect(result.warnings).toHaveLength(0);
    const [github, old] = result.items;
    if (github?.kind !== "login" || old?.kind !== "login") throw new Error("expected logins");
    expect(github.totp).toBe("otpauth://totp/GitHub:octo?secret=JBSWY3DPEHPK3PXP&issuer=GitHub");
    expect(github.favorite).toBe(true);
    expect(github.tags).toEqual(["work", "code"]);
    expect(github.archivedAt).toBeUndefined();
    expect(old.archivedAt).toBeDefined();
    expect(old.favorite).toBe(false);
  });

  it("matches header names case-insensitively", () => {
    const csv = `title,username,password,url,notes\nGitLab,user,pw,https://gitlab.com,`;
    const result = importOnePasswordCsv(csv);
    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    if (item.kind !== "login") throw new Error("expected login");
    expect(item.name).toBe("GitLab");
  });

  it("routes rows by the Type column to note, card, and identity kinds", () => {
    const csv = [
      "Title,Type,Username,Password,URL,Notes,cardholder name,ccnum,cvv,expiry,first name,last name,email",
      "Recovery codes,Secure Note,,,,backup codes,,,,,,,",
      "Personal Visa,Credit Card,,,,,John Doe,4111111111111111,123,122030,,,",
      "Home,Identity,,,,,,,,,John,Doe,john@example.com",
    ].join("\n");
    const result = importOnePasswordCsv(csv);
    expect(result.warnings).toHaveLength(0);
    expect(result.items).toHaveLength(3);

    const [note, card, identity] = result.items;
    expect(note!.kind).toBe("note");
    if (note!.kind !== "note") throw new Error("expected note");
    expect(note!.content).toBe("backup codes");

    expect(card!.kind).toBe("card");
    if (card!.kind !== "card") throw new Error("expected card");
    expect(card!.cardholderName).toBe("John Doe");
    expect(card!.number).toBe("4111111111111111");
    expect(card!.expMonth).toBe("12");
    expect(card!.expYear).toBe("2030");

    expect(identity!.kind).toBe("identity");
    if (identity!.kind !== "identity") throw new Error("expected identity");
    expect(identity!.firstName).toBe("John");
    expect(identity!.lastName).toBe("Doe");
    expect(identity!.email).toBe("john@example.com");
  });

  it("returns no items for an empty document", () => {
    const result = importOnePasswordCsv("");
    expect(result.items).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});
