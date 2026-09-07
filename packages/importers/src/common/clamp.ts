import { MAX_ITEM_TAGS, MAX_ITEM_TAG_LENGTH } from "@shardpass/domain";

/** How much of a row's name a warning quotes before it stops being a label and becomes noise. */
const MAX_WARNING_LABEL_LENGTH = 80;

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
 * Names must be trimmed and non-empty after clamping, so a name that is truncated onto a
 * space would otherwise fail the schema for a reason nobody can see.
 */
export function clampName(
  value: string,
  max: number,
  fallback: string,
  label: string,
  warnings: string[],
): string {
  const clamped = clampText(value.trim(), max, "name", label, warnings).trim();
  return clamped === "" ? fallback : clamped;
}

/** A row's label for warnings: its own name, shortened so a runaway cell cannot flood the list. */
export function warningLabel(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return fallback;
  const scalars = Array.from(trimmed);
  return scalars.length <= MAX_WARNING_LABEL_LENGTH
    ? trimmed
    : `${scalars.slice(0, MAX_WARNING_LABEL_LENGTH).join("")}…`;
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

/** Bounds a list to what the schema holds, saying what was dropped. */
export function clampList<T>(
  values: readonly T[],
  max: number,
  what: string,
  label: string,
  warnings: string[],
): T[] {
  if (values.length <= max) return [...values];
  warnings.push(`"${label}": only the first ${max} ${what} were kept.`);
  return values.slice(0, max);
}

const PEM_MARKER = "-----BEGIN";

/** True when text looks like a PEM-armoured key, wherever an importer finds it. */
export function looksLikeKeyMaterial(value: string): boolean {
  return value.includes(PEM_MARKER);
}

type SchemaIssue = Readonly<{ path: readonly PropertyKey[] }>;
type SchemaFailure = Readonly<{ issues: readonly SchemaIssue[] }>;

/**
 * Names the first field a schema rejected ("urls[0]", "customFields[3].name"), so a skipped
 * row says what was wrong with it instead of just that something was.
 */
export function firstInvalidField(error: SchemaFailure): string {
  const path = error.issues[0]?.path ?? [];
  if (path.length === 0) return "item";
  return path
    .map((segment, index) =>
      typeof segment === "number"
        ? `[${segment}]`
        : index === 0
          ? String(segment)
          : `.${String(segment)}`,
    )
    .join("");
}

/**
 * Validates a candidate against its kind's schema, keeping it on success and otherwise
 * reporting which field failed. Returns whether the item was kept.
 */
export function keepIfValid<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: SchemaFailure } },
  candidate: unknown,
  kind: string,
  label: string,
  warnings: string[],
  items: T[],
): boolean {
  const parsed = schema.safeParse(candidate);
  if (parsed.success) {
    items.push(parsed.data);
    return true;
  }
  warnings.push(
    `Skipped "${label}": invalid ${kind} item (${firstInvalidField(parsed.error)} did not pass validation).`,
  );
  return false;
}
