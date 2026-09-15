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
      [ids, ["note"]],
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
      name: "Alice",
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
