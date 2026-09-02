import { z } from "zod/mini";

import { IMPORT_LIMITS } from "./import-model";

export const GOOGLE_MIGRATION_WORKER_VERSION = 1 as const;
const requestId = z.string().check(z.regex(/^[a-f0-9]{32}$/u));
const reason = z.enum(["IMPORT_MALFORMED", "IMPORT_UNSUPPORTED", "IMPORT_LIMIT_EXCEEDED"]);
const counter = z.int().check(z.nonnegative(), z.maximum(Number.MAX_SAFE_INTEGER));
const candidate = z.strictObject({
  sourceOrdinal: z.optional(z.int().check(z.positive(), z.maximum(IMPORT_LIMITS.maxEntries))),
  issuer: z.string(),
  label: z.string(),
  secret: z.string(),
  otpType: z.enum(["totp", "hotp"]),
  algorithm: z.enum(["SHA1", "SHA256", "SHA512"]),
  digits: z.union([z.literal(6), z.literal(8)]),
  period: z.union([z.literal(0), z.literal(30)]),
  counter: z.optional(counter),
  favorite: z.literal(false),
  tags: z.array(z.string()).check(z.maxLength(0)),
  note: z.literal(""),
});
const result = z.strictObject({
  format: z.literal("google-migration"),
  candidates: z.array(candidate).check(z.maxLength(IMPORT_LIMITS.maxEntries)),
  rejected: z
    .array(z.strictObject({ ordinal: z.int().check(z.positive()), reason }))
    .check(z.maxLength(IMPORT_LIMITS.maxEntries)),
});

export const GoogleMigrationWorkerResponseSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    version: z.literal(GOOGLE_MIGRATION_WORKER_VERSION),
    kind: z.literal("success"),
    requestId,
    result,
  }),
  z.strictObject({
    version: z.literal(GOOGLE_MIGRATION_WORKER_VERSION),
    kind: z.literal("failure"),
    requestId,
    reason,
  }),
]);

export type GoogleMigrationWorkerRequest = Readonly<{
  version: typeof GOOGLE_MIGRATION_WORKER_VERSION;
  kind: "decode";
  requestId: string;
  payloads: readonly ArrayBuffer[];
}>;

const GoogleMigrationWorkerRequestSchema = z.strictObject({
  version: z.literal(GOOGLE_MIGRATION_WORKER_VERSION),
  kind: z.literal("decode"),
  requestId,
  payloads: z
    .array(z.instanceof(ArrayBuffer))
    .check(z.minLength(1), z.maxLength(IMPORT_LIMITS.maxMigrationBatches)),
});

export function parseGoogleMigrationWorkerRequest(value: unknown): GoogleMigrationWorkerRequest {
  const parsed = GoogleMigrationWorkerRequestSchema.parse(value);
  let total = 0;
  for (const payload of parsed.payloads) {
    total += payload.byteLength;
    if (payload.byteLength > IMPORT_LIMITS.maxInputBytes || total > IMPORT_LIMITS.maxInputBytes)
      throw new Error("IMPORT_LIMIT_EXCEEDED");
  }
  return parsed;
}
