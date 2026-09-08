import {
  MAX_LOGIN_PASSWORD_HISTORY,
  searchableText,
  VaultItemSchema,
  type LoginItem,
  type SecretItem,
  type VaultItem,
} from "@shardpass/domain";
import {
  ItemCrudRequestSchema,
  ItemCrudResponseSchema,
  MAX_ITEM_QUERY_RESULTS,
  type ItemCreateManyEntry,
  type ItemCrudRequest,
  type ItemCrudResponse,
  type ItemListItemProjection,
  type SenderContext,
} from "@shardpass/messaging";

import type { SessionVaultRepository } from "../vault/session-vault-repository";
import { diagnostics } from "../../platform/diagnostics";

const MAX_ITEM_LIST_PREVIEW_LENGTH = 120;
const MUTATING_COMMANDS: ReadonlySet<ItemCrudRequest["kind"]> = new Set([
  "item.create",
  "item.createMany",
  "item.update",
  "item.delete",
]);

type ItemRepository = Pick<
  SessionVaultRepository,
  "listAllItems" | "getItem" | "createItem" | "createItems" | "updateItem" | "tombstone"
>;

export type ItemServiceErrorCode =
  "VAULT_LOCKED" | "VAULT_UNAVAILABLE" | "ITEM_INVALID" | "ITEM_NOT_FOUND" | "ITEM_CONFLICT";

export class ItemServiceError extends Error {
  constructor(readonly code: ItemServiceErrorCode) {
    super(code);
    this.name = "ItemServiceError";
  }
}

type ItemServiceDependencies = Readonly<{
  repository: ItemRepository;
  notePrivilegedActivity(): Promise<void>;
}>;

export class ItemService {
  constructor(private readonly dependencies: ItemServiceDependencies) {}

  async handle(request: ItemCrudRequest, sender: SenderContext): Promise<ItemCrudResponse> {
    try {
      const parsed = ItemCrudRequestSchema.safeParse(request);
      if (!parsed.success) invalid();
      const command = parsed.data;
      let result: ItemCrudResponse;
      switch (command.kind) {
        case "item.query":
          this.assertVaultSender(sender);
          result = await this.query(command);
          break;
        case "item.get":
          // Extension pages only (popup or vault); the router's policy already refuses others.
          if (sender.contextKind === "content") invalid();
          result = await this.get(command.itemId);
          break;
        case "item.create":
          this.assertVaultSender(sender);
          result = await this.create(command.item);
          break;
        case "item.createMany":
          this.assertVaultSender(sender);
          result = await this.createMany(command.items);
          break;
        case "item.update":
          this.assertVaultSender(sender);
          result = await this.update(command.itemId, command.expectedRevision, command.fields);
          break;
        case "item.delete":
          this.assertVaultSender(sender);
          result = await this.delete(command.itemId);
          break;
        case "item.list":
          result = await this.list(command);
          break;
      }
      // Only a change the user made counts as activity for the inactivity lock. Reads are
      // issued automatically -- the list refreshes, live codes poll -- so counting them would
      // keep an open vault tab unlocked indefinitely, which defeats the timer entirely.
      if (MUTATING_COMMANDS.has(command.kind)) {
        try {
          await this.dependencies.notePrivilegedActivity();
        } catch {
          // Activity scheduling is best-effort and cannot invalidate a completed operation.
        }
      }
      return result;
    } catch (error) {
      throw mapError(error);
    }
  }

  private async query(
    command: Extract<ItemCrudRequest, { kind: "item.query" }>,
  ): Promise<ItemCrudResponse> {
    let items = await this.dependencies.repository.listAllItems();
    // Archived items stay out of every ordinary view; the Archive view asks for them alone.
    items = items.filter((item) =>
      command.archived === true ? item.archivedAt !== undefined : item.archivedAt === undefined,
    );
    if (command.itemKind !== undefined)
      items = items.filter((item) => item.kind === command.itemKind);
    if (command.folderId !== undefined)
      items = items.filter((item) => item.folderId === command.folderId);
    if (command.favoritesOnly === true) items = items.filter((item) => item.favorite);
    if (command.search !== undefined) {
      const query = normalizeItemSearch(command.search);
      if (query.length > 0) items = items.filter((item) => matchesSearch(item, query));
    }
    const sorted = [...items].sort(compareItems).slice(0, MAX_ITEM_QUERY_RESULTS);
    return response({ version: 1, kind: "item.queryResult", items: sorted });
  }

