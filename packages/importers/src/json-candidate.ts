import { isCanonicalUnpaddedBase32 } from "@shardpass/domain";

import { safeImportMetadata, type OtpImportCandidate } from "./import-model";
import { failJson, isPlainRecord } from "./strict-json";

export function canonicalJsonSecret(value: unknown): string {
  if (typeof value !== "string") return failJson("IMPORT_UNSUPPORTED");
  const canonical = value.replace(/[\s-]/gu, "").replace(/=+$/u, "").toUpperCase();
  if (!isCanonicalUnpaddedBase32(canonical)) failJson("IMPORT_UNSUPPORTED");
  return canonical;
}

export function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

export function validatedCandidate(candidate: OtpImportCandidate): OtpImportCandidate {
  try {
    safeImportMetadata(candidate);
  } catch {
    failJson("IMPORT_UNSUPPORTED");
  }
  return Object.freeze({ ...candidate, tags: Object.freeze([...candidate.tags]) });
}

export function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    return failJson("IMPORT_UNSUPPORTED");
  return value as string[];
}

export function requiredRecord(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) return failJson("IMPORT_UNSUPPORTED");
  return value;
}
