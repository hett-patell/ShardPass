/**
 * SSH keys as the vault sees them: the private key text a person pastes or ShardPass makes,
 * and what can be said about it without ever sending it anywhere — the public key line,
 * the SHA-256 fingerprint `ssh-keygen -l` prints, and the key type. Reads OpenSSH,
 * PKCS#8, PEM RSA (PKCS#1), PEM EC (SEC1) and PuTTY files; makes OpenSSH Ed25519 and RSA
 * keys with WebCrypto.
 */

export interface SshKeyInfo {
  /** "ssh-ed25519", "ssh-rsa", "ecdsa-sha2-nistp256"…; "" when the file could not be read. */
  keyType: string;
  /** The authorized_keys line: type, base64 blob, comment. */
  publicKey: string;
  /** "SHA256:…", as ssh-keygen prints it. */
  fingerprint: string;
  comment: string;
  /** The private part is passphrase-protected; the public part is still read when the format keeps it in clear. */
  encrypted: boolean;
}

export interface GeneratedSshKey {
  /** OpenSSH private key text, unencrypted. */
  privateKey: string;
  publicKey: string;
  fingerprint: string;
  keyType: string;
}

export type SshKeyKind = "ed25519" | "rsa";

const OPENSSH_MAGIC = "openssh-key-v1\0";
const OID_RSA = "1.2.840.113549.1.1.1";
const OID_ED25519 = "1.3.101.112";
const OID_EC = "1.2.840.10045.2.1";
const CURVES: Record<string, { name: "P-256" | "P-384" | "P-521"; ssh: string; size: number }> = {
  "1.2.840.10045.3.1.7": { name: "P-256", ssh: "nistp256", size: 32 },
  "1.3.132.0.34": { name: "P-384", ssh: "nistp384", size: 48 },
  "1.3.132.0.35": { name: "P-521", ssh: "nistp521", size: 66 },
};

/** Whether the text looks like a private key file of a kind this module knows. */
export function isSshPrivateKey(text: string): boolean {
  const trimmed = text.trim();
  return (
    /^-----BEGIN (?:OPENSSH |RSA |EC |ENCRYPTED |)PRIVATE KEY-----/u.test(trimmed) ||
    trimmed.startsWith("PuTTY-User-Key-File-")
  );
}

/** What a private key file says about itself; null when it is not one this module can read. */
export async function inspectSshPrivateKey(text: string): Promise<SshKeyInfo | null> {
  const trimmed = text.trim();
  try {
    if (trimmed.startsWith("-----BEGIN OPENSSH PRIVATE KEY-----"))
      return await inspectOpenSsh(trimmed);
    if (trimmed.startsWith("PuTTY-User-Key-File-")) return await inspectPutty(trimmed);
    if (
      trimmed.startsWith("-----BEGIN ENCRYPTED PRIVATE KEY-----") ||
      /Proc-Type: 4,ENCRYPTED/u.test(trimmed)
    )
      return { keyType: "", publicKey: "", fingerprint: "", comment: "", encrypted: true };
    if (trimmed.startsWith("-----BEGIN PRIVATE KEY-----"))
      return await inspectPkcs8(pemBody(trimmed));
    if (trimmed.startsWith("-----BEGIN RSA PRIVATE KEY-----"))
      return await inspectPkcs8(wrapPkcs8(pemBody(trimmed), OID_RSA, null));
    if (trimmed.startsWith("-----BEGIN EC PRIVATE KEY-----")) {
      const sec1 = pemBody(trimmed);
      const curve = sec1CurveOid(sec1);
      if (curve === null) return null;
      return await inspectPkcs8(wrapPkcs8(sec1, OID_EC, curve));
    }
    return null;
  } catch {
    return null;
  }
}