  // Popup-safe counterpart to query(): filters/sorts the same way, but returns only
  // ItemListItemProjectionSchema (id/kind/revision/name/subtitle/favorite/tags) —
  // never the full VaultItem, so no plaintext secret ever reaches this response.
  private async list(
    command: Extract<ItemCrudRequest, { kind: "item.list" }>,
  ): Promise<ItemCrudResponse> {
    let items = await this.dependencies.repository.listAllItems();
    items = items.filter((item) => item.archivedAt === undefined);
    if (command.itemKind !== undefined)
      items = items.filter((item) => item.kind === command.itemKind);
    if (command.search !== undefined) {
      const query = normalizeItemSearch(command.search);
      if (query.length > 0) items = items.filter((item) => matchesSearch(item, query));
    }
    const sorted = [...items].sort(compareItems).slice(0, MAX_ITEM_QUERY_RESULTS);
    const projected: ItemListItemProjection[] = sorted.map(toListProjection);
    return response({ version: 1, kind: "item.listResult", items: projected });
  }

  private async get(itemId: string): Promise<ItemCrudResponse> {
    const item = await this.dependencies.repository.getItem(itemId);
    if (item === null) throw new ItemServiceError("ITEM_NOT_FOUND");
    return response({ version: 1, kind: "item.getResult", item });
  }

  private async create(rawItem: unknown): Promise<ItemCrudResponse> {
    const parsed = VaultItemSchema.safeParse(rawItem);
    if (!parsed.success) invalid();
    const created = await this.dependencies.repository.createItem(parsed.data);
    return response({ version: 1, kind: "item.mutationResult", item: created });
  }

  /**
   * Batch create for imports. Each candidate is validated here and checked against what the
   * vault already holds, so the caller learns per item whether it was created, skipped as a
   * duplicate, or rejected and why. Only the survivors go to the repository, which commits
   * them under a single write.
   */
  private async createMany(rawItems: readonly unknown[]): Promise<ItemCrudResponse> {
    const existing = await this.dependencies.repository.listAllItems();
    const seen = new Set(existing.map(duplicateKey));
    const results: ItemCreateManyEntry[] = [];
    const survivors: { index: number; item: VaultItem }[] = [];

    rawItems.forEach((raw, index) => {
      const parsed = VaultItemSchema.safeParse(raw);
      if (!parsed.success) {
        results[index] = { index, status: "invalid", reason: firstIssue(parsed.error) };
        return;
      }
      const key = duplicateKey(parsed.data);
      if (seen.has(key)) {
        results[index] = { index, status: "duplicate" };
        return;
      }
      seen.add(key);
      survivors.push({ index, item: parsed.data });
    });

    const outcomes =
      survivors.length === 0
        ? []
        : await this.dependencies.repository.createItems(survivors.map((entry) => entry.item));
    outcomes.forEach((outcome, position) => {
      const index = survivors[position]!.index;
      results[index] =
        outcome.status === "created"
          ? { index, status: "created", itemId: outcome.itemId }
          : { index, status: outcome.status };
    });
    return response({ version: 1, kind: "item.createManyResult", results });
  }

  private async update(
    itemId: string,
    expectedRevision: number,
    fields: unknown,
  ): Promise<ItemCrudResponse> {
    if (typeof fields !== "object" || fields === null || Array.isArray(fields)) invalid();
    const current = await this.dependencies.repository.getItem(itemId);
    if (current === null) throw new ItemServiceError("ITEM_NOT_FOUND");
    if (current.revision !== expectedRevision) conflict();
    // id/kind/schemaVersion/revision/createdAt are always re-derived by the repository
    // from the stored record regardless of what `fields` supplies, so pinning them here
    // (rather than trusting the caller) keeps the pre-validated candidate consistent with
    // what the repository will ultimately persist, instead of validating against a shape
    // the client tried to smuggle in (e.g. a different `kind`).
    const patch = fields as Record<string, unknown>;
    const merged: Record<string, unknown> = {
      ...current,
      ...patch,
      ...passwordHistoryFor(current, patch),
      id: current.id,
      kind: current.kind,
      schemaVersion: current.schemaVersion,
      revision: current.revision,
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
    };
    // `null` means "clear this field". The wire format drops `undefined` keys and a spread
    // cannot remove one, so this is the only way a client can un-file or un-archive an item.
    for (const [key, value] of Object.entries(patch)) if (value === null) delete merged[key];
    const parsed = VaultItemSchema.safeParse(merged);
    if (!parsed.success) invalid();
    const updated = await this.dependencies.repository.updateItem(parsed.data, expectedRevision);
    return response({ version: 1, kind: "item.mutationResult", item: updated });
  }

