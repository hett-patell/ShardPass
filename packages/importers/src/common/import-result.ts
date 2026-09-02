import type { VaultItem } from "@shardpass/domain";

/**
 * The result of running a third-party password manager importer.
 *
 * Importers never throw for malformed or partially-invalid input — a row or
 * entry that cannot be turned into a valid {@link VaultItem} is reported as a
 * warning instead, so a single bad row never aborts the rest of the import.
 */
export interface ImportResult {
  items: VaultItem[];
  warnings: string[];
}
