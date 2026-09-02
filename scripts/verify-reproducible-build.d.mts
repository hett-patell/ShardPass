export interface BuildFileSnapshot {
  path: string;
  sha256: string;
}

export function snapshotBuildDirectory(directory: string): Promise<BuildFileSnapshot[]>;
export function compareBuildDirectories(first: string, second: string): Promise<string[]>;
