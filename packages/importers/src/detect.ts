import { parseAegisExport } from "./aegis";
import { parseEnteExport } from "./ente-export";
import { type ParsedOtpImport } from "./import-model";
import { parseOtpAuthLines } from "./otpauth";
import { failJson, isPlainRecord, measureImportText, parseBoundedJson } from "./strict-json";

const MIGRATION_PREFIX = "otpauth-migration://offline?data=";

export function parseOtpImportText(text: string): ParsedOtpImport {
  measureImportText(text);
  if (text.startsWith(MIGRATION_PREFIX)) return failJson("IMPORT_UNSUPPORTED");

  const nonblank = text.split(/\r?\n/gu).filter((line) => line.trim().length > 0);
  if (nonblank.length > 0 && nonblank.every((line) => line.startsWith("otpauth://")))
    return parseOtpAuthLines(text);
  if (nonblank.some((line) => line.startsWith("otpauth://"))) failJson("IMPORT_MALFORMED");

  const raw = parseBoundedJson(text);
  if (!isPlainRecord(raw)) return failJson("IMPORT_MALFORMED");
  const hasAegisDiscriminator = Object.hasOwn(raw, "header") || Object.hasOwn(raw, "db");
  const hasEnteDiscriminator =
    Object.hasOwn(raw, "kdfParams") ||
    Object.hasOwn(raw, "encryptedData") ||
    Object.hasOwn(raw, "encryptionNonce");
  if (hasAegisDiscriminator && hasEnteDiscriminator) failJson("IMPORT_UNSUPPORTED");
  if (hasAegisDiscriminator) return parseAegisExport(text);
  if (hasEnteDiscriminator) return parseEnteExport(text);
  return failJson("IMPORT_UNSUPPORTED");
}
