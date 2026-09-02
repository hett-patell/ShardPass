import { z } from "zod/mini";

import { UnicodeScalarTextCheck } from "./unicode-scalar-text";

export const ITEM_SCHEMA_VERSION = 1 as const;
export const MAX_ITEM_TAGS = 64;
export const MAX_ITEM_TAG_LENGTH = 256;
/** Pre-release parser safety bound preserving high-precision UTC fractions from the prior schema. */
export const MAX_ITEM_TIMESTAMP_LENGTH = 1024;

export const ItemIdSchema = z.uuid();

export const ItemTimestampSchema = z.iso
  .datetime({ offset: false, local: false })
  .check(z.maxLength(MAX_ITEM_TIMESTAMP_LENGTH));

const itemTagSchema = z.string().check(
  z.minLength(1),
  z.maxLength(MAX_ITEM_TAG_LENGTH),
  UnicodeScalarTextCheck,
  z.refine((tag) => tag === tag.trim(), { error: "Tags must already be trimmed" }),
);

const itemTagsSchema = z.array(itemTagSchema).check(
  z.maxLength(MAX_ITEM_TAGS),
  z.refine(
    (tags) =>
      new Set(tags.map((tag) => tag.normalize("NFKC").toLocaleLowerCase("en-US"))).size ===
      tags.length,
    { error: "Tags must be unique after Unicode and case normalization" },
  ),
);

export const ItemMetadataSchema = z.strictObject({
  id: ItemIdSchema,
  schemaVersion: z.literal(ITEM_SCHEMA_VERSION),
  revision: z.int().check(z.positive()),
  createdAt: ItemTimestampSchema,
  updatedAt: ItemTimestampSchema,
  favorite: z.boolean(),
  archivedAt: z.optional(ItemTimestampSchema),
  deletedAt: z.optional(ItemTimestampSchema),
  tags: itemTagsSchema,
});

export type ItemMetadata = z.infer<typeof ItemMetadataSchema>;
