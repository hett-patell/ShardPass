import { describe, expect, it } from "vitest";

import { importProtonPass, importProtonPassCsv, ProtonPassFormatError } from "../src/protonpass";

const encode = (text: string) => new TextEncoder().encode(text).buffer;

describe("importProtonPass", () => {
  it("imports the JSON export: logins, aliases, notes, cards and identities, vaults as folders", async () => {
    const data = {
      version: "1.20.0",
      userId: "u",
      encrypted: false,
      vaults: {
        v1: {
          name: "Personal",
          description: "",
          items: [
            {
              itemId: "1",
              shareId: "s",
              state: 1,
              pinned: true,
              data: {
                metadata: { name: "Example", note: "hello", itemUuid: "a" },
                extraFields: [
                  { fieldName: "Member", type: "text", data: { content: "42" } },
                  { fieldName: "Backup", type: "hidden", data: { content: "xyz" } },
                  { fieldName: "2FA", type: "totp", data: { totpUri: "JBSWY3DPEHPK3PXP" } },
                ],
                type: "login",
                content: {
                  itemEmail: "alice@example.com",
                  itemUsername: "alice",
                  password: "pw-1",
                  urls: ["https://example.com"],
                  totpUri: "",
                  passkeys: [{}],
                },
              },
            },
            {
              itemId: "2",
              shareId: "s",
              state: 2,
              aliasEmail: "hide@simplelogin.com",
              data: {
                metadata: { name: "Alias", note: "", itemUuid: "b" },
                extraFields: [],
                type: "alias",
                content: {},
              },
            },
            {
              itemId: "3",
              shareId: "s",
              state: 1,
              data: {
                metadata: { name: "Memo", note: "text", itemUuid: "c" },
                extraFields: [],
                type: "note",
                content: {},
              },
            },
            {
              itemId: "4",
              shareId: "s",
              state: 1,
              data: {
                metadata: { name: "Visa", note: "", itemUuid: "d" },
                extraFields: [],
                type: "creditCard",
                content: {
                  cardholderName: "Alice",
                  number: "4111111111111111",
                  verificationNumber: "123",
                  expirationDate: "2027-03",
                  pin: "0000",
                  cardType: 0,
                },
              },
            },
            {
              itemId: "5",
              shareId: "s",
              state: 1,
              data: {
                metadata: { name: "Me", note: "", itemUuid: "e" },
                extraFields: [],
                type: "identity",
                content: {
                  fullName: "Alice Example",
                  firstName: "Alice",
                  lastName: "Example",
                  email: "alice@example.com",
                  phoneNumber: "5551234",
                  streetAddress: "1 Main St",
                  city: "Springfield",
                  stateOrProvince: "IL",
                  zipOrPostalCode: "62701",
                  countryOrRegion: "US",
                  socialSecurityNumber: "123-45-6789",
                },
              },
            },
          ],
        },
      },
    };
    const result = await importProtonPass(encode(JSON.stringify(data)));
    expect(result.items.map((item) => item.kind)).toEqual([
      "login",
      "login",
      "note",
      "card",
      "identity",
    ]);
    expect(result.items[0]).toMatchObject({
      name: "Example",
      username: "alice",
      password: "pw-1",
      urls: ["https://example.com"],
      totp: "JBSWY3DPEHPK3PXP",
      favorite: true,
      notes: "hello",
      customFields: [
        { name: "Email", value: "alice@example.com", type: "text" },
        { name: "Member", value: "42", type: "text" },
        { name: "Backup", value: "xyz", type: "hidden" },
      ],
    });
    expect(result.warnings).toContain('"Example": passkey not imported.');
    expect(result.items[1]).toMatchObject({
      name: "Alias",
      username: "hide@simplelogin.com",
      password: "",
    });
    expect(result.items[1]?.archivedAt).toBeDefined();
    expect(result.items[3]).toMatchObject({
      brand: "visa",
      expMonth: "03",
      expYear: "2027",
      pin: "0000",
      cvv: "123",
    });
    expect(result.items[4]).toMatchObject({
      firstName: "Alice",
      lastName: "Example",
      nationalId: "123-45-6789",
      zip: "62701",
    });
    expect(result.folders?.map((folder) => folder.name)).toEqual(["Personal"]);
    expect(result.items.every((item) => item.folderId === result.folders?.[0]?.id)).toBe(true);
  });

  it("refuses an encrypted export and a file without vaults", async () => {
    await expect(importProtonPass(encode('{"encrypted":true,"vaults":{}}'))).rejects.toBeInstanceOf(
      ProtonPassFormatError,
    );
    await expect(importProtonPass(encode('{"nope":1}'))).rejects.toBeInstanceOf(
      ProtonPassFormatError,
    );
  });

  it("imports the CSV export and says what the CSV leaves out", () => {
    const csv =
      "type,name,url,email,username,password,note,totp,vault\n" +
      "login,Example,https://example.com,alice@example.com,alice,pw-1,hi,JBSWY3DPEHPK3PXP,Personal\n" +
      "note,Memo,,,,,text,,Personal\n" +
      "creditCard,Visa,,,,,card note,,Personal\n";
    const result = importProtonPassCsv(csv);
    expect(result.items.map((item) => item.kind)).toEqual(["login", "note", "note"]);
    expect(result.items[0]).toMatchObject({
      username: "alice",
      customFields: [{ name: "Email", value: "alice@example.com", type: "text" }],
      totp: "JBSWY3DPEHPK3PXP",
    });
    expect(result.warnings.some((warning) => warning.includes("export as JSON"))).toBe(true);
  });
});

