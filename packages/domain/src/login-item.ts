import { z } from "zod/mini";

import { ITEM_SCHEMA_VERSION, ItemIdSchema, ItemMetadataSchema } from "./item-metadata";
import { UnicodeScalarTextCheck } from "./unicode-scalar-text";

export const MAX_LOGIN_NAME_LENGTH = 256;
export const MAX_LOGIN_USERNAME_LENGTH = 256;
export const MAX_LOGIN_PASSWORD_LENGTH = 4096;
export const MAX_LOGIN_URL_LENGTH = 2048;
export const MAX_LOGIN_URLS = 16;
export const MAX_LOGIN_NOTES_LENGTH = 8192;

const boundedString = (maximum: number) =>
  z.string().check(z.maxLength(maximum), UnicodeScalarTextCheck);

const trimmedBoundedString = (minimum: number, maximum: number) =>
  z.string().check(
    z.minLength(minimum),
    z.maxLength(maximum),
    UnicodeScalarTextCheck,
    z.refine((v) => v === v.trim(), { error: "Value must already be trimmed" }),
  );

export const LoginItemSchema = z.extend(ItemMetadataSchema, {
  kind: z.literal("login"),
  schemaVersion: z.literal(ITEM_SCHEMA_VERSION),
  name: trimmedBoundedString(1, MAX_LOGIN_NAME_LENGTH),
  username: boundedString(MAX_LOGIN_USERNAME_LENGTH),
  password: boundedString(MAX_LOGIN_PASSWORD_LENGTH),
  urls: z
    .array(z.string().check(z.minLength(1), z.maxLength(MAX_LOGIN_URL_LENGTH)))
    .check(z.maxLength(MAX_LOGIN_URLS)),
  linkedOtpId: z.optional(ItemIdSchema),
  notes: boundedString(MAX_LOGIN_NOTES_LENGTH),
});

export type LoginItem = z.infer<typeof LoginItemSchema>;
