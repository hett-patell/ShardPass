const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export type CanonicalBase64Validation =
  | Readonly<{ decodedLength: number; valid: true }>
  | Readonly<{ reason: "noncanonical" | "too-large"; valid: false }>;

export function validateCanonicalBase64(
  value: string,
  maximumDecodedBytes: number,
): CanonicalBase64Validation {
  const maximumEncodedCharacters = Math.ceil(maximumDecodedBytes / 3) * 4;
  if (value.length > maximumEncodedCharacters) return { reason: "too-large", valid: false };

  if (value.length === 0 || value.length % 4 !== 0) {
    return { reason: "noncanonical", valid: false };
  }

  let padding = 0;
  if (value.endsWith("==")) padding = 2;
  else if (value.endsWith("=")) padding = 1;

  const dataLength = value.length - padding;
  for (let index = 0; index < dataLength; index += 1) {
    if (BASE64_ALPHABET.indexOf(value[index] ?? "") < 0) {
      return { reason: "noncanonical", valid: false };
    }
  }
  for (let index = dataLength; index < value.length; index += 1) {
    if (value[index] !== "=") return { reason: "noncanonical", valid: false };
  }

  const decodedLength = (value.length / 4) * 3 - padding;
  if (decodedLength > maximumDecodedBytes) return { reason: "too-large", valid: false };

  const terminalSextet = BASE64_ALPHABET.indexOf(value[dataLength - 1] ?? "");
  if (
    (padding === 2 && (terminalSextet & 0b1111) !== 0) ||
    (padding === 1 && (terminalSextet & 0b11) !== 0)
  ) {
    return { reason: "noncanonical", valid: false };
  }

  return { decodedLength, valid: true };
}
