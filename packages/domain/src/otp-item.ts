import { z } from "zod/mini";

import { CardItemSchema } from "./card-item";
import { isCanonicalUnpaddedBase32 } from "./canonical-base32";
import { IdentityItemSchema } from "./identity-item";
import { ITEM_SCHEMA_VERSION, ItemMetadataSchema } from "./item-metadata";
import { LoginItemSchema } from "./login-item";
import { NoteItemSchema } from "./note-item";
import { SecretItemSchema } from "./secret-item";
import { UnicodeScalarTextCheck } from "./unicode-scalar-text";

export const MAX_OTP_ISSUER_LENGTH = 256;
export const MAX_OTP_LABEL_LENGTH = 256;
export const MAX_OTP_SECRET_LENGTH = 1024;
export const MAX_OTP_NOTE_LENGTH = 4096;
export const MAX_OTP_PERIOD_SECONDS = 300;

const boundedTrimmedString = (minimum: number, maximum: number) =>
  z.string().check(
    z.minLength(minimum),
    z.maxLength(maximum),
    UnicodeScalarTextCheck,
    z.refine((value) => value === value.trim(), { error: "Value must already be trimmed" }),
  );

export const OtpItemSchema = z
  .extend(ItemMetadataSchema, {
    kind: z.literal("otp"),
    schemaVersion: z.literal(ITEM_SCHEMA_VERSION),
    issuer: boundedTrimmedString(0, MAX_OTP_ISSUER_LENGTH),
    label: boundedTrimmedString(1, MAX_OTP_LABEL_LENGTH),
    secret: z.string().check(
      z.minLength(1),
      z.maxLength(MAX_OTP_SECRET_LENGTH),
      z.refine(isCanonicalUnpaddedBase32, {
        error: "Secret must be canonical uppercase unpadded Base32 encoding complete bytes",
      }),
    ),
    otpType: z.enum(["totp", "hotp", "steam"]),
    algorithm: z.enum(["SHA1", "SHA256", "SHA512"]),
    digits: z.int().check(z.minimum(5), z.maximum(10)),
    period: z.int().check(z.nonnegative(), z.maximum(MAX_OTP_PERIOD_SECONDS)),
    counter: z.optional(z.int().check(z.nonnegative())),
    note: z.string().check(z.maxLength(MAX_OTP_NOTE_LENGTH), UnicodeScalarTextCheck),
  })
  .check(
    z.refine(
      (item) =>
        item.otpType === "hotp"
          ? item.counter !== undefined && item.period === 0
          : item.counter === undefined && item.period > 0,
      { error: "HOTP requires counter and period 0; time-based OTP forbids counter" },
    ),
    z.refine(
      (item) =>
        item.otpType === "steam"
          ? item.algorithm === "SHA1" && item.digits === 5 && item.period === 30
          : item.digits >= 6,
      { error: "OTP parameters are incompatible with the selected type" },
    ),
  );

export const VaultItemSchema = z.discriminatedUnion("kind", [
  OtpItemSchema,
  LoginItemSchema,
  NoteItemSchema,
  CardItemSchema,
  IdentityItemSchema,
  SecretItemSchema,
]);

export type OtpItem = z.infer<typeof OtpItemSchema>;
export type VaultItem = z.infer<typeof VaultItemSchema>;