describe("importProtonPass dedicated and custom items", () => {
  it("keeps custom items as notes with their sections, and identity extras in the notes", async () => {
    const data = {
      version: "1.21.2",
      userId: "u",
      encrypted: false,
      vaults: {
        v: {
          name: "Personal",
          description: "",
          items: [
            {
              itemId: "1",
              shareId: "s",
              state: 1,
              data: {
                metadata: { name: "Test Bank Account", note: "", itemUuid: "a" },
                extraFields: [
                  { fieldName: "Bank name", type: "text", data: { content: "Bank of the Shire" } },
                  { fieldName: "Account number", type: "hidden", data: { content: "123456" } },
                  { fieldName: "Opened", type: "timestamp", data: { timestamp: "2951-06-19" } },
                ],
                type: "custom",
                content: {
                  sections: [
                    {
                      sectionName: "Branch",
                      sectionFields: [
                        { fieldName: "Town", type: "text", data: { content: "Bree" } },
                      ],
                    },
                  ],
                },
              },
            },
            {
              itemId: "2",
              shareId: "s",
              state: 1,
              data: {
                metadata: { name: "Me", note: "", itemUuid: "b" },
                extraFields: [],
                type: "identity",
                content: {
                  fullName: "Test 1",
                  firstName: "Test",
                  lastName: "Test",
                  email: "test@example.com",
                  gender: "Male",
                  jobTitle: "Engineer",
                  xHandle: "@twitter",
                  extraPersonalDetails: [
                    { fieldName: "TestPersonal", type: "text", data: { content: "Personal" } },
                  ],
                  extraSections: [
                    {
                      sectionName: "TestSection",
                      sectionFields: [
                        { fieldName: "Field", type: "hidden", data: { content: "Section" } },
                      ],
                    },
                  ],
                },
              },
            },
            {
              itemId: "3",
              shareId: "s",
              state: 1,
              data: {
                metadata: { name: "Home Wi-Fi", note: "", itemUuid: "c" },
                extraFields: [],
                type: "wifi",
                content: { ssid: "HomeNet", password: "hunter2", security: "WPA2" },
              },
            },
          ],
        },
      },
    };
    const result = await importProtonPass(encode(JSON.stringify(data)));
    expect(result.items.map((item) => item.kind)).toEqual(["note", "identity", "login"]);
    expect(result.items[0]).toMatchObject({
      name: "Test Bank Account",
      content:
        "Branch:\nTown: Bree\nBank name: Bank of the Shire\nAccount number: 123456\nOpened: 2951-06-19",
    });
    expect((result.items[1] as { notes: string }).notes).toBe(
      "Gender: Male\nX: @twitter\nJob title: Engineer\nTestPersonal: Personal\nTestSection:\nField: Section",
    );
    expect(result.items[2]).toMatchObject({
      username: "HomeNet",
      password: "hunter2",
      notes: "Security: WPA2",
    });
    expect(result.warnings).toEqual([]);
  });
});
