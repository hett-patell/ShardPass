import { z } from "zod/mini";

import { ItemIdSchema } from "./item-metadata";
import { UnicodeScalarTextCheck } from "./unicode-scalar-text";

export const MAX_FOLDER_NAME_LENGTH = 128;
export const MAX_FOLDER_DEPTH = 3;
export const MAX_FOLDERS = 64;

export const FolderSchema = z.strictObject({
  id: ItemIdSchema,
  name: z.string().check(
    z.minLength(1),
    z.maxLength(MAX_FOLDER_NAME_LENGTH),
    UnicodeScalarTextCheck,
    z.refine((v) => v === v.trim(), { error: "Folder name must already be trimmed" }),
  ),
  parentId: z.optional(ItemIdSchema),
});

export type Folder = z.infer<typeof FolderSchema>;
