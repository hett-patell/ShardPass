import { describe, expect, it } from "vitest";

import { guessCsvMapping, importGenericCsv, readCsvHeaders } from "../src/generic";

describe("generic CSV import", () => {
  it("guesses a mapping from header names without letting name claim username", () => {
    const headers = readCsvHeaders("Account,Login URL,User Name,Pass,Comments,2FA code,Group\n");
    expect(guessCsvMapping(headers)).toEqual({
      name: "Account",
      url: "Login URL",
      username: "User Name",
      password: "Pass",
      notes: "Comments",
      totp: "2FA code",
      folder: "Group",
    });
    expect(guessCsvMapping(["username", "name"])).toEqual({ name: "name", username: "username" });
  });

  it("imports only the mapped columns, with folders and fallback names", () => {
    const csv = "a,b,c,d\nhttps://example.com/x,alice,pw-1,Sites/Work\n,bob,,\n,,,Misc\n";
    const result = importGenericCsv(csv, { url: "a", username: "b", password: "c", folder: "d" });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      name: "example.com",
      username: "alice",
      password: "pw-1",
      urls: ["https://example.com/x"],
      notes: "",
    });
    expect(result.folders?.map((folder) => folder.name)).toEqual(["Sites", "Work"]);
    expect(result.items[1]).toMatchObject({ name: "bob", username: "bob", password: "" });
    expect(result.warnings).toEqual([
      '"bob": imported without a password (the file has none).',
      'Skipped "unnamed": no password and no username.',
    ]);
  });

  it("refuses a mapping with neither password nor username", () => {
    const result = importGenericCsv("a\n1\n", { name: "a" });
    expect(result.items).toEqual([]);
    expect(result.warnings[0]).toMatch(/No password or username column/u);
  });
});
