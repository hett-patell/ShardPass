/** Little-endian cursor over a KDBX byte stream. Every read is bounds-checked. */
export class ByteReader {
  #offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get offset(): number {
    return this.#offset;
  }

  get remaining(): number {
    return this.bytes.length - this.#offset;
  }

  #require(count: number): void {
    if (count < 0 || this.#offset + count > this.bytes.length)
      throw new KdbxFormatError("File ended in the middle of a structure.");
  }

  u8(): number {
    this.#require(1);
    return this.bytes[this.#offset++]!;
  }

  u16(): number {
    this.#require(2);
    const value = this.bytes[this.#offset]! | (this.bytes[this.#offset + 1]! << 8);
    this.#offset += 2;
    return value;
  }

  u32(): number {
    this.#require(4);
    const value =
      (this.bytes[this.#offset]! |
        (this.bytes[this.#offset + 1]! << 8) |
        (this.bytes[this.#offset + 2]! << 16) |
        (this.bytes[this.#offset + 3]! << 24)) >>>
      0;
    this.#offset += 4;
    return value;
  }

  u64(): bigint {
    this.#require(8);
    let value = 0n;
    for (let index = 7; index >= 0; index -= 1)
      value = (value << 8n) | BigInt(this.bytes[this.#offset + index]!);
    this.#offset += 8;
    return value;
  }

  take(count: number): Uint8Array {
    this.#require(count);
    // Copied rather than subarray'd: callers retain these past the source buffer's life,
    // and a view would keep the whole encrypted file reachable.
    const slice = this.bytes.slice(this.#offset, this.#offset + count);
    this.#offset += count;
    return slice;
  }

  /** Bytes consumed so far, for the header hash and HMAC. */
  consumed(): Uint8Array {
    return this.bytes.slice(0, this.#offset);
  }
}

export class KdbxFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KdbxFormatError";
  }
}

export class KdbxPasswordError extends Error {
  constructor(usedKeyFile = false) {
    super(
      usedKeyFile
        ? "Incorrect master password or key file, or the file is corrupt."
        : "Incorrect master password, or the file is corrupt.",
    );
    this.name = "KdbxPasswordError";
  }
}

export function u64le(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  let rest = value;
  for (let index = 0; index < 8; index += 1) {
    bytes[index] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return bytes;
}

export function u32le(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  // Constant-time: these compare HMAC tags, so an early exit would leak tag position.
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index]! ^ right[index]!;
  return diff === 0;
}

export function formatUuid(bytes: Uint8Array): string {
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Copies into a plain ArrayBuffer for WebCrypto. A Uint8Array view is not assignable to
 * BufferSource under the typed-array generics, and the copy also detaches the value from any
 * larger backing buffer.
 */
export function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const output = new ArrayBuffer(value.byteLength);
  new Uint8Array(output).set(value);
  return output;
}
