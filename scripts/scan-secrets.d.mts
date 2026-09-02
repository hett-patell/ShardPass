export const SECRET_SCANNER_SCHEMA_VERSION: 1;
export const REPORTABLE_RULE_IDS: readonly string[];

export type SecretScanMode = "source" | "candidate";
export type SecretAllowanceRationale =
  | "documented-public-key"
  | "reserved-synthetic-fixture"
  | "reviewed-public-identifier"
  | "scanner-test-canary";

export type SecretScanOptions = Readonly<{
  root: string | URL;
  rootName: string;
  mode: SecretScanMode;
  allowlistPath: string | URL;
  maxTextBytes: number;
  maxBinaryBytes: number;
}>;

export type SecretFinding = Readonly<{
  ruleId: string;
  path: string;
  fileSha256: string;
  matchSha256: string;
  startByte: number;
  endByte: number;
  count: number;
}>;

export type SecretAllowance = Readonly<{
  schemaVersion: 1;
  scannerSchemaVersion: 1;
  mode: SecretScanMode;
  ruleId: string;
  path: string;
  fileSha256: string;
  matchSha256: string;
  startByte: number;
  endByte: number;
  count: number;
  rationale: SecretAllowanceRationale;
}>;

export type SecretScanReport = Readonly<{
  schemaVersion: 1;
  mode: SecretScanMode;
  rootName: string;
  rootDigest: string;
  allowlistSha256: string;
  filesScanned: number;
  findings: readonly SecretFinding[];
  allowancesUsed: readonly SecretAllowance[];
  status: "PASS" | "FAIL";
}>;

export function scanSecretRoot(options: SecretScanOptions): Promise<SecretScanReport>;
export function parseSecretAllowlist(text: string): readonly SecretAllowance[];
export function verifySecretScanReport(report: SecretScanReport): void;
