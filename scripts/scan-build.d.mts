export interface BuildViolation {
  file: string;
  rule: string;
}

export interface ScanBuildOptions {
  projectRoot?: string;
}

export function scanBuild(directory: string, options?: ScanBuildOptions): Promise<BuildViolation[]>;
export function verifyLegacyArtifact(
  root: string,
  expected?: ReadonlyMap<string, string>,
): Promise<BuildViolation[]>;
