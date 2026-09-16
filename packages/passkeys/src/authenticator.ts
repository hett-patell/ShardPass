import { MULTI_LABEL_PUBLIC_SUFFIXES } from "@shardpass/domain";

import { fromBase64Url, toBase64Url } from "./base64url";
import { encodeCbor } from "./cbor";

export const ES256 = -7;
/** Authenticator data flags (WebAuthn §6.1). */
export const FLAG_USER_PRESENT = 0x01;
export const FLAG_USER_VERIFIED = 0x04;
export const FLAG_BACKUP_ELIGIBLE = 0x08;
export const FLAG_BACKED_UP = 0x10;
export const FLAG_ATTESTED_CREDENTIAL = 0x40;
/** A synced, vault-held passkey: present, verified (the vault was unlocked), backup-eligible and backed up. */
export const PASSKEY_FLAGS =
  FLAG_USER_PRESENT | FLAG_USER_VERIFIED | FLAG_BACKUP_ELIGIBLE | FLAG_BACKED_UP;
const AAGUID = new Uint8Array(16);

const encoder = new TextEncoder();

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/**
 * Whether `rpId` may claim `origin`: the origin's host itself or a parent domain of it, and
 * never a bare public suffix or an IP. "localhost" is allowed for development sites.
 */
export function isRegistrableRpId(origin: string, rpId: string): boolean {
  let host: string;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost"))
      return false;
    host = url.hostname.toLowerCase();
  } catch {
    return false;
  }
  const candidate = rpId.toLowerCase();
  if (candidate === "" || candidate.length > 253) return false;
  if (/^[0-9.]+$/u.test(candidate) || candidate.includes(":")) return false;
  if (candidate !== "localhost" && !candidate.includes(".")) return false;
  if (!/^[a-z0-9.-]+$/u.test(candidate) || candidate.startsWith(".") || candidate.endsWith("."))
    return false;
  // Two unrelated sites under one hosting or country suffix must never share a credential.
  if (MULTI_LABEL_PUBLIC_SUFFIXES.has(candidate)) return false;
  return host === candidate || host.endsWith(`.${candidate}`);
}

export function clientDataJson(
  type: "webauthn.create" | "webauthn.get",
  challenge: string,
  origin: string,
): Uint8Array {
  return encoder.encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}

export type Es256KeyPair = Readonly<{
  /** PKCS#8 DER. */
  privateKey: Uint8Array;
  /** SubjectPublicKeyInfo DER, what `getPublicKey()` returns. */
  publicKeySpki: Uint8Array;
  /** COSE_Key (CBOR) for the attested credential data. */
  publicKeyCose: Uint8Array;
}>;

export async function generateEs256KeyPair(): Promise<Es256KeyPair> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const [privateKey, publicKeySpki, jwk] = await Promise.all([
    crypto.subtle.exportKey("pkcs8", pair.privateKey),
    crypto.subtle.exportKey("spki", pair.publicKey),
    crypto.subtle.exportKey("jwk", pair.publicKey),
  ]);
  if (jwk.x === undefined || jwk.y === undefined) throw new Error("public key without coordinates");
  return {
    privateKey: new Uint8Array(privateKey),
    publicKeySpki: new Uint8Array(publicKeySpki),
    publicKeyCose: coseEs256PublicKey(fromBase64Url(jwk.x), fromBase64Url(jwk.y)),
  };
}

/** COSE_Key for an EC2 P-256 key: kty 2, alg ES256, crv P-256, x, y (RFC 9053). */
export function coseEs256PublicKey(x: Uint8Array, y: Uint8Array): Uint8Array {
  if (x.byteLength !== 32 || y.byteLength !== 32)
    throw new RangeError("P-256 coordinates are 32 bytes");
  return encodeCbor(
    new Map<number, Uint8Array | number>([
      [1, 2],
      [3, ES256],
      [-1, 1],
      [-2, x],
      [-3, y],
    ]),
  );
}

export async function buildAuthenticatorData(input: {
  rpId: string;
  flags: number;
  counter: number;
  attestedCredential?: { credentialId: Uint8Array; publicKeyCose: Uint8Array };
}): Promise<Uint8Array> {
  const rpIdHash = await sha256(encoder.encode(input.rpId));
  const counter = new Uint8Array(4);
  new DataView(counter.buffer).setUint32(0, input.counter);
  const flags = Uint8Array.of(
    input.flags | (input.attestedCredential ? FLAG_ATTESTED_CREDENTIAL : 0),
  );
  if (input.attestedCredential === undefined) return concat(rpIdHash, flags, counter);
  const { credentialId, publicKeyCose } = input.attestedCredential;
  const idLength = new Uint8Array(2);
  new DataView(idLength.buffer).setUint16(0, credentialId.byteLength);
  return concat(rpIdHash, flags, counter, AAGUID, idLength, credentialId, publicKeyCose);
}

/** `fmt: "none"`: a self-attestation with nothing to attest, which is what synced passkeys send. */
export function buildAttestationObject(authenticatorData: Uint8Array): Uint8Array {
  return encodeCbor({ fmt: "none", attStmt: {}, authData: authenticatorData });
}

/** WebCrypto signs ECDSA as raw r‖s; WebAuthn carries ASN.1 DER `SEQUENCE { INTEGER r, INTEGER s }`. */
export function rawToDerSignature(raw: Uint8Array): Uint8Array {
  if (raw.byteLength !== 64) throw new RangeError("P-256 signatures are 64 bytes");
  const integer = (part: Uint8Array): number[] => {
    let start = 0;
    while (start < part.byteLength - 1 && part[start] === 0) start += 1;
    const body = [...part.subarray(start)];
    if ((body[0]! & 0x80) !== 0) body.unshift(0);
    return [0x02, body.length, ...body];
  };
  const r = integer(raw.subarray(0, 32));
  const s = integer(raw.subarray(32));
  return Uint8Array.from([0x30, r.length + s.length, ...r, ...s]);
}

export async function signAssertion(
  privateKeyPkcs8: Uint8Array,
  authenticatorData: Uint8Array,
  clientDataJsonBytes: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(privateKeyPkcs8).buffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const message = concat(authenticatorData, await sha256(clientDataJsonBytes));
  const raw = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      Uint8Array.from(message).buffer,
    ),
  );
  return rawToDerSignature(raw);
}

export function newCredentialId(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export { fromBase64Url, toBase64Url };
