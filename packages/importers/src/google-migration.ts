import { type ParsedOtpImport } from "./import-model";
import {
  executeGoogleMigrationWorker,
  type GoogleMigrationParseOptions,
} from "./google-migration-worker-client";

export type { GoogleMigrationParseOptions } from "./google-migration-worker-client";

export function parseGoogleMigrationUris(
  uris: readonly string[],
  options?: GoogleMigrationParseOptions,
): Promise<ParsedOtpImport> {
  return executeGoogleMigrationWorker(uris, options);
}

export function parseGoogleMigrationUri(
  uri: string,
  options?: GoogleMigrationParseOptions,
): Promise<ParsedOtpImport> {
  return executeGoogleMigrationWorker([uri], options);
}
