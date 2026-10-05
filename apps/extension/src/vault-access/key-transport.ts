/** A derived key travels to the background as canonical Base64; these are the two directions. */
export function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export function encodeBase64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}
