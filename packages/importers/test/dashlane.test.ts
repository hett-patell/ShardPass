import { describe, expect, it } from "vitest";

import { importDashlane, DashlaneFormatError } from "../src/dashlane";

const encode = (text: string) => new TextEncoder().encode(text).buffer;

describe("importDashlane", () => {
  it("imports a credentials CSV with extra usernames, categories and one-time secrets", async () => {
    const csv =
      "username,username2,username3,title,password,note,url,category,otpSecret\n" +
      "alice,alice2,,Example,pw-1,a note,https://example.com,Shopping,JBSWY3DPEHPK3PXP\n";
    const result = await importDashlane(encode(csv));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      kind: "login",
      name: "Example",
      username: "alice",
      password: "pw-1",
      notes: "a note",
      urls: ["https://example.com"],
      totp: "JBSWY3DPEHPK3PXP",
      customFields: [{ name: "Username 2", value: "alice2", type: "text" }],
    });
    expect(result.folders?.map((folder) => folder.name)).toEqual(["Shopping"]);
  });

  it("recognises payments, personal info, ids and secure notes by their columns", async () => {
    const payments =
      "type,account_name,account_holder,account_number,bank,cc_number,code,expiration_month,expiration_year,routing_number,country,issuing_bank,note\n" +
      "credit_card,My Visa,Alice Example,,,4111111111111111,123,3,2027,,US,,\n" +
      "bank_account,Checking,Alice Example,12345678,First Bank,,,,,987654,US,,\n";
    const personal =
      "type,title,first_name,middle_name,last_name,login,date_of_birth,place_of_birth,email,email_type,address,country,state,city,zip,phone_number,address_recipient,address_building,address_apartment,address_floor,address_door_code,job_title,url,item_name\n" +
      "name,Ms,Alice,,Example,alice,1990-01-02,,alice@example.com,,1 Main St,US,IL,Springfield,62701,5551234,,,,,,,,Alice\n";
    const ids =
      "type,number,name,issue_date,expiration_date,place_of_issue,state\npassport,X123,Alice Example,2020-01-01,2030-01-01,Springfield,\n";
    const notes = "title,note,category\nMemo,remember this,Personal\n";
    for (const [csv, kind] of [
      [payments, ["card", "note"]],
      [personal, ["identity"]],
      [ids, ["identity"]],
      [notes, ["note"]],
    ] as const) {
      const result = await importDashlane(encode(csv));
      expect(result.items.map((item) => item.kind)).toEqual(kind);
    }
    const cards = await importDashlane(encode(payments));
    expect(cards.items[0]).toMatchObject({
      name: "My Visa",
      brand: "visa",
      cardholderName: "Alice Example",
      number: "4111111111111111",
      cvv: "123",
      expMonth: "03",
      expYear: "2027",
    });
    expect(cards.items[1]).toMatchObject({
      name: "Checking",
      content:
        "Account holder: Alice Example\nAccount number: 12345678\nRouting number: 987654\nBank: First Bank\nCountry: US",
    });
    const identity = await importDashlane(encode(personal));
    expect(identity.items[0]).toMatchObject({
      name: "Alice Example",
      firstName: "Alice",
      lastName: "Example",
      username: "alice",
      birthDate: "1990-01-02",
      email: "alice@example.com",
      street: "1 Main St",
      city: "Springfield",
      zip: "62701",
    });
  });

  it("rejects a file with no Dashlane columns", async () => {
    await expect(importDashlane(encode("a,b\n1,2\n"))).rejects.toBeInstanceOf(DashlaneFormatError);
  });
});

describe("importDashlane personal info and IDs", () => {
  it("folds the one-fact-per-row personal info file into one identity per name row", async () => {
    const csv =
      "type,title,first_name,middle_name,last_name,login,date_of_birth,place_of_birth,email,email_type,item_name,phone_number,address,country,state,city,zip,address_recipient,address_building,address_apartment,address_floor,address_door_code,job_title,url\n" +
      "name,MR,John,,Doe,jdoe,2022-01-30,world,,,,,,,,,,,,,,,,\n" +
      "email,,,,,,,,jdoe@example.com,personal,Johns email,,,,,,,,,,,,,\n" +
      "number,,,,,,,,,,John's number,+49123123123,,,,,,,,,,,,\n" +
      "address,,,,,,,,,,John's home address,,1 some street,de,DE-0-NW,some city,123123,John,1,1,1,123,,\n" +
      "website,,,,,,,,,,Website,,,,,,,,,,,,,website.com\n" +
      "name,Mrs,Jane,,Doe,jane,1990-05-06,earth,,,,,,,,,,,,,,,,\n";
    const result = await importDashlane(encode(csv));
    expect(result.items.map((item) => item.kind)).toEqual(["identity", "identity"]);
    expect(result.items[0]).toMatchObject({
      name: "John Doe",
      firstName: "John",
      lastName: "Doe",
      username: "jdoe",
      birthDate: "2022-01-30",
      email: "jdoe@example.com",
      phone: "+49123123123",
      street: "1 some street, 1",
      address2: "Apt 1, Floor 1",
      city: "some city",
      state: "DE-0-NW",
      zip: "123123",
      country: "de",
    });
    expect((result.items[0] as { notes: string }).notes).toContain("Website: website.com");
    expect((result.items[0] as { notes: string }).notes).toContain("Door code: 123");
    expect(result.items[1]).toMatchObject({
      name: "Jane Doe",
      firstName: "Jane",
      username: "jane",
    });
  });

  it("turns passports, licences and social security numbers into identities, the rest into notes", async () => {
    const csv =
      "type,number,name,issue_date,expiration_date,place_of_issue,state\n" +
      "card,123123123,John Doe,2022-1-30,2032-1-30,,\n" +
      "passport,P123,John Doe,2022-1-30,2032-1-30,somewhere,\n" +
      "license,L456,John Doe,2022-8-10,2022-10-10,,DC\n" +
      "social_security,S789,John Doe,,,,\n" +
      "tax_number,T000,,,,,\n";
    const result = await importDashlane(encode(csv));
    expect(result.items.map((item) => item.kind)).toEqual([
      "note",
      "identity",
      "identity",
      "identity",
      "note",
    ]);
    expect(result.items[1]).toMatchObject({
      name: "Passport – John Doe",
      firstName: "John",
      lastName: "Doe",
      passportNumber: "P123",
    });
    expect((result.items[1] as { notes: string }).notes).toBe(
      "Issued: 2022-1-30\nExpires: 2032-1-30\nPlace of issue: somewhere",
    );
    expect(result.items[2]).toMatchObject({ licenseNumber: "L456" });
    expect(result.items[3]).toMatchObject({ nationalId: "S789" });
    expect(result.items[4]).toMatchObject({ name: "Tax number", content: "Number: T000" });
  });

  it("uses the card's name as the holder when the export leaves the holder empty", async () => {
    const csv =
      "type,account_name,account_holder,cc_number,code,expiration_month,expiration_year,routing_number,account_number,country,issuing_bank\n" +
      "credit_card,John Doe,,41111111111111111,123,01,2023,,,US,\n";
    const result = await importDashlane(encode(csv));
    expect(result.items[0]).toMatchObject({
      kind: "card",
      name: "John Doe",
      cardholderName: "John Doe",
      expMonth: "01",
      expYear: "2023",
    });
  });
});
