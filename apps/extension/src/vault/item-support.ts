import {
  ITEM_SCHEMA_VERSION,
  type Folder,
  type ItemMetadata,
  type SecretItem,
  type VaultItem,
} from "@shardpass/domain";

/**
 * Builds fresh item metadata for a client-side create draft. `revision`/`createdAt`/
 * `updatedAt` are placeholders only: the background item service always re-derives
 * them from the store when handling `item.create` (see ItemService.create /
 * VaultRepository.create), so these values only need to satisfy schema validation
 * before the request is sent — they are never trusted by the server.
 */
export function newItemMetadata(): ItemMetadata {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    schemaVersion: ITEM_SCHEMA_VERSION,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    favorite: false,
    tags: [],
  };
}

/**
 * Splits a comma-separated tag input into trimmed, non-empty tags. A tag repeated in another
 * case is dropped, keeping the first spelling.
 */
export function parseTags(value: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of value.split(",")) {
    const tag = raw.trim();
    // The same folding the schema applies, so nothing the form accepts is refused later.
    const key = tag.normalize("NFKC").toLocaleLowerCase("en-US");
    if (tag.length === 0 || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

/** Formats tags back into the comma-separated form the tag input displays. */
export function formatTags(tags: readonly string[]): string {
  return tags.join(", ");
}

/**
 * Where a failed schema parse is reported: beside the first issue's top-level field when the
 * form shows an error there, otherwise as the generic form-level message.
 */
export function schemaErrors<K extends string>(
  issues: readonly { readonly path: readonly PropertyKey[] }[],
  fields: readonly K[],
): Partial<Record<K | "form", string>> {
  const head = issues[0]?.path[0];
  const field = fields.find((candidate) => candidate === head);
  if (field === undefined)
    return { form: "Review the highlighted fields." } as Partial<Record<K | "form", string>>;
  return { [field]: "This value isn’t valid." } as Partial<Record<K | "form", string>>;
}

/** Display name for a vault item, matching the background item.list projection. */
export function itemDisplayName(item: VaultItem): string {
  return item.kind === "otp" ? item.issuer || item.label : item.name;
}

/** Kind-appropriate list subtitle, mirroring the background item.list projection. */
export function itemDisplaySubtitle(item: VaultItem): string | undefined {
  switch (item.kind) {
    case "otp":
      return item.issuer.length > 0 ? item.label : undefined;
    case "login":
      return item.username.length > 0 ? item.username : undefined;
    case "note": {
      const preview = item.content
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      return preview === undefined
        ? undefined
        : preview.length > 120
          ? `${preview.slice(0, 120)}…`
          : preview;
    }
    case "card":
      return maskCardNumber(item.number) || undefined;
    case "identity":
      return undefined;
    case "secret":
      return secretTypeLabel(item.secretType);
  }
}

/** Masks a card number as "•••• •••• •••• 4242", keeping only the last four digits visible. */
export function maskCardNumber(number: string): string {
  const digits = number.replace(/\D/gu, "");
  if (digits.length === 0) return "";
  if (digits.length <= 4) return digits;
  const masked = "•".repeat(digits.length - 4) + digits.slice(-4);
  return (masked.match(/.{1,4}/gu) ?? [masked]).join(" ");
}

/** Formats a card expiry as "MM/YY". */
export function formatCardExpiry(expMonth: string, expYear: string): string {
  const month = expMonth.padStart(2, "0");
  const year = expYear.length >= 2 ? expYear.slice(-2) : expYear.padStart(2, "0");
  if (month.length === 0 && year.length === 0) return "";
  return `${month}/${year}`;
}

/** Ids of `folderId` and every folder nested beneath it (the set a folder filter should match). */
export function folderSubtreeIds(
  folders: readonly Folder[],
  folderId: string,
): ReadonlySet<string> {
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    if (folder.parentId === undefined) continue;
    const siblings = children.get(folder.parentId) ?? [];
    siblings.push(folder.id);
    children.set(folder.parentId, siblings);
  }
  const ids = new Set<string>([folderId]);
  const queue = [folderId];
  while (queue.length > 0) {
    const next = queue.pop()!;
    for (const child of children.get(next) ?? []) {
      if (ids.has(child)) continue;
      ids.add(child);
      queue.push(child);
    }
  }
  return ids;
}

/** Items filed directly in each folder, keyed by folder id. */
export function countItemsByFolder(items: readonly VaultItem[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.folderId === undefined) continue;
    counts.set(item.folderId, (counts.get(item.folderId) ?? 0) + 1);
  }
  return counts;
}

/** "Work / Clients" style path for a folder select; ids that no longer resolve are shown bare. */
export function folderPath(folders: readonly Folder[], folderId: string): string {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  let current = byId.get(folderId);
  const seen = new Set<string>();
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId === undefined ? undefined : byId.get(current.parentId);
  }
  return names.length === 0 ? "Unknown folder" : names.join(" / ");
}

/** Depth-first order with each folder's depth, for indented tree rendering. */
export function folderTree(
  folders: readonly Folder[],
): readonly { folder: Folder; depth: number }[] {
  const byParent = new Map<string | undefined, Folder[]>();
  for (const folder of folders) {
    const siblings = byParent.get(folder.parentId) ?? [];
    siblings.push(folder);
    byParent.set(folder.parentId, siblings);
  }
  for (const siblings of byParent.values())
    siblings.sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    );
  const rows: { folder: Folder; depth: number }[] = [];
  const seen = new Set<string>();
  const visit = (parentId: string | undefined, depth: number) => {
    for (const folder of byParent.get(parentId) ?? []) {
      if (seen.has(folder.id)) continue;
      seen.add(folder.id);
      rows.push({ folder, depth });
      visit(folder.id, depth + 1);
    }
  };
  visit(undefined, 0);
  return rows;
}

export function secretTypeLabel(secretType: SecretItem["secretType"]): string {
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
