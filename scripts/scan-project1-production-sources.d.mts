import type { SecretScanReport } from "./scan-secrets.mjs";

export type ProductionSourceRoot = Readonly<{
  name: string;
  files: readonly string[];
}>;
export type ProductionSourceManifest = Readonly<{
  roots: readonly ProductionSourceRoot[];
  files: readonly string[];
  excludedTestOnlyFiles: readonly string[];
}>;
export type ProductionSourceScanReport = Readonly<{
  schemaVersion: 1;
  manifestSha256: string;
  allowlistSha256: string;
  excludedTestOnlyFiles: readonly string[];
  eligibleFileCount: number;
  reports: readonly SecretScanReport[];
  status: "PASS" | "FAIL";
}>;
export function enumerateEligibleProductionSources(
  projectRoot: string,
): Promise<readonly ProductionSourceRoot[]>;
export function parseProductionSourceManifest(text: string): ProductionSourceManifest;
export function scanProductionSources(
  options: Readonly<{
    projectRoot: string;
    manifestPath: string;
    manifestText?: string;
    allowlistPath: string;
  }>,
): Promise<ProductionSourceScanReport>;