  private async delete(itemId: string): Promise<ItemCrudResponse> {
    const current = await this.dependencies.repository.getItem(itemId);
    if (current === null) throw new ItemServiceError("ITEM_NOT_FOUND");
    const deleted = await this.dependencies.repository.tombstone(itemId, current.revision);
    return response({
      version: 1,
      kind: "item.deleteResult",
      itemId: deleted.id,
      revision: deleted.revision,
    });
  }

  private assertVaultSender(sender: SenderContext): void {
    if (sender.contextKind !== "vault") invalid();
  }
}

export function normalizeItemSearch(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

function matchesSearch(item: VaultItem, query: string): boolean {
  return searchableText(item).some((value) => normalizeItemSearch(value).includes(query));
}

function primaryLabel(item: VaultItem): string {
  return item.kind === "otp" ? `${item.issuer} ${item.label}` : item.name;
}

function compareItems(left: VaultItem, right: VaultItem): number {
  if (left.favorite !== right.favorite) return left.favorite ? -1 : 1;
  return (
    compareText(
      normalizeItemSearch(primaryLabel(left)),
      normalizeItemSearch(primaryLabel(right)),
    ) || compareText(left.id, right.id)
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function response(candidate: ItemCrudResponse): ItemCrudResponse {
  const parsed = ItemCrudResponseSchema.safeParse(candidate);
  if (!parsed.success) invalid();
  return deepFreezeResponse(parsed.data);
}

function deepFreezeResponse(value: ItemCrudResponse): ItemCrudResponse {
  if (value.kind === "item.queryResult") {
    for (const item of value.items) freezeItem(item);
    Object.freeze(value.items);
  } else if (value.kind === "item.getResult" || value.kind === "item.mutationResult") {
    freezeItem(value.item);
  } else if (value.kind === "item.listResult") {
    for (const projection of value.items) freezeProjection(projection);
    Object.freeze(value.items);
  } else if (value.kind === "item.createManyResult") {
    for (const entry of value.results) Object.freeze(entry);
    Object.freeze(value.results);
  }
  return Object.freeze(value);
}

function freezeItem(item: VaultItem): void {
  Object.freeze(item.tags);
  if ("urls" in item) Object.freeze(item.urls);
  Object.freeze(item);
}

function freezeProjection(projection: ItemListItemProjection): void {
  Object.freeze(projection.tags);
  Object.freeze(projection);
}

function toListProjection(item: VaultItem): ItemListItemProjection {
  const { id, kind, revision, favorite, tags } = item;
  return {
    id,
    kind,
    revision,
    favorite,
    tags,
    ...listDisplayFields(item),
    ...(item.kind === "login" && item.urls.length > 0
      ? {
          urls: [...item.urls],
          ...(item.urlMatches === undefined ? {} : { urlMatches: [...item.urlMatches] }),
          ...(item.signInWith === undefined ? {} : { signInWith: item.signInWith }),
        }
      : {}),
  };
}

function listDisplayFields(item: VaultItem): Pick<ItemListItemProjection, "name" | "subtitle"> {
  switch (item.kind) {
    case "otp":
      return item.issuer.length > 0
        ? { name: item.issuer, subtitle: item.label }
        : { name: item.label };
    case "login":
      return item.username.length > 0
        ? { name: item.name, subtitle: item.username }
        : { name: item.name };
    case "note": {
      const preview = firstNonEmptyLine(item.content);
      return preview === undefined ? { name: item.name } : { name: item.name, subtitle: preview };
    }
    case "card": {
      const masked = maskCardNumber(item.number);
      return masked === undefined ? { name: item.name } : { name: item.name, subtitle: masked };
    }
    case "identity":
      return item.email.length > 0 ? { name: item.name, subtitle: item.email } : { name: item.name };
    case "secret":
      return { name: item.name, subtitle: secretTypeLabel(item.secretType) };
  }
}

function firstNonEmptyLine(content: string): string | undefined {
  const line = content
    .split(/\r?\n/u)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.length > 0);
  if (line === undefined) return undefined;
  return line.length > MAX_ITEM_LIST_PREVIEW_LENGTH
    ? `${line.slice(0, MAX_ITEM_LIST_PREVIEW_LENGTH)}…`
    : line;
}

function maskCardNumber(number: string): string | undefined {
  const digits = number.replaceAll(/\D/gu, "");
  if (digits.length < 4) return undefined;
  return `•••• ${digits.slice(-4)}`;
}

function secretTypeLabel(secretType: SecretItem["secretType"]): string {
  switch (secretType) {
    case "api_key":
      return "API key";
    case "ssh_key":
      return "SSH key";
    case "token":
      return "Token";
    case "env":
      return "Environment variable";
    case "other":
      return "Secret";
  }
}

/**
 * What makes two items "the same" for import purposes: the same account in the same place
 * with the same secret. A login is a duplicate only when name, username, site host, folder
 * and password all match, so "Router / admin" in Home and in Work with different passwords
 * are two items, as are two SSH keys with the same title. The key lives only in memory for
 * the length of one request and is never logged.
 */
function duplicateKey(item: VaultItem): string {
  const norm = normalizeItemSearch;
  const folder = item.folderId ?? "";
  switch (item.kind) {
    case "login":
      return ["login", norm(item.name), norm(item.username), hostOf(item.urls[0] ?? ""), folder, item.password].join("\u0000");
    case "otp":
      return ["otp", norm(item.issuer), norm(item.label), item.secret].join("\u0000");
    case "note":
      return ["note", norm(item.name), folder, item.content].join("\u0000");
    case "card":
      return ["card", norm(item.name), folder, item.number.replaceAll(/\D/gu, "")].join("\u0000");
    case "identity":
      return ["identity", norm(item.name), norm(item.email), folder].join("\u0000");
    case "secret":
      return ["secret", norm(item.name), item.secretType, folder, item.value].join("\u0000");
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLocaleLowerCase("en-US");
  } catch {
    return normalizeItemSearch(url);
  }
}

function firstIssue(error: { issues?: readonly { path?: readonly PropertyKey[]; message?: string }[] }): string {
  const issue = error.issues?.[0];
  if (issue === undefined) return "Did not match the item schema.";
  const path = (issue.path ?? []).map(String).join(".");
  const message = issue.message ?? "invalid";
  return (path === "" ? message : `${path}: ${message}`).slice(0, 256);
}

/**
 * Rolls the outgoing password into history when a login's password changes. Kept here, on
 * the background, so every client -- form, import, future autofill "update" prompt -- gets
 * it for free and none can forget. A caller that supplies passwordHistory explicitly (e.g.
 * restoring an old password) takes precedence.
 */
function passwordHistoryFor(
  current: VaultItem,
  fields: Record<string, unknown>,
): { passwordHistory?: LoginItem["passwordHistory"] } {
  if (current.kind !== "login" || "passwordHistory" in fields) return {};
  const next = fields["password"];
  if (typeof next !== "string" || next === current.password || current.password === "") return {};
  return {
    passwordHistory: [
      { password: current.password, changedAt: current.updatedAt },
      ...(current.passwordHistory ?? []),
    ].slice(0, MAX_LOGIN_PASSWORD_HISTORY),
  };
}

function invalid(): never {
  throw new ItemServiceError("ITEM_INVALID");
}

function conflict(): never {
  throw new ItemServiceError("ITEM_CONFLICT");
}

function errorCode(error: unknown): unknown {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return (error as { readonly code?: unknown }).code;
}

function mapError(error: unknown): ItemServiceError {
  if (error instanceof ItemServiceError) return error;
  const code = errorCode(error);
  if (code === "VAULT_LOCKED") return new ItemServiceError("VAULT_LOCKED");
  if (code === "REVISION_CONFLICT") return new ItemServiceError("ITEM_CONFLICT");
  if (code === "VAULT_INVALID") return new ItemServiceError("ITEM_INVALID");
  // Everything else is flattened to VAULT_UNAVAILABLE for the client, which is the right
  // amount of detail for a UI and the wrong amount for a diagnosis. Keep the original here.
  diagnostics.error("[ShardPass] item operation failed; reported as VAULT_UNAVAILABLE:", error);
  return new ItemServiceError("VAULT_UNAVAILABLE");
}
