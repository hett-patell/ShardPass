import { decryptEnvelope, encryptEnvelope } from "@shardpass/crypto/aead";
import type { RandomSource } from "@shardpass/crypto/random";
import { sha256 } from "@noble/hashes/sha2.js";
import { z } from "zod/mini";

import { canonicalJson, decodeBase64, encodeBase64 } from "./serialization";
import { StorageError } from "./storage-port";
import {
  EncryptedHotpReceiptSchema,
  VAULT_FORMAT_VERSION,
  type EncryptedHotpReceipt,
} from "./vault-format";

export const MAX_HOTP_RECEIPTS = 1024;

export const HotpCounterCommitReceiptSchema = z
  .strictObject({
    receiptVersion: z.literal(1),
    kind: z.literal("hotp-counter-commit"),
    reservationId: z.uuid(),
    itemId: z.uuid(),
    expectedRevision: z.int().check(z.positive()),
    expectedCounter: z.int().check(z.nonnegative()),
    binding: z.strictObject({
      tabId: z.int().check(z.nonnegative(), z.maximum(Number.MAX_SAFE_INTEGER)),
      frameId: z.int().check(z.nonnegative(), z.maximum(Number.MAX_SAFE_INTEGER)),
      documentId: z.string().check(z.minLength(1), z.maxLength(512)),
    }),
    sessionEpoch: z.int().check(z.nonnegative(), z.maximum(Number.MAX_SAFE_INTEGER)),
    resultRevision: z.int().check(z.positive()),
    resultCounter: z.int().check(z.nonnegative()),
    receiptSequence: z.int().check(z.positive(), z.maximum(Number.MAX_SAFE_INTEGER)),
    committedAt: z.int().check(z.nonnegative(), z.maximum(Number.MAX_SAFE_INTEGER)),
    expiresAt: z.int().check(z.nonnegative(), z.maximum(Number.MAX_SAFE_INTEGER)),
  })
  .check(z.refine((receipt) => receipt.expiresAt > receipt.committedAt));
export type HotpCounterCommitReceipt = z.infer<typeof HotpCounterCommitReceiptSchema>;

export function hotpReceiptHash(reservationId: string): string {
  return Array.from(sha256(new TextEncoder().encode(reservationId)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function encryptHotpReceipt(
  receipt: HotpCounterCommitReceipt,
  key: Uint8Array,
  random: RandomSource,
): Promise<EncryptedHotpReceipt> {
  const payload = HotpCounterCommitReceiptSchema.parse(receipt);
  const receiptHash = hotpReceiptHash(payload.reservationId);
  const aad = hotpReceiptAssociatedData(receiptHash);
  const envelope = await encryptEnvelope(
    key,
    new TextEncoder().encode(canonicalJson(payload)),
    new TextEncoder().encode(canonicalJson(aad)),
    random,
  );
  return EncryptedHotpReceiptSchema.parse({
    ...aad,
    nonce: encodeBase64(envelope.nonce),
    ciphertext: encodeBase64(envelope.ciphertext),
    encoding: "base64",
  });
}

export async function decryptHotpReceipt(
  candidate: unknown,
  key: Uint8Array,
): Promise<HotpCounterCommitReceipt> {
  try {
    const record = EncryptedHotpReceiptSchema.parse(candidate);
    const plaintext = await decryptEnvelope(
      key,
      { nonce: decodeBase64(record.nonce), ciphertext: decodeBase64(record.ciphertext) },
      new TextEncoder().encode(canonicalJson(hotpReceiptAssociatedData(record.receiptHash))),
    );
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    const receipt = HotpCounterCommitReceiptSchema.parse(JSON.parse(decoded));
    if (
      decoded !== canonicalJson(receipt) ||
      hotpReceiptHash(receipt.reservationId) !== record.receiptHash
    )
      throw new Error("mismatch");
    return receipt;
  } catch {
    throw new StorageError("STORAGE_CORRUPT");
  }
}

export function hotpReceiptAssociatedData(receiptHash: string) {
  return {
    format: "shardpass-encrypted-hotp-receipt",
    formatVersion: VAULT_FORMAT_VERSION,
    receiptHash,
  } as const;
}
