import { FolderSchema, MAX_FOLDERS, MAX_FOLDER_NAME_LENGTH } from "@shardpass/domain";
import { z } from "zod/mini";

import type { CommandSenderPolicy } from "./context";
import { MESSAGE_VERSION } from "./envelope";

const folderName = z.string().check(z.minLength(1), z.maxLength(MAX_FOLDER_NAME_LENGTH));

export const FolderListRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("folder.list"),
});
export const FolderCreateRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("folder.create"),
  name: folderName,
  parentId: z.optional(z.uuid()),
});
export const FolderRenameRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("folder.rename"),
  id: z.uuid(),
  name: folderName,
});
export const FolderDeleteRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("folder.delete"),
  id: z.uuid(),
});

export const FolderRequestSchema = z.discriminatedUnion("kind", [
  FolderListRequestSchema,
  FolderCreateRequestSchema,
  FolderRenameRequestSchema,
  FolderDeleteRequestSchema,
]);

/** Every folder command answers with the complete, current folder list. */
export const FolderListResultSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("folder.listResult"),
  folders: z.array(FolderSchema).check(z.maxLength(MAX_FOLDERS)),
});
export const FolderResponseSchema = FolderListResultSchema;

export type FolderRequest = z.infer<typeof FolderRequestSchema>;
export type FolderResponse = z.infer<typeof FolderResponseSchema>;
export type FolderCommandKind = FolderRequest["kind"];

export function parseFolderResponseForRequest(_request: FolderRequest, candidate: unknown) {
  const parsed = FolderResponseSchema.safeParse(candidate);
  return parsed.success
    ? { success: true as const, data: parsed.data }
    : { success: false as const };
}

// Folder names are vault metadata the popup never needs; every command is vault-only.
const vaultOnly = { allowedContexts: ["vault"], requireDocument: true } as const;
export const folderSenderPolicy = {
  "folder.list": vaultOnly,
  "folder.create": vaultOnly,
  "folder.rename": vaultOnly,
  "folder.delete": vaultOnly,
} satisfies Record<FolderCommandKind, CommandSenderPolicy>;
