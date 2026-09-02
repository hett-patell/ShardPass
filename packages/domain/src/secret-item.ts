import { z } from "zod/mini";

import { ITEM_SCHEMA_VERSION, ItemMetadataSchema } from "./item-metadata";
import { UnicodeScalarTextCheck } from "./unicode-scalar-text";

export const MAX_SECRET_NAME_LENGTH = 256;
export const MAX_SECRET_VALUE_LENGTH = 65536;
export const MAX_SECRET_METADATA_ENTRIES = 32;
export const MAX_SECRET_METADATA_KEY_LENGTH = 128;
export const MAX_SECRET_METADATA_VALUE_LENGTH = 4096;
export const MAX_SECRET_NOTES_LENGTH = 8192;

const boundedString = (maximum: number) =>
  z.string().check(z.maxLength(maximum), UnicodeScalarTextCheck);

const secretMetadataSchema = z
  .record(
    z.string().check(z.minLength(1), z.maxLength(MAX_SECRET_METADATA_KEY_LENGTH)),
    z.string().check(z.maxLength(MAX_SECRET_METADATA_VALUE_LENGTH)),
  )
  .check(
    z.refine((rec) => Object.keys(rec).length <= MAX_SECRET_METADATA_ENTRIES, {
      error: `Metadata must have at most ${MAX_SECRET_METADATA_ENTRIES} entries`,
    }),
  );

export const SecretItemSchema = z.extend(ItemMetadataSchema, {
  kind: z.literal("secret"),
  schemaVersion: z.literal(ITEM_SCHEMA_VERSION),
  name: z.string().check(
    z.minLength(1),
    z.maxLength(MAX_SECRET_NAME_LENGTH),
    UnicodeScalarTextCheck,
    z.refine((v) => v === v.trim(), { error: "Value must already be trimmed" }),
  ),
  secretType: z.enum(["api_key", "ssh_key", "token", "env", "other"]),
  value: boundedString(MAX_SECRET_VALUE_LENGTH),
  metadata: secretMetadataSchema,
  notes: boundedString(MAX_SECRET_NOTES_LENGTH),
});

export type SecretItem = z.infer<typeof SecretItemSchema>;
