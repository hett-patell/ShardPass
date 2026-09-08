import {
  MAX_ITEM_TAGS,
  MAX_ITEM_TAG_LENGTH,
  VAULT_ITEM_KINDS,
  VaultItemSchema,
  SIGN_IN_PROVIDERS,
} from "@shardpass/domain";
import { z } from "zod/mini";

import type { CommandSenderPolicy } from "./context";
import { MESSAGE_VERSION } from "./envelope";

export const MAX_ITEM_QUERY_RESULTS = 10_000;
/** Matches the importer entry cap: one import never needs more than one batch. */
export const MAX_ITEM_CREATE_MANY = 1_000;
export const MAX_ITEM_CREATE_MANY_REASON_LENGTH = 256;
export const MAX_ITEM_LIST_NAME_LENGTH = 1_024;
export const MAX_ITEM_LIST_SUBTITLE_LENGTH = 512;

const itemId = z.uuid();
const positiveSafeInteger = z.int().check(z.positive(), z.maximum(Number.MAX_SAFE_INTEGER));
const projectionTags = z
  .array(z.string().check(z.minLength(1), z.maxLength(MAX_ITEM_TAG_LENGTH)))
  .check(z.maxLength(MAX_ITEM_TAGS));

export const ItemQueryRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("item.query"),
  itemKind: z.optional(z.enum(VAULT_ITEM_KINDS)),
  folderId: z.optional(z.uuid()),
  search: z.optional(z.string().check(z.maxLength(256))),
  favoritesOnly: z.optional(z.boolean()),
  /** true: only archived items. Omitted or false: only unarchived items. */
  archived: z.optional(z.boolean()),
});

// A read-only, secret-free projection of the vault item list, safe for the popup surface.
// Unlike item.query/item.get (which return the full VaultItem, including plaintext login
// passwords, card numbers, identity fields, or secret values, and are therefore vault-only),
// item.list carries only display metadata: a computed name, an optional non-secret subtitle
// (username, masked card digits, a note preview, etc.), and tags. This mirrors the existing
// otp.list / OtpListItemProjection split between a popup-safe list and the vault-only editor.
export const ItemListRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("item.list"),
  itemKind: z.optional(z.enum(VAULT_ITEM_KINDS)),
  search: z.optional(z.string().check(z.maxLength(256))),
});

export const ItemListItemProjectionSchema = z.strictObject({
  id: itemId,
  kind: z.enum(VAULT_ITEM_KINDS),
  revision: positiveSafeInteger,
  name: z.string().check(z.maxLength(MAX_ITEM_LIST_NAME_LENGTH)),
  subtitle: z.optional(z.string().check(z.maxLength(MAX_ITEM_LIST_SUBTITLE_LENGTH))),
  favorite: z.boolean(),
  tags: projectionTags,
  /** A login's saved sites and match modes, so the popup can suggest it for the open tab. */
  urls: z.optional(z.array(z.string().check(z.maxLength(2048))).check(z.maxLength(32))),
  urlMatches: z.optional(
    z.array(z.enum(["domain", "host", "startsWith", "exact", "never"])).check(z.maxLength(32)),
  ),
  /** A login that signs in through a provider rather than a password. */
  signInWith: z.optional(z.enum(SIGN_IN_PROVIDERS)),
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

// Batch creation for imports. Each candidate is judged on its own -- one malformed entry
// never aborts the rest -- while every accepted entry lands under a single vault commit,
// so a large import costs one load and one write instead of one of each per item.
export const ItemCreateManyRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("item.createMany"),
  items: z.array(z.unknown()).check(z.maxLength(MAX_ITEM_CREATE_MANY)),
});

const batchIndex = z.int().check(z.nonnegative(), z.maximum(MAX_ITEM_CREATE_MANY));
export const ItemCreateManyEntrySchema = z.discriminatedUnion("status", [
  z.strictObject({ index: batchIndex, status: z.literal("created"), itemId }),
  // Something equivalent is already in the vault; the candidate was not written.
  z.strictObject({ index: batchIndex, status: z.literal("duplicate") }),
  // The candidate's own id is already taken.
  z.strictObject({ index: batchIndex, status: z.literal("conflict") }),
  z.strictObject({
    index: batchIndex,
    status: z.literal("invalid"),
    reason: z.optional(z.string().check(z.maxLength(MAX_ITEM_CREATE_MANY_REASON_LENGTH))),
  }),
]);

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
  ItemCreateManyRequestSchema,
  ItemUpdateRequestSchema,
  ItemDeleteRequestSchema,
  ItemListRequestSchema,
]);

export const ItemQueryResultSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("item.queryResult"),
  items: z.array(VaultItemSchema).check(z.maxLength(MAX_ITEM_QUERY_RESULTS)),
});

export const ItemListResultSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("item.listResult"),
  items: z.array(ItemListItemProjectionSchema).check(z.maxLength(MAX_ITEM_QUERY_RESULTS)),
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

export const ItemCreateManyResultSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("item.createManyResult"),
  results: z.array(ItemCreateManyEntrySchema).check(z.maxLength(MAX_ITEM_CREATE_MANY)),
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
  ItemCreateManyResultSchema,
  ItemDeleteResultSchema,
  ItemListResultSchema,
]);

export type ItemCrudRequest = z.infer<typeof ItemCrudRequestSchema>;
export type ItemCrudResponse = z.infer<typeof ItemCrudResponseSchema>;
export type ItemCrudCommandKind = ItemCrudRequest["kind"];
export type ItemCrudResponseKind = ItemCrudResponse["kind"];
export type ItemListItemProjection = z.infer<typeof ItemListItemProjectionSchema>;
export type ItemCreateManyEntry = z.infer<typeof ItemCreateManyEntrySchema>;

export const itemCrudResponseKindByRequest = {
  "item.query": "item.queryResult",
  "item.get": "item.getResult",
  "item.create": "item.mutationResult",
  "item.createMany": "item.createManyResult",
  "item.update": "item.mutationResult",
  "item.delete": "item.deleteResult",
  "item.list": "item.listResult",
} as const satisfies Record<ItemCrudCommandKind, ItemCrudResponseKind>;

export function parseItemCrudResponseForRequest(request: ItemCrudRequest, candidate: unknown) {
  const parsed = ItemCrudResponseSchema.safeParse(candidate);
  if (!parsed.success || parsed.data.kind !== itemCrudResponseKindByRequest[request.kind]) {
    return { success: false as const };
  }
  return { success: true as const, data: parsed.data };
}

const vaultOnly = { allowedContexts: ["vault"], requireDocument: true } as const;
const popupAndVault = { allowedContexts: ["popup", "vault"], requireDocument: true } as const;

// Unlike otp.list/otp.getCode (which return a secret-free projection safe for the
// popup surface), item.query/item.get/item.create/item.update/item.delete return the
// full VaultItem — including the plaintext login password, card number, identity
// fields, or secret value — for every kind. Those commands are therefore restricted
// to the vault page, the same full-secret-access surface as
// otp.getEditor/create/update/delete. item.list is the secret-free counterpart (see
// ItemListItemProjectionSchema above) and is safe for the popup, mirroring otp.list.
export const itemCrudSenderPolicy = {
  "item.query": vaultOnly,
  // The popup's detail screen needs the whole item; popup and vault page share one origin.
  "item.get": popupAndVault,
  "item.create": vaultOnly,
  "item.createMany": vaultOnly,
  "item.update": vaultOnly,
  "item.delete": vaultOnly,
  "item.list": popupAndVault,
} satisfies Record<ItemCrudCommandKind, CommandSenderPolicy>;
