import type { VaultItem } from "@shardpass/domain";
import {
  MAX_ITEM_CREATE_MANY,
  parseItemCrudResponseForRequest,
  type ItemCreateManyEntry,
} from "@shardpass/messaging";

import type { ExtensionPlatform } from "../../../platform/extension-platform";

export type SubmitItemResult =
  | Readonly<{ status: "saved"; item: VaultItem }>
  | Readonly<{ status: "conflict" }>
  | Readonly<{ status: "error"; code?: string }>;

function errorCode(candidate: unknown): string | undefined {
  if (typeof candidate !== "object" || candidate === null || !("error" in candidate))
    return undefined;
  const error = (candidate as { error?: unknown }).error;
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** Creates a new vault item via `item.create`. `item` must already satisfy the kind's schema. */
export async function createItem(
  platform: Pick<ExtensionPlatform, "sendMessage">,
  item: VaultItem,
): Promise<SubmitItemResult> {
  const request = { version: 1 as const, kind: "item.create" as const, item };
  try {
    const candidate = await platform.sendMessage(request);
    const parsed = parseItemCrudResponseForRequest(request, candidate);
    if (parsed.success && parsed.data.kind === "item.mutationResult") {
      return { status: "saved", item: parsed.data.item };
    }
    const code = errorCode(candidate);
    return code === undefined ? { status: "error" } : { status: "error", code };
  } catch {
    return { status: "error" };
  }
}

/**
 * Creates many items in one `item.createMany` round trip. Results are positional. A failure
 * of the whole call (locked vault, no response) is reported against every entry so the
 * caller always gets one outcome per item and never has to guess.
 */
export async function createItems(
  platform: Pick<ExtensionPlatform, "sendMessage">,
  items: readonly VaultItem[],
): Promise<readonly ItemCreateManyEntry[]> {
  if (items.length > MAX_ITEM_CREATE_MANY)
    throw new RangeError(`createItems accepts at most ${MAX_ITEM_CREATE_MANY} items per call.`);
  // Spread into a mutable array: the request schema types `items` as unknown[].
  const request = { version: 1 as const, kind: "item.createMany" as const, items: [...items] };
  const everyEntry = (reason: string): ItemCreateManyEntry[] =>
    items.map((_, index) => ({ index, status: "invalid" as const, reason }));
  try {
    const candidate = await platform.sendMessage(request);
    const parsed = parseItemCrudResponseForRequest(request, candidate);
    if (parsed.success && parsed.data.kind === "item.createManyResult") return parsed.data.results;
    return everyEntry(errorCode(candidate) ?? "UNEXPECTED");
  } catch {
    return everyEntry("No response from the background service.");
  }
}

/** Updates an existing vault item's editable fields via `item.update`. */
export async function updateItem(
  platform: Pick<ExtensionPlatform, "sendMessage">,
  itemId: string,
  expectedRevision: number,
  fields: Record<string, unknown>,
): Promise<SubmitItemResult> {
  // Chrome's message serialization drops `undefined` keys, and the background merges with a
  // spread, so "clear this field" must travel as `null` (which the service deletes).
  const request = {
    version: 1 as const,
    kind: "item.update" as const,
    itemId,
    expectedRevision,
    fields: Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, value === undefined ? null : value]),
    ),
  };
  try {
    const candidate = await platform.sendMessage(request);
    const parsed = parseItemCrudResponseForRequest(request, candidate);
    if (parsed.success && parsed.data.kind === "item.mutationResult") {
      return { status: "saved", item: parsed.data.item };
    }
    return errorCode(candidate) === "ITEM_CONFLICT" ? { status: "conflict" } : { status: "error" };
  } catch {
    return { status: "error" };
  }
}
