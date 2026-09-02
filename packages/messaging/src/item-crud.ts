import { VAULT_ITEM_KINDS } from "@shardpass/domain";
import { z } from "zod/mini";

import { MESSAGE_VERSION } from "./envelope";

export const ItemQueryRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("item.query"),
  itemKind: z.optional(z.enum(VAULT_ITEM_KINDS)),
  folderId: z.optional(z.uuid()),
  search: z.optional(z.string().check(z.maxLength(256))),
  favoritesOnly: z.optional(z.boolean()),
});

export const ItemGetRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("item.get"),
  itemId: z.uuid(),
});

export const ItemCreateRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("item.create"),
  item: z.unknown(),
});

export const ItemUpdateRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("item.update"),
  itemId: z.uuid(),
  expectedRevision: z.int().check(z.positive()),
  fields: z.unknown(),
});

export const ItemDeleteRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("item.delete"),
  itemId: z.uuid(),
});

export const ItemCrudRequestSchema = z.union([
  ItemQueryRequestSchema,
  ItemGetRequestSchema,
  ItemCreateRequestSchema,
  ItemUpdateRequestSchema,
  ItemDeleteRequestSchema,
]);
