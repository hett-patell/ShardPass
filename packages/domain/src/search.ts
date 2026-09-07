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
