import { describe, expect, it } from "vitest";

import { importNordPassCsv } from "../src/nordpass";

const HEADER =
  "name,url,username,password,note,cardholdername,cardnumber,cvc,expirydate,zipcode,folder,full_name,phone_number,email,address1,address2,city,country,state,type,custom_fields\n";

describe("importNordPassCsv", () => {
  it("sorts rows by the type column and skips folder rows", () => {
    const csv =
      HEADER +
      'Example,https://example.com,alice,pw-1,hello,,,,,,Work,,,,,,,,,password,"[{""type"":""text"",""label"":""Member"",""value"":""42""},{""type"":""hidden"",""label"":""Recovery"",""value"":""abc""}]"\n' +
      "Work,,,,,,,,,,,,,,,,,,,folder,\n" +
      "Visa,,,,,Alice Example,4111111111111111,123,03/27,,,,,,,,,,,credit_card,\n" +
      "Me,,,,,,,,,62701,,Alice Example,5551234,alice@example.com,1 Main St,Apt 2,Springfield,US,IL,identity,\n" +
      "Memo,,,,remember this,,,,,,,,,,,,,,,note,\n";
    const result = importNordPassCsv(csv);
    expect(result.items.map((item) => item.kind)).toEqual(["login", "card", "identity", "note"]);
    expect(result.items[0]).toMatchObject({
      name: "Example",
      username: "alice",
      password: "pw-1",
      notes: "hello",
      customFields: [
        { name: "Member", value: "42", type: "text" },
        { name: "Recovery", value: "abc", type: "hidden" },
      ],
    });
    expect(result.folders?.map((folder) => folder.name)).toEqual(["Work"]);
    expect(result.items[0]?.folderId).toBe(result.folders?.[0]?.id);
    expect(result.items[1]).toMatchObject({
      name: "Visa",
      brand: "visa",
      cardholderName: "Alice Example",
      number: "4111111111111111",
      cvv: "123",
      expMonth: "03",
      expYear: "2027",
    });
    expect(result.items[2]).toMatchObject({
      firstName: "Alice",
      lastName: "Example",
      phone: "5551234",
      email: "alice@example.com",
      street: "1 Main St",
      address2: "Apt 2",
      city: "Springfield",
      country: "US",
      state: "IL",
      zip: "62701",
    });
    expect(result.items[3]).toMatchObject({ name: "Memo", content: "remember this" });
  });

  it("infers the kind from the filled columns when there is no type column", () => {
    const csv =
      "name,url,username,password,note,cardholdername,cardnumber,cvc,expirydate,zipcode,folder,full_name,phone_number,email,address1,address2,city,country,state\n" +
      "Site,https://a.example,alice,pw,,,,,,,,,,,,,,,\n" +
      "Card,,,,,Alice,5555555555554444,999,12/2030,,,,,,,,,,\n" +
      "Note,,,,text only,,,,,,,,,,,,,,\n";
    const result = importNordPassCsv(csv);
    expect(result.items.map((item) => item.kind)).toEqual(["login", "card", "note"]);
    expect(result.items[1]).toMatchObject({ brand: "mastercard", expMonth: "12", expYear: "2030" });
  });
});
