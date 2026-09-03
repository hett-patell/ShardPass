import { MAX_ITEM_TAGS, MAX_ITEM_TAG_LENGTH } from "@shardpass/domain";

/**
 * Fits imported text to a schema ceiling instead of letting the whole item be rejected
 * later with no explanation. Truncation is reported so nothing is lost silently.
 */
export function clampText(
  value: string,
  max: number,
  field: string,
  label: string,
  warnings: string[],
): string {
  const scalars = Array.from(value);
  if (scalars.length <= max) return value;
  warnings.push(`"${label}": ${field} was longer than ${max} characters and was truncated.`);
  return scalars.slice(0, max).join("");
}

/**
 * Tags must be unique after Unicode and case normalisation, so "Work" and "work" on one
 * entry would otherwise reject the entire item. Later duplicates are dropped and the list
 * is bounded to what the schema accepts.
 */
export function normalizeTags(tags: readonly string[], label: string, warnings: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = Array.from(raw.trim()).slice(0, MAX_ITEM_TAG_LENGTH).join("");
    if (tag === "") continue;
    const key = tag.normalize("NFKC").toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  if (out.length > MAX_ITEM_TAGS) {
    warnings.push(`"${label}": only the first ${MAX_ITEM_TAGS} tags were kept.`);
    return out.slice(0, MAX_ITEM_TAGS);
  }
  return out;
}

const PEM_MARKER = "-----BEGIN";

/** True when text looks like a PEM-armoured key, wherever an importer finds it. */
export function looksLikeKeyMaterial(value: string): boolean {
  return value.includes(PEM_MARKER);
}
