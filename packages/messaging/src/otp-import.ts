const MAX_IMPORT_ENTRIES = 1_000;

export type ImportSourceFormat = "otpauth" | "google-migration" | "aegis" | "ente" | "qr";
export type OtpImportCandidate = Readonly<{
  sourceOrdinal: number;
  issuer: string;
  label: string;
  secret: string;
  otpType: "totp" | "hotp" | "steam";
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: number;
  period: number;
  counter?: number;
  favorite: boolean;
  tags: readonly string[];
  note: string;
}>;
export type ImportPreviewRow = Readonly<{
  rowId: string;
  ordinal: number;
  status: "accepted" | "duplicate" | "rejected";
  reason:
    | "IMPORT_ACCEPTED"
    | "IMPORT_DUPLICATE_VAULT"
    | "IMPORT_DUPLICATE_BATCH"
    | "IMPORT_MALFORMED"
    | "IMPORT_UNSUPPORTED"
    | "IMPORT_LIMIT_EXCEEDED";
  metadata: Readonly<{
    issuer: string;
    label: string;
    otpType: "totp" | "hotp" | "steam";
    algorithm: "SHA1" | "SHA256" | "SHA512";
    digits: number;
    period: number;
    counter?: number;
  }> | null;
}>;
import {
  isCanonicalUnpaddedBase32,
  isUnicodeScalarText,
  MAX_ITEM_TAG_LENGTH,
  MAX_ITEM_TAGS,
  MAX_OTP_ISSUER_LENGTH,
  MAX_OTP_LABEL_LENGTH,
  MAX_OTP_NOTE_LENGTH,
  MAX_OTP_PERIOD_SECONDS,
  MAX_OTP_SECRET_LENGTH,
} from "@shardpass/domain";
import { z } from "zod/mini";

import type { CommandSenderPolicy } from "./context";
import { MESSAGE_VERSION } from "./envelope";

const unicode = (maximum: number) =>
  z.string().check(z.maxLength(maximum), z.refine(isUnicodeScalarText));
const trimmed = (minimum: number, maximum: number) =>
  unicode(maximum).check(
    z.minLength(minimum),
    z.refine((value) => value === value.trim()),
  );
const nonnegative = z.int().check(z.nonnegative(), z.maximum(Number.MAX_SAFE_INTEGER));
const token = z.uuid();
const format = z.enum(["otpauth", "google-migration", "aegis", "ente", "qr"]);
const otpType = z.enum(["totp", "hotp", "steam"]);
const algorithm = z.enum(["SHA1", "SHA256", "SHA512"]);
const tags = z.array(trimmed(1, MAX_ITEM_TAG_LENGTH)).check(
  z.maxLength(MAX_ITEM_TAGS),
  z.refine(
    (values) =>
      new Set(values.map((value) => value.normalize("NFKC").toLocaleLowerCase("en-US"))).size ===
      values.length,
  ),
);

export const OtpImportCandidateMessageSchema = z
  .strictObject({
    sourceOrdinal: z.int().check(z.positive(), z.maximum(MAX_IMPORT_ENTRIES)),
    issuer: trimmed(0, MAX_OTP_ISSUER_LENGTH),
    label: trimmed(1, MAX_OTP_LABEL_LENGTH),
    secret: z
      .string()
      .check(
        z.minLength(1),
        z.maxLength(MAX_OTP_SECRET_LENGTH),
        z.refine(isCanonicalUnpaddedBase32),
      ),
    otpType,
    algorithm,
    digits: z.int().check(z.minimum(5), z.maximum(10)),
    period: z.int().check(z.nonnegative(), z.maximum(MAX_OTP_PERIOD_SECONDS)),
    counter: z.optional(nonnegative),
    favorite: z.boolean(),
    tags,
    note: unicode(MAX_OTP_NOTE_LENGTH),
  })
  .check(
    z.refine((value) =>
      value.otpType === "hotp"
        ? value.counter !== undefined && value.period === 0
        : value.counter === undefined && value.period > 0,
    ),
    z.refine((value) =>
      value.otpType === "steam"
        ? value.algorithm === "SHA1" && value.digits === 5 && value.period === 30
        : value.digits >= 6,
    ),
  );

