import { describe, expect, it } from "vitest";

import { cardBrandFromNumber } from "../src/card-item";

describe("cardBrandFromNumber", () => {
  it("reads the network off the leading digits and says nothing otherwise", () => {
    expect(cardBrandFromNumber("4111 1111 1111 1111")).toBe("visa");
    expect(cardBrandFromNumber("5105105105105100")).toBe("mastercard");
    expect(cardBrandFromNumber("2223003122003222")).toBe("mastercard");
    expect(cardBrandFromNumber("378282246310005")).toBe("amex");
    expect(cardBrandFromNumber("6011111111111117")).toBe("discover");
    expect(cardBrandFromNumber("3530111333300000")).toBe("jcb");
    expect(cardBrandFromNumber("6200000000000005")).toBe("unionpay");
    expect(cardBrandFromNumber("9999")).toBeUndefined();
    expect(cardBrandFromNumber("41")).toBeUndefined();
    expect(cardBrandFromNumber("")).toBeUndefined();
  });
});
