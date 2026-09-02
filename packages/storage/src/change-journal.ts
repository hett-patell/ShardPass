import { decryptEnvelope, encryptEnvelope } from "@shardpass/crypto/aead";
import type { RandomSource } from "@shardpass/crypto/random";
import { ItemTimestampSchema, VAULT_ITEM_KINDS } from "@shardpass/domain";
import { z } from "zod/mini";

import { canonicalJson, decodeBase64, encodeBase64 } from "./serialization";
import { StorageError } from "./storage-port";
import {
  EncryptedJournalRecordSchema,
  RECORD_FORMAT_VERSION,
  type EncryptedJournalRecord,
} from "./vault-format";

export const MAX_CHANGE_PAGE_SIZE = 1000;
export const MAX_JOURNAL_ENTRIES = 4096;

export const ChangeJournalEntrySchema = z.strictObject({
  sequence: z.int().check(z.positive(), z.maximum(Number.MAX_SAFE_INTEGER)),
  itemId: z.uuid(),
  kind: z.enum(VAULT_ITEM_KINDS),
  // Accepts both the legacy OTP-only item schema version (1) and the current
  // multi-kind version (2) so previously written journal entries stay decodable.
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  revision: z.int().check(z.positive()),
  operation: z.enum(["create", "update", "delete"]),
  changedAt: ItemTimestampSchema,
  mutationId: z.optional(z.uuid()),
});
export type ChangeJournalEntry = z.infer<typeof ChangeJournalEntrySchema>;

export class ChangeJournal {
  constructor(
    private readonly loadVerified: (context: { readonly dek: Uint8Array }) => Promise<{
      readonly records: readonly EncryptedJournalRecord[];
      readonly startSequence: number;
    }>,
  ) {}

  async append(
    existing: readonly EncryptedJournalRecord[],
    entry: Omit<ChangeJournalEntry, "sequence">,
    key: Uint8Array,
    random: RandomSource,
    nextSequence?: number,
  ): Promise<readonly EncryptedJournalRecord[]> {
    const sequence = nextSequence ?? (existing.at(-1)?.sequence ?? 0) + 1;
    const payload = ChangeJournalEntrySchema.parse({ ...entry, sequence });
    const aad = journalAssociatedData(payload);
    const envelope = await encryptEnvelope(
      key,
      new TextEncoder().encode(canonicalJson(payload)),
      aad,
      random,
    );
    return [
      ...existing,
      EncryptedJournalRecordSchema.parse({
        ...aad,
        sequence,
        nonce: encodeBase64(envelope.nonce),
        ciphertext: encodeBase64(envelope.ciphertext),
        encoding: "base64",
      }),
    ];
  }

  async decrypt(candidate: unknown, key: Uint8Array): Promise<ChangeJournalEntry> {
    return decryptAndValidateJournalRecord(candidate, key);
  }

  async listAfter(
    cursor: number,
    limit: number,
    context: { readonly dek: Uint8Array },
  ): Promise<readonly ChangeJournalEntry[]> {
    validatePage(cursor, limit);
    const loaded = await this.loadVerified(context);
    if (cursor < loaded.startSequence - 1) throw new StorageError("JOURNAL_CURSOR_EXPIRED");
    const records = loaded.records;
    const output: ChangeJournalEntry[] = [];
    for (const record of records) {
      if (record.sequence > cursor && output.length < limit) {
        output.push(await decryptAndValidateJournalRecord(record, context.dek));
      }
    }
    return output;
  }
}

export async function decryptAndValidateJournalRecord(
  candidate: unknown,
  key: Uint8Array,
): Promise<ChangeJournalEntry> {
  try {
    const record = EncryptedJournalRecordSchema.parse(candidate);
    const plaintext = await decryptEnvelope(
      key,
      { nonce: decodeBase64(record.nonce), ciphertext: decodeBase64(record.ciphertext) },
      journalAssociatedData(record),
    );
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    const payload = ChangeJournalEntrySchema.parse(JSON.parse(decoded));
    if (decoded !== canonicalJson(payload)) throw new Error("noncanonical plaintext");
    if (
      payload.sequence !== record.sequence ||
      payload.itemId !== record.itemId ||
      payload.kind !== record.kind ||
      payload.schemaVersion !== record.schemaVersion ||
      payload.revision !== record.revision
    )
      throw new Error("metadata mismatch");
    return payload;
  } catch {
    throw new StorageError("STORAGE_CORRUPT");
  }
}

export function journalAssociatedData(
  value: Pick<ChangeJournalEntry, "itemId" | "kind" | "schemaVersion" | "revision">,
) {
  return {
    format: "shardpass-encrypted-journal",
    formatVersion: RECORD_FORMAT_VERSION,
    itemId: value.itemId,
    kind: value.kind,
    schemaVersion: value.schemaVersion,
    revision: value.revision,
  } as const;
}

function validatePage(cursor: number, limit: number): void {
  if (
    !Number.isSafeInteger(cursor) ||
    cursor < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_CHANGE_PAGE_SIZE
  )
    throw new StorageError("VAULT_INVALID");
}