/** A fresh key pair in OpenSSH format. RSA keys take a moment; Ed25519 is instant and preferred. */
export async function generateSshKey(
  kind: SshKeyKind,
  comment = "",
  rsaBits: 2048 | 3072 | 4096 = 4096,
): Promise<GeneratedSshKey> {
  const subtle = globalThis.crypto.subtle;
  if (kind === "ed25519") {
    const pair = await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const jwk = await subtle.exportKey("jwk", pair.privateKey);
    const publicBytes = base64UrlDecode(jwk.x ?? "");
    const seed = base64UrlDecode(jwk.d ?? "");
    const blob = concat(sshString("ssh-ed25519"), sshString(publicBytes));
    const privateSection = concat(
      sshString("ssh-ed25519"),
      sshString(publicBytes),
      sshString(concat(seed, publicBytes)),
    );
    return finishGenerated("ssh-ed25519", blob, privateSection, comment);
  }
  const pair = await subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: rsaBits,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const jwk = await subtle.exportKey("jwk", pair.privateKey);
  const part = (name: keyof JsonWebKey): Uint8Array =>
    base64UrlDecode((jwk[name] as string | undefined) ?? "");
  const n = part("n");
  const e = part("e");
  const blob = concat(sshString("ssh-rsa"), sshMpint(e), sshMpint(n));
  const privateSection = concat(
    sshString("ssh-rsa"),
    sshMpint(n),
    sshMpint(e),
    sshMpint(part("d")),
    sshMpint(part("qi")),
    sshMpint(part("p")),
    sshMpint(part("q")),
  );
  return finishGenerated("ssh-rsa", blob, privateSection, comment);
}

async function finishGenerated(
  keyType: string,
  blob: Uint8Array,
  keyFields: Uint8Array,
  comment: string,
): Promise<GeneratedSshKey> {
  const check = new Uint8Array(4);
  globalThis.crypto.getRandomValues(check);
  let privateSection = concat(check, check, keyFields, sshString(comment));
  const padding: number[] = [];
  for (let index = 1; (privateSection.length + padding.length) % 8 !== 0; index += 1)
    padding.push(index);
  privateSection = concat(privateSection, Uint8Array.from(padding));
  const body = concat(
    new TextEncoder().encode(OPENSSH_MAGIC),
    sshString("none"),
    sshString("none"),
    sshString(new Uint8Array(0)),
    uint32(1),
    sshString(blob),
    sshString(privateSection),
  );
  const lines = base64Encode(body).match(/.{1,70}/gu) ?? [];
  return {
    privateKey: `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines.join("\n")}\n-----END OPENSSH PRIVATE KEY-----\n`,
    publicKey: publicLine(keyType, blob, comment),
    fingerprint: await fingerprintOf(blob),
    keyType,
  };
}

// --- OpenSSH ---

async function inspectOpenSsh(text: string): Promise<SshKeyInfo | null> {
  const bytes = pemBody(text);
  const magic = new TextDecoder().decode(bytes.slice(0, OPENSSH_MAGIC.length));
  if (magic !== OPENSSH_MAGIC) return null;
  const reader = new SshReader(bytes, OPENSSH_MAGIC.length);
  const cipher = reader.text();
  reader.string(); // kdf name
  reader.string(); // kdf options
  const count = reader.uint32();
  if (count < 1) return null;
  const blob = reader.string();
  const keyType = new SshReader(blob, 0).text();
  const encrypted = cipher !== "none";
  let comment = "";
  if (!encrypted) {
    const section = new SshReader(reader.string(), 0);
    const check1 = section.uint32();
    const check2 = section.uint32();
    if (check1 !== check2) return null;
    const type = section.text();
    skipPrivateFields(section, type);
    comment = section.text();
  }
  return {
    keyType,
    publicKey: publicLine(keyType, blob, comment),
    fingerprint: await fingerprintOf(blob),
    comment,
    encrypted,
  };
}

function skipPrivateFields(section: SshReader, type: string): void {
  if (type === "ssh-ed25519") {
    section.string();
    section.string();
  } else if (type === "ssh-rsa") {
    for (let index = 0; index < 6; index += 1) section.string();
  } else if (type.startsWith("ecdsa-sha2-")) {
    section.string();
    section.string();
    section.string();
  } else if (type === "ssh-dss") {
    for (let index = 0; index < 5; index += 1) section.string();
  } else throw new Error("unknown key type");
}

// --- PuTTY ---

async function inspectPutty(text: string): Promise<SshKeyInfo | null> {
  const lines = text.split(/\r?\n/u);
  const header = /^PuTTY-User-Key-File-\d+:\s*(\S+)/u.exec(lines[0] ?? "");
  if (header === null) return null;
  const keyType = header[1] ?? "";
  const field = (name: string): string =>
    lines
      .find((line) => line.startsWith(`${name}:`))
      ?.slice(name.length + 1)
      .trim() ?? "";
  const start = lines.findIndex((line) => line.startsWith("Public-Lines:"));
  const count = Number(field("Public-Lines"));
  if (start < 0 || !Number.isInteger(count) || count <= 0) return null;
  const blob = base64Decode(lines.slice(start + 1, start + 1 + count).join(""));
  const comment = field("Comment");
  return {
    keyType,
    publicKey: publicLine(keyType, blob, comment),
    fingerprint: await fingerprintOf(blob),
    comment,
    encrypted: field("Encryption") !== "none",
  };
}

