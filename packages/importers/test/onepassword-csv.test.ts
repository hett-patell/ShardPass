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
    expect(result.warnings).toEqual([
      '"Empty": imported without a password (the export has none).',
    ]);
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

  it("reads a YYYYMM card expiry as year then month, like the 1PUX importer", () => {
    const result = importOnePasswordCsv(
      ["Title,Type,ccnum,expiry", "Visa,Credit Card,4111111111111111,203012"].join("\n"),
    );
    const [card] = result.items;
    if (card?.kind !== "card") throw new Error("expected card");
    expect(card.expMonth).toBe("12");
    expect(card.expYear).toBe("2030");
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

  it("reads every website from a cell holding several, split on newlines or commas", () => {
    const csv = `Title,Username,Password,URL,Notes
Multi,user,pw,"https://a.example
https://b.example, www.c.example,https://d.example/path?ids=1,2",`;
    const result = importOnePasswordCsv(csv);
    const item = result.items[0];
    if (item?.kind !== "login") throw new Error("expected login");
    expect(item.urls).toEqual([
      "https://a.example",
      "https://b.example",
      "www.c.example",
      "https://d.example/path?ids=1,2",
    ]);
  });

  it("collapses tags that differ only by case", () => {
    const csv = `Title,Username,Password,URL,Tags\nTagged,user,pw,https://t.example,"Work, work; WORK, home"`;
    const result = importOnePasswordCsv(csv);
    expect(result.warnings).toHaveLength(0);
    expect(result.items[0]?.tags).toEqual(["Work", "home"]);
  });

  it("keeps a one-time-code secret only when it can be read", () => {
    const csv = `Title,Username,Password,URL,OTPAuth
Good,user,pw,https://g.example,JBSWY3DPEHPK3PXP
Bad,user,pw,https://b.example,not a secret at all`;
    const result = importOnePasswordCsv(csv);
    const [good, bad] = result.items;
    if (good?.kind !== "login" || bad?.kind !== "login") throw new Error("expected logins");
    expect(good.totp).toBe("JBSWY3DPEHPK3PXP");
    expect(bad.totp).toBeUndefined();
    expect(result.warnings).toEqual([
      '"Bad": the one-time-code secret could not be read and was left out.',
    ]);
  });

  it("keeps more than the URL limit by dropping the extras with a warning", () => {
    const urls = Array.from({ length: 20 }, (_, index) => `https://site${index}.example`).join(
      "\n",
    );
    const csv = `Title,Username,Password,URL,Notes\nMany,user,pw,"${urls}",`;
    const result = importOnePasswordCsv(csv);
    const item = result.items[0];
    if (item?.kind !== "login") throw new Error("expected login");
    expect(item.urls).toHaveLength(16);
    expect(result.warnings).toEqual(['"Many": only the first 16 URLs were kept.']);
  });
});
