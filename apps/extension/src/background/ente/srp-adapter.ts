import { Buffer } from "node:buffer";
import { SrpClient, SRP } from "fast-srp-hap";

const GROUP_BYTES = 512;
const PRIVATE_BYTES = 64;
const LOGIN_KEY_BYTES = 16;
const PROOF_BYTES = 32;
const MAX_IDENTITY_BYTES = 320;
const MAX_SALT_BYTES = 1024;

const owned = (value: Uint8Array): Uint8Array => Uint8Array.from(value);
const reject = (): never => {
  throw new Error("Ente SRP input rejected");
};

/** Decodes only canonical RFC 4648 standard-alphabet, padded base64 protocol fields. */
export function decodeEnteSrpProtocolBase64(value: string): Uint8Array {
  if (
    value.length === 0 ||
    value.length > MAX_SALT_BYTES * 2 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  )
    return reject();
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) return reject();
  return owned(decoded);
}

export type EnteSrpClientInput = Readonly<{
  usernameUtf8: Uint8Array;
  passwordKey: Uint8Array;
  salt: Uint8Array;
}>;

export interface EnteSrpClient {
  clientPublicA(): Uint8Array;
  clientProof(serverPublicB: Uint8Array): Readonly<{ M1: Uint8Array; sessionKey: Uint8Array }>;
  verifyServerProof(M2: Uint8Array): void;
  dispose(): void;
}

function privateEphemeral(): Uint8Array {
  const value = crypto.getRandomValues(new Uint8Array(PRIVATE_BYTES));
  if (value.every((byte) => byte === 0)) return privateEphemeral();
  return value;
}

/** Production construction always owns fresh WebCrypto entropy. */
export function createEnteSrpClient(input: EnteSrpClientInput): EnteSrpClient {
  if (
    input.usernameUtf8.length === 0 ||
    input.usernameUtf8.length > MAX_IDENTITY_BYTES ||
    input.passwordKey.length !== LOGIN_KEY_BYTES ||
    input.salt.length === 0 ||
    input.salt.length > MAX_SALT_BYTES
  )
    reject();

  const identity = Buffer.from(input.usernameUtf8);
  const passwordKey = Buffer.from(input.passwordKey);
  const salt = Buffer.from(input.salt);
  const privateBytes = privateEphemeral();
  const privateValue = Buffer.from(privateBytes);
  privateBytes.fill(0);
  const client = new SrpClient(SRP.params[4096], salt, identity, passwordKey, privateValue, false);
  let disposed = false;
  let proofComputed = false;
  const active = (): void => {
    if (disposed) throw new Error("Ente SRP client disposed");
  };

  return {
    clientPublicA() {
      active();
      const value = client.computeA();
      if (value.length !== GROUP_BYTES) reject();
      return owned(value);
    },
    clientProof(serverPublicB) {
      active();
      if (
        proofComputed ||
        serverPublicB.length !== GROUP_BYTES ||
        serverPublicB.every((value) => value === 0)
      )
        reject();
      try {
        client.setB(Buffer.from(serverPublicB));
        proofComputed = true;
        passwordKey.fill(0);
        privateValue.fill(0);
        return { M1: owned(client.computeM1()), sessionKey: owned(client.computeK()) };
      } catch {
        return reject();
      }
    },
    verifyServerProof(M2) {
      active();
      if (!proofComputed || M2.length !== PROOF_BYTES) throw new Error("Ente SRP proof rejected");
      try {
        client.checkM2(Buffer.from(M2));
      } catch {
        throw new Error("Ente SRP proof rejected");
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      identity.fill(0);
      salt.fill(0);
      passwordKey.fill(0);
      privateValue.fill(0);
    },
  };
}