const metadata = z.strictObject({
  issuer: trimmed(0, MAX_OTP_ISSUER_LENGTH),
  label: trimmed(1, MAX_OTP_LABEL_LENGTH),
  otpType,
  algorithm,
  digits: z.int().check(z.minimum(5), z.maximum(10)),
  period: z.int().check(z.nonnegative(), z.maximum(MAX_OTP_PERIOD_SECONDS)),
  counter: z.optional(nonnegative),
});
const row = z.strictObject({
  rowId: token,
  ordinal: z.int().check(z.positive(), z.maximum(MAX_IMPORT_ENTRIES)),
  status: z.enum(["accepted", "duplicate", "rejected"]),
  reason: z.enum([
    "IMPORT_ACCEPTED",
    "IMPORT_DUPLICATE_VAULT",
    "IMPORT_DUPLICATE_BATCH",
    "IMPORT_MALFORMED",
    "IMPORT_UNSUPPORTED",
    "IMPORT_LIMIT_EXCEEDED",
  ]),
  metadata: z.nullable(metadata),
});
const count = z.int().check(z.nonnegative(), z.maximum(MAX_IMPORT_ENTRIES));
const timestamp = z.number().check(z.int(), z.nonnegative(), z.maximum(Number.MAX_SAFE_INTEGER));

export const OtpImportPreviewRequestSchema = z
  .strictObject({
    version: z.literal(MESSAGE_VERSION),
    kind: z.literal("otp.importPreview"),
    format,
    candidates: z
      .array(OtpImportCandidateMessageSchema)
      .check(z.minLength(1), z.maxLength(MAX_IMPORT_ENTRIES)),
  })
  .check(
    z.refine(
      (request) =>
        new Set(request.candidates.map((candidate) => candidate.sourceOrdinal)).size ===
        request.candidates.length,
    ),
  );
export const OtpImportConfirmRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("otp.importConfirm"),
  previewToken: token,
});
export const OtpImportCancelRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("otp.importCancel"),
  previewToken: token,
});
export const OtpImportRequestSchema = z.discriminatedUnion("kind", [
  OtpImportPreviewRequestSchema,
  OtpImportConfirmRequestSchema,
  OtpImportCancelRequestSchema,
]);
export const OtpImportPreviewResultSchema = z
  .strictObject({
    version: z.literal(MESSAGE_VERSION),
    kind: z.literal("otp.importPreviewResult"),
    previewToken: token,
    format,
    rows: z.array(row).check(z.minLength(1), z.maxLength(MAX_IMPORT_ENTRIES)),
    accepted: count,
    duplicate: count,
    rejected: count,
    expiresAt: timestamp,
  })
  .check(
    z.refine((value) => value.rows.length === value.accepted + value.duplicate + value.rejected),
  );
export const OtpImportConfirmedSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("otp.importConfirmed"),
  imported: count,
  duplicate: count,
});
export const OtpImportPreviewChangedSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("otp.importPreviewChanged"),
  previewToken: token,
  format,
  rows: z.array(row).check(z.minLength(1), z.maxLength(MAX_IMPORT_ENTRIES)),
  accepted: count,
  duplicate: count,
  rejected: count,
  expiresAt: timestamp,
});
export const OtpImportCancelledSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("otp.importCancelled"),
  cancelled: z.boolean(),
});
export const OtpImportResponseSchema = z.discriminatedUnion("kind", [
  OtpImportPreviewResultSchema,
  OtpImportConfirmedSchema,
  OtpImportPreviewChangedSchema,
  OtpImportCancelledSchema,
]);

export type OtpImportRequest = z.infer<typeof OtpImportRequestSchema>;
export type OtpImportResponse = z.infer<typeof OtpImportResponseSchema>;
export type OtpImportCommandKind = OtpImportRequest["kind"];
export type OtpImportResponseKind = OtpImportResponse["kind"];

export const otpImportResponseKindsByRequest = {
  "otp.importPreview": ["otp.importPreviewResult"],
  "otp.importConfirm": ["otp.importConfirmed", "otp.importPreviewChanged"],
  "otp.importCancel": ["otp.importCancelled"],
} as const satisfies Record<OtpImportCommandKind, readonly OtpImportResponseKind[]>;

export function parseOtpImportResponseForRequest(request: OtpImportRequest, candidate: unknown) {
  const parsed = OtpImportResponseSchema.safeParse(candidate);
  if (
    !parsed.success ||
    !(otpImportResponseKindsByRequest[request.kind] as readonly string[]).includes(parsed.data.kind)
  )
    return { success: false as const };
  return { success: true as const, data: parsed.data };
}

const vaultOnly = { allowedContexts: ["vault"], requireDocument: true } as const;
export const otpImportSenderPolicy = {
  "otp.importPreview": vaultOnly,
  "otp.importConfirm": vaultOnly,
  "otp.importCancel": vaultOnly,
} satisfies Record<OtpImportCommandKind, CommandSenderPolicy>;
