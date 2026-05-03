import type { Account } from "@/types";
import { parseOtpAuthURI } from "@/lib/totp";

/**
 * Extract unique otpauth://totp or otpauth://hotp URIs from arbitrary text (.txt dumps,
 * markdown, logs). The match is intentionally permissive — anything non-whitespace after
 * the scheme is captured, and the otpauth parser does the real validation downstream.
 */
export function extractOtpAuthUris(raw: string): string[] {
  const re = /otpauth:\/\/(?:totp|hotp)\/\S+/gi;
  const seen = new Set<string>();
  for (const m of raw.matchAll(re)) {
    let u = m[0].trim();
    while (/[,;.:)\]>}"'`]+$/.test(u)) u = u.slice(0, -1).trimEnd();
    if (u.includes("otpauth://")) seen.add(u);
  }
  return [...seen];
}

export type ParsedFromUri = Omit<Account, "id" | "createdAt">;

/** Turn URIs into account drafts; skips HOTP/non-TOTP and malformed URIs. */
export function otpAuthUrisToAccountDrafts(uris: string[]): ParsedFromUri[] {
  const drafts: ParsedFromUri[] = [];
  const seenKey = new Set<string>();

  for (const uri of uris) {
    const parsed = parseOtpAuthURI(uri);
    if (!parsed) continue;
    const k = `${parsed.secret}:${parsed.issuer}:${parsed.label}`.toLowerCase();
    if (seenKey.has(k)) continue;
    seenKey.add(k);
    drafts.push({ ...parsed, tags: [] });
  }

  return drafts;
}
