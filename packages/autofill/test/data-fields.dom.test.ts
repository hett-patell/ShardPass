import { beforeEach, describe, expect, it } from "vitest";

import { detectCardFields, detectIdentityFields } from "../src/detect-data-fields";
import { fillCardFields, fillIdentityFields } from "../src/fill-data-fields";

describe("card and identity fields", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("finds card fields by autocomplete or wording, fills them, and picks select options for the expiry", () => {
    document.body.innerHTML = `
      <form>
        <input id="num" autocomplete="cc-number" />
        <div><label>Name on card</label><input id="holder" type="text" /></div>
        <select id="mm"><option value="">MM</option><option value="1">01</option><option value="12">12</option></select>
        <select id="yy"><option value="">YY</option><option value="29">29</option><option value="30">30</option></select>
        <div><span>Security code</span><input id="cvc" type="tel" /></div>
      </form>
    `;
    const fields = detectCardFields(document);
    expect(fields.map((field) => field.kind)).toEqual([
      "number",
      "name",
      "expMonth",
      "expYear",
      "cvv",
    ]);
    expect(
      fillCardFields(fields, {
        number: "4111 1111 1111 1111",
        cardholderName: "A Person",
        expMonth: "12",
        expYear: "2030",
        cvv: "123",
      }),
    ).toBe(5);
    expect((document.getElementById("num") as HTMLInputElement).value).toBe("4111111111111111");
    expect((document.getElementById("holder") as HTMLInputElement).value).toBe("A Person");
    expect((document.getElementById("mm") as HTMLSelectElement).value).toBe("12");
    expect((document.getElementById("yy") as HTMLSelectElement).value).toBe("30");
    expect((document.getElementById("cvc") as HTMLInputElement).value).toBe("123");
  });

  it("writes a combined expiry in the page's format, and finds identity fields with full-name and address handling", () => {
    document.body.innerHTML = `
      <form>
        <input id="exp" placeholder="MM/YY" maxlength="5" />
        <input id="full" autocomplete="name" />
        <div><label>Email</label><input id="mail" type="email" /></div>
        <div><label>Street address</label><input id="street" /></div>
        <div><label>Apt, suite</label><input id="apt" /></div>
        <div><label>City</label><input id="city" /></div>
        <select id="state"><option value="">Choose</option><option value="CA">California</option><option value="NY">New York</option></select>
        <div><label>ZIP</label><input id="zip" /></div>
      </form>
    `;
    const card = detectCardFields(document);
    expect(card.map((field) => field.kind)).toEqual(["exp"]);
    fillCardFields(card, {
      number: "",
      cardholderName: "",
      expMonth: "3",
      expYear: "2031",
      cvv: "",
    });
    expect((document.getElementById("exp") as HTMLInputElement).value).toBe("03/31");

    const identity = detectIdentityFields(document);
    expect(identity.map((field) => field.kind)).toEqual([
      "fullName",
      "email",
      "street",
      "address2",
      "city",
      "state",
      "zip",
    ]);
    fillIdentityFields(identity, {
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.test",
      phone: "",
      street: "1 Analytical Way",
      address2: "Apt 2",
      city: "London",
      state: "New York",
      zip: "10001",
      country: "US",
    });
    expect((document.getElementById("full") as HTMLInputElement).value).toBe("Ada Lovelace");
    expect((document.getElementById("state") as HTMLSelectElement).value).toBe("NY");
    expect((document.getElementById("apt") as HTMLInputElement).value).toBe("Apt 2");
  });
});
