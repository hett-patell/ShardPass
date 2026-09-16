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
  if (value.length <= max) return value;
  warnings.push(`"${label}": ${field} was longer than ${max} characters and was truncated.`);
  return cutUnits(value, max);
}

/**
 * The schemas measure text the way JavaScript does, in UTF-16 units, so the cut is made in
 * those units too; a pair split in the middle would leave a lone surrogate the schemas refuse.
 */
export function cutUnits(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  return /[\uD800-\uDBFF]$/u.test(cut) ? cut.slice(0, -1) : cut;
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
  return trimmed.length <= MAX_WARNING_LABEL_LENGTH
    ? trimmed
    : `${cutUnits(trimmed, MAX_WARNING_LABEL_LENGTH)}…`;
}

/**
 * Tags must be unique after Unicode and case normalisation, so "Work" and "work" on one
 * entry would otherwise reject the entire item. Later duplicates are dropped and the list
 * is bounded to what the schema accepts.
 */
export function normalizeTags(
  tags: readonly string[],
  label: string,
  warnings: string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    // Cut, then trimmed again: a cut that lands on a space would fail the schema's trim rule.
    const tag = cutUnits(raw.trim(), MAX_ITEM_TAG_LENGTH).trim();
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
  schema: {
    safeParse(
      value: unknown,
    ): { success: true; data: T } | { success: false; error: SchemaFailure };
  },
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
