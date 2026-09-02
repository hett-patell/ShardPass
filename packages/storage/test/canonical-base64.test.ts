import { describe, expect, it } from "vitest";

import { validateCanonicalBase64 } from "../src/canonical-base64";

const base64 = (bytes: number[]): string => Buffer.from(bytes).toString("base64");

describe("bounded canonical Base64 validation", () => {
  it("returns too-large before canonical scanning when the encoded limit is exceeded", () => {
    expect(validateCanonicalBase64("!".repeat(9), 6)).toEqual({
      reason: "too-large",
      valid: false,
    });
  });

  it("accepts canonical input at the exact decoded maximum", () => {
    expect(validateCanonicalBase64(base64([1, 2, 3, 4, 5, 6]), 6)).toEqual({
      decodedLength: 6,
      valid: true,
    });
  });

  it("rejects canonical input whose decoded length exceeds the maximum", () => {
    expect(validateCanonicalBase64(base64([1, 2, 3, 4, 5, 6, 7]), 6)).toEqual({
      reason: "too-large",
      valid: false,
    });
  });

  it.each([
    ["AR==", 1],
    ["AQJ=", 2],
    ["AQ", 1],
    ["AQ=A", 2],
    ["AQ-_", 3],
  ])("rejects noncanonical input %s without decoding allocation", (value, maximumBytes) => {
    expect(validateCanonicalBase64(value, maximumBytes)).toEqual({
      reason: "noncanonical",
      valid: false,
    });
  });
});
