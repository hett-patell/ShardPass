export type ReleaseInputManifest = Readonly<{
  schemaVersion: 2;
  allowedTopLevel: readonly string[];
  includes: readonly string[];
  excludes: readonly string[];
}>;
export type DisposableWorkspace = Readonly<{
  root: string;
  storeDirectory: string;
  storeIdentity: string;
  sourceSnapshotSha256: string;
  releaseInputsSha256: string;
  files: readonly string[];
  fileHashes: readonly Readonly<{ path: string; size: number; sha256: string }>[];
  parent: string;
}>;
export type BootstrapEvidence = Readonly<{
  schemaVersion: 1;
  command: "pnpm install --frozen-lockfile";
  nodeVersion: string;
  pnpmVersion: string;
  packageManager: string;
  engines: Readonly<{ node: string; pnpm: string }>;
  platform: string;
  arch: string;
  registryOrigin: string;
  storeIdentity: string;
  sourceSnapshotSha256: string;
  outputSha256: string;
  status: "PASS";
}>;
export function parseReleaseInputManifest(text: string): ReleaseInputManifest;
export function createDisposableWorkspace(
  options: Readonly<{
    sourceRoot: string | URL;
    manifestPath: string | URL;
    temporaryRoot?: string;
    sharedStoreDirectory?: string;
  }>,
): Promise<DisposableWorkspace>;
export function createIndependentRebuildWorkspace(
  options: Readonly<{
    firstWorkspace: DisposableWorkspace;
    sourceRoot: string | URL;
    manifestPath: string | URL;
    temporaryRoot?: string;
  }>,
): Promise<DisposableWorkspace>;
export function runFrozenBootstrap(
  workspace: DisposableWorkspace,
  options: Readonly<{
    registryOrigin: string;
    timeoutMs?: number;
    runCommand?: (
      command: string,
      args: readonly string[],
      options: Readonly<{ cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }>,
    ) => Promise<Buffer>;
  }>,
): Promise<BootstrapEvidence>;
export function assertWorkspaceUnchanged(workspace: DisposableWorkspace): Promise<void>;
export function cleanupDisposableWorkspace(workspace: DisposableWorkspace): Promise<void>;
