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

/** A `key:value` filter: which part of an item a word must appear in. */
export type QueryField = "name" | "user" | "url" | "kind";
export const QUERY_FIELD_ALIASES: Readonly<Record<string, QueryField>> = {
  name: "name",
  title: "name",
  user: "user",
  username: "user",
  email: "user",
  url: "url",
  site: "url",
  host: "url",
  domain: "url",
  kind: "kind",
  type: "kind",
  is: "kind",
};
const KIND_ALIASES: Readonly<Record<string, VaultItem["kind"]>> = {
  login: "login",
  logins: "login",
  password: "login",
  otp: "otp",
  code: "otp",
  codes: "otp",
  totp: "otp",
  authenticator: "otp",
  note: "note",
  notes: "note",
  card: "card",
  cards: "card",
  identity: "identity",
  identities: "identity",
  secret: "secret",
  secrets: "secret",
  key: "secret",
};

export interface ParsedQuery {
  /** Free-text words; every one must appear somewhere in the item's searchable text. */
  readonly terms: readonly string[];
  /** `#tag` words (or `tag:` filters); every one must be a prefix of one of the item's tags. */
  readonly tags: readonly string[];
  /** `name:`, `user:`, `url:` and `kind:` filters; every one must hold. */
  readonly fields: readonly Readonly<{ field: QueryField; value: string }>[];
}

/**
 * "#work github" means: tagged work (by prefix) and mentioning github. "user:alice url:bank"
 * narrows to a field the way a mail search does; an unknown key is an ordinary word. A bare
 * "#" or an empty filter is ignored, so typing one does not empty the list.
 */
export function parseQuery(text: string): ParsedQuery {
  const terms: string[] = [];
  const tags: string[] = [];
  const fields: Array<Readonly<{ field: QueryField; value: string }>> = [];
  for (const raw of normalizeText(text).split(/\s+/u)) {
    if (raw === "") continue;
    if (raw.startsWith("#")) {
      const tag = raw.slice(1);
      if (tag !== "") tags.push(tag);
      continue;
    }
    const colon = raw.indexOf(":");
    if (colon > 0) {
      const key = raw.slice(0, colon);
      const value = raw.slice(colon + 1);
      if (key === "tag" || key === "tags") {
        if (value !== "") tags.push(value);
        continue;
      }
      const field = QUERY_FIELD_ALIASES[key];
      if (field !== undefined) {
        if (value !== "") fields.push({ field, value });
        continue;
      }
    }
    terms.push(raw);
  }
  return { terms, tags, fields };
}

function displayName(item: VaultItem): string {
  return item.kind === "otp" ? item.issuer || item.label : item.name;
}

function fieldText(item: VaultItem, field: QueryField): readonly string[] {
  const record = item as unknown as Record<string, unknown>;
  const text = (keys: readonly string[]) =>
    keys
      .map((key) => record[key])
      .filter((value): value is string => typeof value === "string" && value !== "");
  switch (field) {
    case "name":
      return [displayName(item)];
    case "user":
      return text(["username", "email", "label"]);
    case "url":
      return item.kind === "login" ? item.urls.map(hostOf) : [];
    case "kind":
      return [item.kind];
  }
}

export function matchesQuery(item: VaultItem, query: ParsedQuery): boolean {
  if (query.tags.length > 0) {
    const itemTags = item.tags.map(normalizeText);
    if (!query.tags.every((tag) => itemTags.some((candidate) => candidate.startsWith(tag))))
      return false;
  }
  for (const { field, value } of query.fields) {
    if (field === "kind") {
      if ((KIND_ALIASES[value] ?? value) !== item.kind) return false;
      continue;
    }
    if (
      !fieldText(item, field)
        .map(normalizeText)
        .some((candidate) => candidate.includes(value))
    )
      return false;
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

/** The moment an item was last put to use: a login's fill, else its last edit. */
function lastUsed(item: VaultItem): string {
  return (item.kind === "login" ? item.lastUsedAt : undefined) ?? item.updatedAt;
}

export function compareItems(sort: VaultSort): (left: VaultItem, right: VaultItem) => number {
  const byName = (left: VaultItem, right: VaultItem) =>
    normalizeText(displayName(left)).localeCompare(normalizeText(displayName(right))) ||
    left.id.localeCompare(right.id);
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
