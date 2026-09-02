const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

export function decodeCanonicalBase64(
  value: string,
  minimumBytes: number,
  maximumBytes: number,
): Uint8Array | null {
  if (
    !Number.isSafeInteger(minimumBytes) ||
    !Number.isSafeInteger(maximumBytes) ||
    minimumBytes < 0 ||
    maximumBytes < minimumBytes ||
    value.length === 0 ||
    value.length > Math.ceil(maximumBytes / 3) * 4 ||
    value.length % 4 !== 0 ||
    !BASE64_PATTERN.test(value)
  )
    return null;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const decodedLength = (value.length / 4) * 3 - padding;
  if (decodedLength < minimumBytes || decodedLength > maximumBytes) return null;
  let decoded: Uint8Array;
  try {
    decoded = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
  if (encodeBase64(decoded) !== value) {
    decoded.fill(0);
    return null;
  }
  return decoded;
}

export function isCanonicalBase64(
  value: string,
  minimumBytes: number,
  maximumBytes: number,
): boolean {
  const decoded = decodeCanonicalBase64(value, minimumBytes, maximumBytes);
  if (decoded === null) return false;
  decoded.fill(0);
  return true;
}

function encodeBase64(value: Uint8Array): string {
  const chunks: string[] = [];
  const chunkBytes = 32_768;
  for (let offset = 0; offset < value.byteLength; offset += chunkBytes)
    chunks.push(String.fromCharCode(...value.subarray(offset, offset + chunkBytes)));
  return btoa(chunks.join(""));
}
