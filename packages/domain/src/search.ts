import type { VaultItem } from "./otp-item";

/** Fields a person would type to find each kind of item. Never a password, secret or number. */
const SEARCH_KEYS: Readonly<Record<VaultItem["kind"], readonly string[]>> = {
  login: ["name", "username"],
  otp: ["issuer", "label"],
  note: ["name", "content"],
  card: ["name", "cardholderName", "holderName"],
  identity: ["name", "firstName", "lastName", "email", "username", "company"],
  secret: ["name"],
};

function hostOf(url: string): string {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//iu.test(url) ? url : `https://${url}`).host;
  } catch {
    return url;
  }
}

/**
 * The strings a search should match against for `item`: its display fields, tags, and for a
 * login the hosts of its saved URLs (so "github" finds the GitHub login). Keys that a kind
 * does not have are simply skipped, so the list stays correct as schemas grow.
 */
export function searchableText(item: VaultItem): readonly string[] {
  const record = item as unknown as Record<string, unknown>;
  const values: string[] = [];
  for (const key of SEARCH_KEYS[item.kind] ?? []) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) values.push(value);
  }
  if (item.kind === "login") for (const url of item.urls) values.push(hostOf(url));
  values.push(...item.tags);
  return values;
}

export function normalizeText(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

export interface ParsedQuery {
  /** Free-text words; every one must appear somewhere in the item's searchable text. */
  readonly terms: readonly string[];
  /** `#tag` words; every one must be a prefix of one of the item's tags. */
  readonly tags: readonly string[];
}

/**
 * "#work github" means: tagged work (by prefix) and mentioning github. A bare "#" is ignored,
 * so typing the hash to start a tag does not empty the list.
 */
export function parseQuery(text: string): ParsedQuery {
  const terms: string[] = [];
  const tags: string[] = [];
  for (const raw of normalizeText(text).split(/\s+/u)) {
    if (raw === "") continue;
    if (raw.startsWith("#")) {
      const tag = raw.slice(1);
      if (tag !== "") tags.push(tag);
    } else terms.push(raw);
  }
  return { terms, tags };
}

export function matchesQuery(item: VaultItem, query: ParsedQuery): boolean {
  if (query.tags.length > 0) {
    const itemTags = item.tags.map(normalizeText);
    if (!query.tags.every((tag) => itemTags.some((candidate) => candidate.startsWith(tag)))) return false;
  }
  if (query.terms.length === 0) return true;
  const haystack = searchableText(item).map(normalizeText);
  return query.terms.every((term) => haystack.some((value) => value.includes(term)));
}

export type VaultSort = "name" | "recent" | "added" | "updated";

export const VAULT_SORTS: readonly Readonly<{ id: VaultSort; label: string }>[] = [
  { id: "name", label: "Name" },
  { id: "recent", label: "Recently used" },
  { id: "added", label: "Recently added" },
  { id: "updated", label: "Recently updated" },
];

function displayName(item: VaultItem): string {
  return item.kind === "otp" ? item.issuer || item.label : item.name;
}

/** The moment an item was last put to use: a login's fill, else its last edit. */
function lastUsed(item: VaultItem): string {
  return (item.kind === "login" ? item.lastUsedAt : undefined) ?? item.updatedAt;
}

export function compareItems(sort: VaultSort): (left: VaultItem, right: VaultItem) => number {
  const byName = (left: VaultItem, right: VaultItem) =>
    normalizeText(displayName(left)).localeCompare(normalizeText(displayName(right))) || left.id.localeCompare(right.id);
  switch (sort) {
    case "recent":
      return (left, right) => lastUsed(right).localeCompare(lastUsed(left)) || byName(left, right);
    case "added":
      return (left, right) => right.createdAt.localeCompare(left.createdAt) || byName(left, right);
    case "updated":
      return (left, right) => right.updatedAt.localeCompare(left.updatedAt) || byName(left, right);
    default:
      return byName;
  }
}