// --- PKCS#8 and the PEM forms wrapped into it ---

async function inspectPkcs8(der: Uint8Array): Promise<SshKeyInfo | null> {
  const outer = readSequence(der, 0);
  const version = readTlv(der, outer.start);
  const algorithm = readSequence(der, version.next);
  const oidTlv = readTlv(der, algorithm.start);
  if (oidTlv.tag !== 0x06) return null;
  const oid = decodeOid(der.subarray(oidTlv.start, oidTlv.end));
  const subtle = globalThis.crypto.subtle;
  // A fresh view, not its buffer: WebCrypto checks views across realms, buffers only in its own.
  const buffer = der.slice();
  if (oid === OID_ED25519) {
    const key = await subtle.importKey("pkcs8", buffer, { name: "Ed25519" }, true, ["sign"]);
    const jwk = await subtle.exportKey("jwk", key);
    const blob = concat(sshString("ssh-ed25519"), sshString(base64UrlDecode(jwk.x ?? "")));
    return {
      keyType: "ssh-ed25519",
      publicKey: publicLine("ssh-ed25519", blob, ""),
      fingerprint: await fingerprintOf(blob),
      comment: "",
      encrypted: false,
    };
  }
  if (oid === OID_RSA) {
    const key = await subtle.importKey(
      "pkcs8",
      buffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      true,
      ["sign"],
    );
    const jwk = await subtle.exportKey("jwk", key);
    const blob = concat(
      sshString("ssh-rsa"),
      sshMpint(base64UrlDecode(jwk.e ?? "")),
      sshMpint(base64UrlDecode(jwk.n ?? "")),
    );
    return {
      keyType: "ssh-rsa",
      publicKey: publicLine("ssh-rsa", blob, ""),
      fingerprint: await fingerprintOf(blob),
      comment: "",
      encrypted: false,
    };
  }
  if (oid === OID_EC) {
    const curveTlv = readTlv(der, oidTlv.next);
    const curve =
      curveTlv.tag === 0x06
        ? CURVES[decodeOid(der.subarray(curveTlv.start, curveTlv.end))]
        : undefined;
    if (curve === undefined) return null;
    const key = await subtle.importKey(
      "pkcs8",
      buffer,
      { name: "ECDSA", namedCurve: curve.name },
      true,
      ["sign"],
    );
    const jwk = await subtle.exportKey("jwk", key);
    const point = concat(
      Uint8Array.of(4),
      padTo(base64UrlDecode(jwk.x ?? ""), curve.size),
      padTo(base64UrlDecode(jwk.y ?? ""), curve.size),
    );
    const keyType = `ecdsa-sha2-${curve.ssh}`;
    const blob = concat(sshString(keyType), sshString(curve.ssh), sshString(point));
    return {
      keyType,
      publicKey: publicLine(keyType, blob, ""),
      fingerprint: await fingerprintOf(blob),
      comment: "",
      encrypted: false,
    };
  }
  return null;
}

/** PKCS#8 around a PKCS#1 or SEC1 body: SEQUENCE { INTEGER 0, SEQUENCE { OID, params }, OCTET STRING body }. */
function wrapPkcs8(body: Uint8Array, oid: string, curveOid: string | null): Uint8Array {
  const params = curveOid === null ? tlv(0x05, new Uint8Array(0)) : tlv(0x06, encodeOid(curveOid));
  const algorithm = tlv(0x30, concat(tlv(0x06, encodeOid(oid)), params));
  return tlv(0x30, concat(tlv(0x02, Uint8Array.of(0)), algorithm, tlv(0x04, body)));
}

/** The curve named inside a SEC1 EC private key ([0] EXPLICIT OID). */
function sec1CurveOid(der: Uint8Array): string | null {
  const outer = readSequence(der, 0);
  let cursor = outer.start;
  while (cursor < outer.end) {
    const node = readTlv(der, cursor);
    if (node.tag === 0xa0) {
      const inner = readTlv(der, node.start);
      if (inner.tag === 0x06) return decodeOid(der.subarray(inner.start, inner.end));
    }
    cursor = node.next;
  }
  return null;
}

