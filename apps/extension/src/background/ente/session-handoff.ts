import type { SenderContext } from "@shardpass/messaging";

import type { EnteSessionVaultRepository } from "../vault/session-vault-repository";
import { EnteProtocolError, ENTE_SYNC_LIMITS } from "./protocol";
import type { EnteSodiumAdapter } from "./sodium-adapter";

const VERSION = 1;
const HEADER_BYTES = 8;
const KEY_BYTES = 32;
const MAX_TOKEN_BYTES = 4_096;
const MAX_CIPHERTEXT_BYTES = MAX_TOKEN_BYTES + KEY_BYTES * 3 + HEADER_BYTES + 48;
const TTL_MS = 60_000;

export type EnteSessionPayload = Readonly<{
  token: Uint8Array;
  masterKey: Uint8Array;
  authKey: Uint8Array;
  accountFingerprint: Uint8Array;
}>;

function reject(): never {
  throw new EnteProtocolError("ENTE_AUTH_FAILED");
}

export function encodeEnteSessionPayload(input: EnteSessionPayload): Uint8Array {
  if (input.token.byteLength < 1 || input.token.byteLength > MAX_TOKEN_BYTES) reject();
  if (
    input.masterKey.byteLength !== KEY_BYTES ||
    input.authKey.byteLength !== KEY_BYTES ||
    input.accountFingerprint.byteLength !== KEY_BYTES
  )
    reject();
  const output = new Uint8Array(HEADER_BYTES + input.token.byteLength + KEY_BYTES * 3);
  const view = new DataView(output.buffer);
  view.setUint8(0, VERSION);
  view.setUint8(1, 0);
  view.setUint16(2, input.token.byteLength, false);
  view.setUint16(4, KEY_BYTES, false);
  view.setUint16(6, KEY_BYTES * 2, false);
  output.set(input.token, HEADER_BYTES);
  output.set(input.masterKey, HEADER_BYTES + input.token.byteLength);
  output.set(input.authKey, HEADER_BYTES + input.token.byteLength + KEY_BYTES);
  output.set(input.accountFingerprint, HEADER_BYTES + input.token.byteLength + KEY_BYTES * 2);
  return output;
}

export function decodeEnteSessionPayload(input: Uint8Array): EnteSessionPayload {
  if (input.byteLength < HEADER_BYTES + KEY_BYTES * 3 + 1) reject();
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const tokenLength = view.getUint16(2, false);
  const masterLength = view.getUint16(4, false);
  const fingerprintLength = view.getUint16(6, false);
  if (
    view.getUint8(0) !== VERSION ||
    view.getUint8(1) !== 0 ||
    tokenLength < 1 ||
    tokenLength > MAX_TOKEN_BYTES ||
    masterLength !== KEY_BYTES ||
    fingerprintLength !== KEY_BYTES * 2 ||
    input.byteLength !== HEADER_BYTES + tokenLength + masterLength + fingerprintLength
  )
    reject();
  return {
    token: input.slice(HEADER_BYTES, HEADER_BYTES + tokenLength),
    masterKey: input.slice(HEADER_BYTES + tokenLength, HEADER_BYTES + tokenLength + KEY_BYTES),
    authKey: input.slice(
      HEADER_BYTES + tokenLength + KEY_BYTES,
      HEADER_BYTES + tokenLength + KEY_BYTES * 2,
    ),
    accountFingerprint: input.slice(HEADER_BYTES + tokenLength + KEY_BYTES * 2),
  };
}

type Entry = {
  readonly sender: SenderContext;
  readonly sessionEpoch: number;
  readonly rootDigest: string;
  readonly expiresAt: number;
  readonly publicKey: Uint8Array;
  readonly privateKey: Uint8Array;
};

function sameSender(left: SenderContext, right: SenderContext): boolean {
  return (
    left.extensionId === right.extensionId &&
    left.contextKind === "vault" &&
    right.contextKind === "vault" &&
    left.senderUrl === right.senderUrl &&
    left.documentId !== undefined &&
    left.documentId === right.documentId
  );
}

export class EnteSessionHandoffStore {
  private readonly entries = new Map<string, Entry>();
  constructor(
    private readonly repository: EnteSessionVaultRepository,
    private readonly dependencies: Readonly<{
      sodium: EnteSodiumAdapter;
      now(): number;
      randomCapability(): string;
      rootDigest(sessionEpoch: number): Promise<string>;
    }>,
  ) {}

  async issue(
    sender: SenderContext,
  ): Promise<Readonly<{ capability: string; publicKey: Uint8Array }>> {
    if (sender.contextKind !== "vault" || sender.documentId === undefined) reject();
    const snapshot = await this.repository.readOtpItemsAndMetadata("ente-otp-state");
    snapshot.metadata?.fill(0);
    const capability = this.dependencies.randomCapability();
    if (!/^[a-f0-9]{64}$/u.test(capability) || this.entries.has(capability)) reject();
    const pair = this.dependencies.sodium.sealedBoxKeypair();
    const entry: Entry = {
      sender: { ...sender },
      sessionEpoch: snapshot.sessionEpoch,
      rootDigest: await this.dependencies.rootDigest(snapshot.sessionEpoch),
      expiresAt: this.dependencies.now() + TTL_MS,
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
    };
    this.entries.set(capability, entry);
    return { capability, publicKey: Uint8Array.from(entry.publicKey) };
  }

  async consume(
    capability: string,
    ciphertext: Uint8Array,
    sender: SenderContext,
  ): Promise<EnteSessionPayload> {
    if (
      !/^[a-f0-9]{64}$/u.test(capability) ||
      !(ciphertext instanceof Uint8Array) ||
      ciphertext.byteLength < 49 ||
      ciphertext.byteLength > Math.min(MAX_CIPHERTEXT_BYTES, ENTE_SYNC_LIMITS.maxCiphertextBytes)
    )
      reject();
    const entry = this.entries.get(capability);
    this.entries.delete(capability);
    if (entry === undefined) reject();
    try {
      const snapshot = await this.repository.readOtpItemsAndMetadata("ente-otp-state");
      snapshot.metadata?.fill(0);
      if (
        entry.expiresAt < this.dependencies.now() ||
        !sameSender(entry.sender, sender) ||
        snapshot.sessionEpoch !== entry.sessionEpoch ||
        (await this.dependencies.rootDigest(snapshot.sessionEpoch)) !== entry.rootDigest
      )
        reject();
      const plaintext = this.dependencies.sodium.sealedBoxOpen(
        ciphertext,
        entry.publicKey,
        entry.privateKey,
      );
      try {
        return decodeEnteSessionPayload(plaintext);
      } finally {
        plaintext.fill(0);
      }
    } catch (error) {
      if (error instanceof EnteProtocolError) throw error;
      reject();
    } finally {
      entry.publicKey.fill(0);
      entry.privateKey.fill(0);
    }
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      entry.publicKey.fill(0);
      entry.privateKey.fill(0);
    }
    this.entries.clear();
  }
}
