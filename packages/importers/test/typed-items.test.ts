import { describe, expect, it } from "vitest";

import { cardBrand, splitExpiry, twoDigitMonth } from "../src/common/typed-items";

describe("typed item helpers", () => {
  it("reads the expiry forms exports use", () => {
    expect(splitExpiry("03/27")).toEqual({ expMonth: "03", expYear: "2027" });
    expect(splitExpiry("3/2027")).toEqual({ expMonth: "03", expYear: "2027" });
    expect(splitExpiry("2027-03")).toEqual({ expMonth: "03", expYear: "2027" });
    expect(splitExpiry("03-2027")).toEqual({ expMonth: "03", expYear: "2027" });
    expect(splitExpiry("March,2027")).toEqual({ expMonth: "03", expYear: "2027" });
    expect(splitExpiry("0327")).toEqual({ expMonth: "03", expYear: "2027" });
    expect(splitExpiry("2027")).toEqual({ expMonth: "", expYear: "2027" });
    expect(splitExpiry("")).toEqual({ expMonth: "", expYear: "" });
    expect(twoDigitMonth("Dec")).toBe("12");
    expect(twoDigitMonth("13")).toBe("13");
  });

  it("names the brand from the export or the number", () => {
    expect(cardBrand("Visa", "")).toBe("visa");
    expect(cardBrand("American Express", "")).toBe("amex");
    expect(cardBrand("", "5105105105105100")).toBe("mastercard");
    expect(cardBrand("", "378282246310005")).toBe("amex");
    expect(cardBrand("", "6011111111111117")).toBe("discover");
    expect(cardBrand("", "")).toBeUndefined();
    expect(cardBrand("Store card", "9999")).toBe("other");
  });
});
