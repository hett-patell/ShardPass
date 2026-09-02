import { VAULT_ITEM_KINDS, VaultItemSchema } from "@shardpass/domain";
import { z } from "zod/mini";

import type { CommandSenderPolicy } from "./context";
import { MESSAGE_VERSION } from "./envelope";

export const MAX_ITEM_QUERY_RESULTS = 10_000;

const itemId = z.uuid();
const positiveSafeInteger = z.int().check(z.positive(), z.maximum(Number.MAX_SAFE_INTEGER));

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
  itemId,
});

export const ItemCreateRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("item.create"),
  item: z.unknown(),
});

export const ItemUpdateRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("item.update"),
  itemId,
  expectedRevision: positiveSafeInteger,
  fields: z.unknown(),
});

export const ItemDeleteRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("item.delete"),
  itemId,
});

export const ItemCrudRequestSchema = z.discriminatedUnion("kind", [
  ItemQueryRequestSchema,
  ItemGetRequestSchema,
  ItemCreateRequestSchema,
  ItemUpdateRequestSchema,
  ItemDeleteRequestSchema,
]);

export const ItemQueryResultSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("item.queryResult"),
  items: z.array(VaultItemSchema).check(z.maxLength(MAX_ITEM_QUERY_RESULTS)),
});

export const ItemGetResultSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("item.getResult"),
  item: VaultItemSchema,
});

export const ItemMutationResultSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("item.mutationResult"),
  item: VaultItemSchema,
});

export const ItemDeleteResultSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("item.deleteResult"),
  itemId,
  revision: positiveSafeInteger,
});

export const ItemCrudResponseSchema = z.discriminatedUnion("kind", [
  ItemQueryResultSchema,
  ItemGetResultSchema,
  ItemMutationResultSchema,
  ItemDeleteResultSchema,
]);

export type ItemCrudRequest = z.infer<typeof ItemCrudRequestSchema>;
export type ItemCrudResponse = z.infer<typeof ItemCrudResponseSchema>;
export type ItemCrudCommandKind = ItemCrudRequest["kind"];
export type ItemCrudResponseKind = ItemCrudResponse["kind"];

export const itemCrudResponseKindByRequest = {
  "item.query": "item.queryResult",
  "item.get": "item.getResult",
  "item.create": "item.mutationResult",
  "item.update": "item.mutationResult",
  "item.delete": "item.deleteResult",
} as const satisfies Record<ItemCrudCommandKind, ItemCrudResponseKind>;

export function parseItemCrudResponseForRequest(request: ItemCrudRequest, candidate: unknown) {
  const parsed = ItemCrudResponseSchema.safeParse(candidate);
  if (!parsed.success || parsed.data.kind !== itemCrudResponseKindByRequest[request.kind]) {
    return { success: false as const };
  }
  return { success: true as const, data: parsed.data };
}

const popupAndVault = { allowedContexts: ["popup", "vault"], requireDocument: true } as const;
const vaultOnly = { allowedContexts: ["vault"], requireDocument: true } as const;

export const itemCrudSenderPolicy = {
  "item.query": popupAndVault,
  "item.get": popupAndVault,
  "item.create": vaultOnly,
  "item.update": vaultOnly,
  "item.delete": vaultOnly,
} satisfies Record<ItemCrudCommandKind, CommandSenderPolicy>;
