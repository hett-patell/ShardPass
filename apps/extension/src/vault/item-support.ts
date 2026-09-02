import { ITEM_SCHEMA_VERSION, type ItemMetadata, type SecretItem, type VaultItem } from "@shardpass/domain";

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

/** Splits a comma-separated tag input into trimmed, non-empty tags. */
export function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/** Formats tags back into the comma-separated form the tag input displays. */
export function formatTags(tags: readonly string[]): string {
  return tags.join(", ");
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

export interface FolderSummary {
  id: string;
  label: string;
  count: number;
}

/**
 * Summarizes the folders referenced by the current item set. There is no folder
 * CRUD API yet (folders exist only as an optional `folderId` on each item), so
 * this derives a folder list purely from what items already reference, rather
 * than fetching folder records.
 */
export function summarizeFolders(items: readonly VaultItem[]): FolderSummary[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.folderId === undefined) continue;
    counts.set(item.folderId, (counts.get(item.folderId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, count]) => ({ id, label: `Folder ${id.slice(0, 8)}`, count }));
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
