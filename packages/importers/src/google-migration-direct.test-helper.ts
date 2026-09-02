import { decodeGoogleMigrationPayloads } from "./google-migration-decoder";
import { decodeGoogleMigrationUriBytes } from "./google-migration-input";
import type { ParsedOtpImport } from "./import-model";

/** Test-only direct decoder. Production callers use the dedicated Worker client. */
export function decodeGoogleMigrationUrisForTest(uris: readonly string[]): ParsedOtpImport {
  return decodeGoogleMigrationPayloads(decodeGoogleMigrationUriBytes(uris));
}
