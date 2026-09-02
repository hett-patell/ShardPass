import type { VaultItem } from "@shardpass/domain";
import { parseItemCrudResponseForRequest } from "@shardpass/messaging";

import type { ExtensionPlatform } from "../../../platform/extension-platform";

export type SubmitItemResult =
  | Readonly<{ status: "saved"; item: VaultItem }>
  | Readonly<{ status: "conflict" }>
  | Readonly<{ status: "error" }>;

function errorCode(candidate: unknown): string | undefined {
  if (typeof candidate !== "object" || candidate === null || !("error" in candidate)) return undefined;
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
    return { status: "error" };
  } catch {
    return { status: "error" };
  }
}

/** Updates an existing vault item's editable fields via `item.update`. */
export async function updateItem(
  platform: Pick<ExtensionPlatform, "sendMessage">,
  itemId: string,
  expectedRevision: number,
  fields: Record<string, unknown>,
): Promise<SubmitItemResult> {
  const request = {
    version: 1 as const,
    kind: "item.update" as const,
    itemId,
    expectedRevision,
    fields,
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