// --- DER ---

type Tlv = Readonly<{ tag: number; start: number; end: number; next: number }>;

function readTlv(der: Uint8Array, offset: number): Tlv {
  const tag = der[offset];
  let length = der[offset + 1];
  if (tag === undefined || length === undefined) throw new Error("truncated");
  let cursor = offset + 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    length = 0;
    for (let index = 0; index < count; index += 1) {
      const byte = der[cursor + index];
      if (byte === undefined) throw new Error("truncated");
      length = length * 256 + byte;
    }
    cursor += count;
  }
  if (cursor + length > der.length) throw new Error("truncated");
  return { tag, start: cursor, end: cursor + length, next: cursor + length };
}

function readSequence(der: Uint8Array, offset: number): Tlv {
  const node = readTlv(der, offset);
  if (node.tag !== 0x30) throw new Error("not a sequence");
  return node;
}

function tlv(tag: number, body: Uint8Array): Uint8Array {
  let length: Uint8Array;
  if (body.length < 0x80) length = Uint8Array.of(body.length);
  else {
    const bytes: number[] = [];
    for (let remaining = body.length; remaining > 0; remaining = Math.floor(remaining / 256))
      bytes.unshift(remaining % 256);
    length = Uint8Array.from([0x80 | bytes.length, ...bytes]);
  }
  return concat(Uint8Array.of(tag), length, body);
}

function decodeOid(bytes: Uint8Array): string {
  const first = bytes[0] ?? 0;
  const parts = [Math.floor(first / 40), first % 40];
  let value = 0;
  for (const byte of bytes.subarray(1)) {
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join(".");
}

function encodeOid(oid: string): Uint8Array {
  const parts = oid.split(".").map(Number);
  const bytes: number[] = [(parts[0] ?? 0) * 40 + (parts[1] ?? 0)];
  for (const part of parts.slice(2)) {
    const chunk: number[] = [part & 0x7f];
    for (let rest = Math.floor(part / 128); rest > 0; rest = Math.floor(rest / 128))
      chunk.unshift((rest & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return Uint8Array.from(bytes);
}

// --- SSH wire encoding ---

class SshReader {
  constructor(
    private readonly bytes: Uint8Array,
    private offset: number,
  ) {}

  uint32(): number {
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 4);
    this.offset += 4;
    return view.getUint32(0);
  }

  string(): Uint8Array {
    const length = this.uint32();
    if (this.offset + length > this.bytes.length) throw new Error("truncated");
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  text(): string {
    return new TextDecoder().decode(this.string());
  }
}

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function sshString(value: string | Uint8Array): Uint8Array {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return concat(uint32(bytes.length), bytes);
}

function sshMpint(magnitude: Uint8Array): Uint8Array {
  let start = 0;
  while (start < magnitude.length - 1 && magnitude[start] === 0) start += 1;
  const trimmed = magnitude.subarray(start);
  const needsPad = trimmed.length > 0 && ((trimmed[0] ?? 0) & 0x80) !== 0;
  return sshString(needsPad ? concat(Uint8Array.of(0), trimmed) : trimmed);
}

function padTo(bytes: Uint8Array, size: number): Uint8Array {
  if (bytes.length >= size) return bytes.subarray(bytes.length - size);
  return concat(new Uint8Array(size - bytes.length), bytes);
}

function publicLine(keyType: string, blob: Uint8Array, comment: string): string {
  return `${keyType} ${base64Encode(blob)}${comment === "" ? "" : ` ${comment}`}`;
}

async function fingerprintOf(blob: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", blob.slice());
  return `SHA256:${base64Encode(new Uint8Array(digest)).replace(/=+$/u, "")}`;
}

// --- bytes ---

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function pemBody(text: string): Uint8Array {
  const lines = text
    .split(/\r?\n/u)
    .filter((line) => !line.startsWith("-----") && !line.includes(":") && line.trim() !== "");
  return base64Decode(lines.join(""));
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Decode(text: string): Uint8Array {
  const binary = atob(text.replace(/\s+/gu, ""));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function base64UrlDecode(text: string): Uint8Array {
  const padded =
    text.replace(/-/gu, "+").replace(/_/gu, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  return base64Decode(padded);
}
