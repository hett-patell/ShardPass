import { z } from "zod/mini";

import { ITEM_SCHEMA_VERSION, ItemMetadataSchema } from "./item-metadata";
import { UnicodeScalarTextCheck } from "./unicode-scalar-text";

export const MAX_IDENTITY_NAME_LENGTH = 256;
export const MAX_IDENTITY_NOTES_LENGTH = 8192;

const boundedString = (maximum: number) =>
  z.string().check(z.maxLength(maximum), UnicodeScalarTextCheck);

export const IdentityItemSchema = z.extend(ItemMetadataSchema, {
  kind: z.literal("identity"),
  schemaVersion: z.literal(ITEM_SCHEMA_VERSION),
  name: z.string().check(
    z.minLength(1),
    z.maxLength(MAX_IDENTITY_NAME_LENGTH),
    UnicodeScalarTextCheck,
    z.refine((v) => v === v.trim(), { error: "Value must already be trimmed" }),
  ),
  firstName: boundedString(256),
  middleName: z.optional(boundedString(256)),
  lastName: boundedString(256),
  company: z.optional(boundedString(256)),
  username: z.optional(boundedString(256)),
  /** Free text; commonly YYYY-MM-DD but never validated as a date, since forms disagree. */
  birthDate: z.optional(boundedString(32)),
  email: boundedString(256),
  phone: boundedString(64),
  street: boundedString(512),
  address2: z.optional(boundedString(512)),
  city: boundedString(256),
  state: boundedString(256),
  zip: boundedString(32),
  country: boundedString(256),
  passportNumber: z.optional(boundedString(64)),
  licenseNumber: z.optional(boundedString(64)),
  /** National identity number (SSN, NI number, Aadhaar, ...). */
  nationalId: z.optional(boundedString(64)),
  notes: boundedString(MAX_IDENTITY_NOTES_LENGTH),
});

export type IdentityItem = z.infer<typeof IdentityItemSchema>;
