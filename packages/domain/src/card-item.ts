import { z } from "zod/mini";

import { ITEM_SCHEMA_VERSION, ItemMetadataSchema } from "./item-metadata";
import { UnicodeScalarTextCheck } from "./unicode-scalar-text";

export const MAX_CARD_NAME_LENGTH = 256;
export const MAX_CARD_HOLDER_LENGTH = 256;
export const MAX_CARD_NUMBER_LENGTH = 32;
export const MAX_CARD_NOTES_LENGTH = 8192;
export const CARD_BRANDS = ["visa", "mastercard", "amex", "discover", "jcb", "unionpay", "other"] as const;
export type CardBrand = (typeof CARD_BRANDS)[number];

const boundedString = (maximum: number) =>
  z.string().check(z.maxLength(maximum), UnicodeScalarTextCheck);

export const CardItemSchema = z.extend(ItemMetadataSchema, {
  kind: z.literal("card"),
  schemaVersion: z.literal(ITEM_SCHEMA_VERSION),
  name: z.string().check(
    z.minLength(1),
    z.maxLength(MAX_CARD_NAME_LENGTH),
    UnicodeScalarTextCheck,
    z.refine((v) => v === v.trim(), { error: "Value must already be trimmed" }),
  ),
  brand: z.optional(z.enum(CARD_BRANDS)),
  cardholderName: boundedString(MAX_CARD_HOLDER_LENGTH),
  number: boundedString(MAX_CARD_NUMBER_LENGTH),
  expMonth: boundedString(2),
  expYear: boundedString(4),
  cvv: boundedString(8),
  pin: boundedString(16),
  notes: boundedString(MAX_CARD_NOTES_LENGTH),
});

export type CardItem = z.infer<typeof CardItemSchema>;
