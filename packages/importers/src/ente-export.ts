import { type ParsedOtpImport } from "./import-model";
import { exactKeys, requiredRecord } from "./json-candidate";
import { failJson, isPlainRecord, parseBoundedJson } from "./strict-json";

const ENVELOPE_KEYS = ["version", "kdfParams", "encryptedData", "encryptionNonce"] as const;
const KDF_KEYS = ["memLimit", "opsLimit", "salt"] as const;

export function parseEnteExport(text: string): ParsedOtpImport {
  const raw = parseBoundedJson(text);
  if (!isPlainRecord(raw)) return failJson("IMPORT_MALFORMED");
  if (!exactKeys(raw, ENVELOPE_KEYS) || raw.version !== 1) failJson("IMPORT_UNSUPPORTED");
  const kdfParams = requiredRecord(raw.kdfParams);
  if (
    !exactKeys(kdfParams, KDF_KEYS) ||
    !Number.isSafeInteger(kdfParams.memLimit) ||
    !Number.isSafeInteger(kdfParams.opsLimit) ||
    typeof kdfParams.salt !== "string" ||
    typeof raw.encryptedData !== "string" ||
    typeof raw.encryptionNonce !== "string"
  )
    failJson("IMPORT_UNSUPPORTED");
  return failJson("IMPORT_UNSUPPORTED");
}
