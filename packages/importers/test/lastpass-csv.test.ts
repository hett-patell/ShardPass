import { describe, expect, it } from "vitest";

import { importLastPassCsv, parseTypedNote } from "../src/lastpass";

const HEADER = "url,username,password,totp,extra,name,grouping,fav\n";

describe("importLastPassCsv", () => {
  it("imports logins with folders, favourites, one-time codes and notes", () => {
    const csv =
      HEADER +
      'https://example.com/login,alice,pw-1,JBSWY3DPEHPK3PXP,"line one\nline two",Example,Work\\Sites,1\n' +
      "http://,bob,pw-2,,,No site,(none),0\n";
    const result = importLastPassCsv(csv);
    expect(result.items).toHaveLength(2);
    const [first, second] = result.items;
    expect(first).toMatchObject({
      kind: "login",
      name: "Example",
      username: "alice",
      password: "pw-1",
      urls: ["https://example.com/login"],
      totp: "JBSWY3DPEHPK3PXP",
      notes: "line one\nline two",
      favorite: true,
    });
    expect(result.folders?.map((folder) => folder.name)).toEqual(["Work", "Sites"]);
    expect(first?.folderId).toBe(result.folders?.[1]?.id);
    expect(second).toMatchObject({ kind: "login", name: "No site", urls: [], favorite: false });
    expect(second?.folderId).toBeUndefined();
  });

  it("turns secure notes into notes, and typed notes into cards, identities or text", () => {
    const card =
      "NoteType:Credit Card\nLanguage:en-US\nName on Card:Alice Example\nType:Visa\nNumber:4111 1111 1111 1111\nSecurity Code:123\nStart Date:,\nExpiration Date:March,2027\nNotes:Personal card";
    const address =
      'NoteType:Address\nLanguage:en-US\nTitle:Ms\nFirst Name:Alice\nMiddle Name:\nLast Name:Example\nUsername:alice\nGender:\nBirthday:January 2,1990\nCompany:ACME\nAddress 1:1 Main St\nAddress 2:Apt 2\nCity / Town:Springfield\nCounty:\nState:IL\nZip / Postal Code:62701\nCountry:US\nTimezone:\nEmail Address:alice@example.com\nPhone:{"num":"5551234","ext":"","cc":"1"}\nEvening Phone:\nMobile Phone:\nFax:\nNotes:Home';
    const wifi =
      "NoteType:Wi-Fi Password\nSSID:HomeNet\nPassword:hunter2\nNotes:Router in the hall";
    const csv =
      HEADER +
      `http://sn,,,,"${card.replace(/\n/gu, "\n")}",My card,,0\n` +
      `http://sn,,,,"${address}",Home address,,0\n` +
      `http://sn,,,,"${wifi}",Home Wi-Fi,,0\n` +
      'http://sn,,,,"Just some text\nwith two lines",Plain note,,0\n';
    const result = importLastPassCsv(csv);
    expect(result.items.map((item) => item.kind)).toEqual(["card", "identity", "note", "note"]);
    expect(result.items[0]).toMatchObject({
      name: "My card",
      brand: "visa",
      cardholderName: "Alice Example",
      number: "4111111111111111",
      cvv: "123",
      expMonth: "03",
      expYear: "2027",
      notes: "Personal card",
    });
    expect(result.items[1]).toMatchObject({
      name: "Home address",
      firstName: "Alice",
      lastName: "Example",
      username: "alice",
      company: "ACME",
      street: "1 Main St",
      address2: "Apt 2",
      city: "Springfield",
      state: "IL",
      zip: "62701",
      country: "US",
      email: "alice@example.com",
      notes: "Home",
    });
    expect(result.items[2]).toMatchObject({
      name: "Home Wi-Fi",
      content: "Type: Wi-Fi Password\nSSID: HomeNet\nPassword: hunter2\nNotes: Router in the hall",
    });
    expect(result.items[3]).toMatchObject({
      name: "Plain note",
      content: "Just some text\nwith two lines",
    });
  });

  it("keeps everything after Notes: as note text", () => {
    const typed = parseTypedNote(
      "NoteType:Server\nHostname:h\nNotes:first\nsecond: with colon\nthird",
    );
    expect(typed?.type).toBe("Server");
    expect(typed?.fields.get("notes")).toBe("first\nsecond: with colon\nthird");
    expect(parseTypedNote("no type here")).toBeNull();
  });

  it("keeps a login without a password and says so", () => {
    const result = importLastPassCsv(HEADER + "https://a.example,alice,,,,A,,0\n");
    expect(result.items).toHaveLength(1);
    expect(result.warnings).toEqual(['"A": imported without a password (the export has none).']);
  });
});
