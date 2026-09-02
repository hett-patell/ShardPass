import { z } from "zod/mini";

import { ITEM_SCHEMA_VERSION, ItemMetadataSchema } from "./item-metadata";
import { UnicodeScalarTextCheck } from "./unicode-scalar-text";

export const MAX_NOTE_NAME_LENGTH = 256;
export const MAX_NOTE_CONTENT_LENGTH = 65536;

export const NoteItemSchema = z.extend(ItemMetadataSchema, {
  kind: z.literal("note"),
  schemaVersion: z.literal(ITEM_SCHEMA_VERSION),
  name: z.string().check(
    z.minLength(1),
    z.maxLength(MAX_NOTE_NAME_LENGTH),
    UnicodeScalarTextCheck,
    z.refine((v) => v === v.trim(), { error: "Value must already be trimmed" }),
  ),
  content: z.string().check(z.maxLength(MAX_NOTE_CONTENT_LENGTH), UnicodeScalarTextCheck),
});

export type NoteItem = z.infer<typeof NoteItemSchema>;
