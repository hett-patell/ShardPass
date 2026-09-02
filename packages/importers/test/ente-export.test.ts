import { describe, expect, it } from "vitest";

import { parseEnteExport, parseOtpImportText } from "../src";

const documentedWrapper = {
  version: 1,
  kdfParams: { memLimit: 4096, opsLimit: 3, salt: "synthetic-salt" },
  encryptedData: "synthetic-encrypted-data",
  encryptionNonce: "synthetic-nonce",
};
const secret = "GEZDGNBVGY3TQOJQ";
const plaintext = [
  `otpauth://totp/Example%3AAccount?secret=${secret}&issuer=Example`,
  `otpauth://hotp/Example%3ACounter?secret=${secret}&issuer=Example&counter=0`,
].join("\n");

const fixedFailure = (operation: () => unknown, code: string) => {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as Error).message).toBe(code);
  expect((thrown as Error).message).not.toContain("synthetic-");
};

describe("documented Ente Auth export compatibility", () => {
  it("recognizes the strict version-1 encrypted wrapper and refuses decryption", () => {
    fixedFailure(() => parseEnteExport(JSON.stringify(documentedWrapper)), "IMPORT_UNSUPPORTED");
    fixedFailure(() => parseOtpImportText(JSON.stringify(documentedWrapper)), "IMPORT_UNSUPPORTED");
  });

  it("routes documented decrypted newline plaintext through otpauth parsing", () => {
    expect(parseOtpImportText(plaintext)).toEqual({
      format: "otpauth",
      candidates: [
        expect.objectContaining({ otpType: "totp", issuer: "Example", label: "Account" }),
        expect.objectContaining({
          otpType: "hotp",
          issuer: "Example",
          label: "Counter",
          counter: 0,
        }),
      ],
      rejected: [],
    });
  });

  it("rejects the previously invented typed entries envelope", () => {
    fixedFailure(
      () =>
        parseEnteExport(
          JSON.stringify({
            format: "ente-auth-export",
            version: 1,
            entries: [
              {
                type: "otp",
                otpType: "totp",
                issuer: "Example",
                label: "Account",
                secret,
                algorithm: "SHA1",
                digits: 6,
                period: 30,
              },
            ],
          }),
        ),
      "IMPORT_UNSUPPORTED",
    );
  });

  it.each([
    ["unknown wrapper version", { ...documentedWrapper, version: 2 }],
    ["missing KDF field", { ...documentedWrapper, kdfParams: { memLimit: 4096, salt: "salt" } }],
    ["unknown envelope field", { ...documentedWrapper, authToken: "token" }],
    [
      "sync credentials",
      { ...documentedWrapper, email: "user@example.test", serverUrl: "https://example.test" },
    ],
    ["fractional KDF number", undefined],
    ["exponent KDF number", undefined],
    ["unsafe KDF number", undefined],
  ])("rejects %s with a fixed safe result", (name, candidate) => {
    const text =
      name === "fractional KDF number"
        ? '{"version":1,"kdfParams":{"memLimit":4096.0,"opsLimit":3,"salt":"salt"},"encryptedData":"data","encryptionNonce":"nonce"}'
        : name === "exponent KDF number"
          ? '{"version":1,"kdfParams":{"memLimit":4096,"opsLimit":3e0,"salt":"salt"},"encryptedData":"data","encryptionNonce":"nonce"}'
          : name === "unsafe KDF number"
            ? '{"version":1,"kdfParams":{"memLimit":9007199254740993,"opsLimit":3,"salt":"salt"},"encryptedData":"data","encryptionNonce":"nonce"}'
            : JSON.stringify(candidate);
    fixedFailure(() => parseEnteExport(text), "IMPORT_UNSUPPORTED");
  });
});
