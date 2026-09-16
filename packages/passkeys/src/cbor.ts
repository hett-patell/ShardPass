/**
 * The subset of CBOR (RFC 8949) WebAuthn needs: unsigned and negative integers, byte
 * strings, text strings, arrays, and maps. Maps are written in canonical order (shorter
 * encoded key first, then bytewise), which is what relying parties expect for COSE keys.
 */
export type CborValue =
  | number
  | string
  | boolean
  | null
  | Uint8Array
  | readonly CborValue[]
  | ReadonlyMap<number | string, CborValue>
  | { readonly [key: string]: CborValue };

function header(major: number, length: number): number[] {
  if (length < 24) return [(major << 5) | length];
  if (length < 0x100) return [(major << 5) | 24, length];
  if (length < 0x10000) return [(major << 5) | 25, length >> 8, length & 0xff];
  if (length < 0x1_0000_0000)
    return [
      (major << 5) | 26,
      (length >>> 24) & 0xff,
      (length >>> 16) & 0xff,
      (length >>> 8) & 0xff,
      length & 0xff,
    ];
  throw new RangeError("CBOR length too large");
}

function encodeInto(value: CborValue, out: number[]): void {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("CBOR integers only");
    if (value >= 0) out.push(...header(0, value));
    else out.push(...header(1, -1 - value));
    return;
  }
  if (typeof value === "boolean") {
    out.push(value ? 0xf5 : 0xf4);
    return;
  }
  if (value === null) {
    out.push(0xf6);
    return;
  }
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    out.push(...header(3, bytes.byteLength), ...bytes);
    return;
  }
  if (value instanceof Uint8Array) {
    out.push(...header(2, value.byteLength), ...value);
    return;
  }
  if (Array.isArray(value)) {
    const list = value as readonly CborValue[];
    out.push(...header(4, list.length));
    for (const entry of list) encodeInto(entry, out);
    return;
  }
  const entries: [number | string, CborValue][] =
    value instanceof Map
      ? [...(value as ReadonlyMap<number | string, CborValue>).entries()]
      : Object.entries(value as { readonly [key: string]: CborValue });
  const encodedKeys = entries.map(([key, entry]) => {
    const keyBytes: number[] = [];
    encodeInto(key, keyBytes);
    return { keyBytes, entry };
  });
  encodedKeys.sort((left, right) => {
    if (left.keyBytes.length !== right.keyBytes.length)
      return left.keyBytes.length - right.keyBytes.length;
    for (let index = 0; index < left.keyBytes.length; index += 1) {
      const difference = left.keyBytes[index]! - right.keyBytes[index]!;
      if (difference !== 0) return difference;
    }
    return 0;
  });
  out.push(...header(5, encodedKeys.length));
  for (const { keyBytes, entry } of encodedKeys) {
    out.push(...keyBytes);
    encodeInto(entry, out);
  }
}

export function encodeCbor(value: CborValue): Uint8Array {
  const out: number[] = [];
  encodeInto(value, out);
  return Uint8Array.from(out);
}
