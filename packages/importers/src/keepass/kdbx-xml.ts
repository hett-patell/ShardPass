import { chacha20 } from "@noble/ciphers/chacha.js";
import { salsa20 } from "@noble/ciphers/salsa.js";

import { KdbxFormatError, toArrayBuffer } from "./kdbx-binary";

/** Minimal XML element tree. Deliberately not a DOM: this must run inside a Worker. */
export type XmlNode = Readonly<{
  name: string;
  attributes: ReadonlyMap<string, string>;
  children: readonly XmlNode[];
  text: string;
}>;

const NAMED_ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

function decodeEntities(input: string): string {
  if (!input.includes("&")) return input;
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/gu, (match, body: string) => {
    if (body.startsWith("#")) {
      const codePoint = body.startsWith("#x")
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    return NAMED_ENTITIES.get(body) ?? match;
  });
}

/**
 * Parses the subset of XML that KeePass emits: elements, attributes, text, CDATA, comments
 * and the five predefined entities. Anything exotic (DOCTYPE, processing instructions beyond
 * the declaration, namespaces) is skipped rather than interpreted, and external entities are
 * never resolved, so a hostile database cannot reach the filesystem or network through here.
 */
export function parseXml(source: string): XmlNode {
  let at = 0;
  const stack: { name: string; attributes: Map<string, string>; children: XmlNode[]; text: string }[] = [];
  let root: XmlNode | undefined;

  const fail = (why: string): never => {
    throw new KdbxFormatError(`Malformed database XML: ${why}.`);
  };

  while (at < source.length) {
    const open = source.indexOf("<", at);
    if (open === -1) break;
    if (open > at && stack.length > 0) stack[stack.length - 1]!.text += decodeEntities(source.slice(at, open));

    if (source.startsWith("<!--", open)) {
      const end = source.indexOf("-->", open);
      at = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", open)) {
      const end = source.indexOf("]]>", open);
      if (end === -1) fail("unterminated CDATA");
      if (stack.length > 0) stack[stack.length - 1]!.text += source.slice(open + 9, end);
      at = end + 3;
      continue;
    }
    if (source.startsWith("<?", open) || source.startsWith("<!", open)) {
      const end = source.indexOf(">", open);
      at = end === -1 ? source.length : end + 1;
      continue;
    }

    const close = source.indexOf(">", open);
    if (close === -1) fail("unterminated tag");
    const inner = source.slice(open + 1, close);

    if (inner.startsWith("/")) {
      const node = stack.pop();
      if (node === undefined) fail("unbalanced closing tag");
      const finished: XmlNode = {
        name: node!.name,
        attributes: node!.attributes,
        children: node!.children,
        text: node!.text,
      };
      if (stack.length === 0) root = finished;
      else stack[stack.length - 1]!.children.push(finished);
      at = close + 1;
      continue;
    }

    const selfClosing = inner.endsWith("/");
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const nameMatch = /^([^\s/>]+)/u.exec(body);
    if (nameMatch === null) fail("tag without a name");
    const name = nameMatch![1]!;
    const attributes = new Map<string, string>();
    const attributePattern = /([^\s=]+)\s*=\s*"([^"]*)"|([^\s=]+)\s*=\s*'([^']*)'/gu;
    let attribute: RegExpExecArray | null;
    while ((attribute = attributePattern.exec(body.slice(name.length))) !== null)
      attributes.set(
        attribute[1] ?? attribute[3] ?? "",
        decodeEntities(attribute[2] ?? attribute[4] ?? ""),
      );

    if (selfClosing) {
      const node: XmlNode = { name, attributes, children: [], text: "" };
      if (stack.length === 0) root = node;
      else stack[stack.length - 1]!.children.push(node);
    } else {
      stack.push({ name, attributes, children: [], text: "" });
    }
    at = close + 1;
  }

  if (root === undefined) fail("no root element");
  return root!;
}

export function childrenNamed(node: XmlNode, name: string): readonly XmlNode[] {
  return node.children.filter((child) => child.name === name);
}

export function childNamed(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((child) => child.name === name);
}

export function childText(node: XmlNode, name: string): string {
  return childNamed(node, name)?.text ?? "";
}

const INNER_STREAM_NONE = 0;
const INNER_STREAM_SALSA20 = 2;
const INNER_STREAM_CHACHA20 = 3;

const SALSA20_NONCE = Uint8Array.of(0xe8, 0x30, 0x09, 0x4b, 0x97, 0x20, 0x5d, 0x2a);

/**
 * KeePass shields individual values (passwords, TOTP seeds) behind a single keystream that
 * runs across the whole document in element order, so protected values must be unmasked in
 * exactly the order they appear.
 */
export class InnerStreamCipher {
  #keystream: Uint8Array = new Uint8Array(0);
  #used = 0;

  private constructor(
    private readonly algorithm: number,
    private readonly key: Uint8Array,
  ) {}

  static async create(algorithm: number, key: Uint8Array): Promise<InnerStreamCipher> {
    if (algorithm === INNER_STREAM_NONE) return new InnerStreamCipher(algorithm, new Uint8Array(0));
    if (algorithm === INNER_STREAM_SALSA20) {
      const hashed = new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(key)));
      return new InnerStreamCipher(algorithm, hashed);
    }
    if (algorithm === INNER_STREAM_CHACHA20) {
      const hashed = new Uint8Array(await crypto.subtle.digest("SHA-512", toArrayBuffer(key)));
      return new InnerStreamCipher(algorithm, hashed);
    }
    throw new KdbxFormatError(`Unsupported protected-value cipher ${algorithm}.`);
  }

  #ensure(length: number): void {
    if (this.#used + length <= this.#keystream.length) return;
    // Generate in generous chunks: the cipher is seekless, so growing means re-generating
    // from offset zero and discarding what was already consumed.
    const needed = this.#used + length;
    const size = Math.max(needed, this.#keystream.length * 2, 1024);
    const zeros = new Uint8Array(size);
    this.#keystream =
      this.algorithm === INNER_STREAM_SALSA20
        ? salsa20(this.key, SALSA20_NONCE, zeros)
        : chacha20(this.key.slice(0, 32), this.key.slice(32, 44), zeros);
  }

  /** Decodes one base64 protected value, advancing the shared keystream. */
  unprotect(base64: string): string {
    if (this.algorithm === INNER_STREAM_NONE) return base64;
    const cipherText = base64ToBytes(base64);
    this.#ensure(cipherText.length);
    const out = new Uint8Array(cipherText.length);
    for (let index = 0; index < cipherText.length; index += 1)
      out[index] = cipherText[index]! ^ this.#keystream[this.#used + index]!;
    this.#used += cipherText.length;
    return new TextDecoder().decode(out);
  }

  /** Consumes keystream for a value whose plaintext is not needed. */
  skip(base64: string): void {
    if (this.algorithm === INNER_STREAM_NONE) return;
    const length = base64ToBytes(base64).length;
    this.#ensure(length);
    this.#used += length;
  }
}

export function base64ToBytes(value: string): Uint8Array {
  const normalized = value.trim();
  if (normalized === "") return new Uint8Array(0);
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
