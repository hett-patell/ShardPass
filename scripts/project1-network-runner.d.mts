export type NetworkMode = "bootstrap" | "offline" | "mock" | "audit";
export type NetworkAttempt = Readonly<{
  protocol: string;
  host: string;
  port: number;
  outcome: "allowed" | "denied";
}>;
export type IsolationRequest = Readonly<{
  mode: NetworkMode;
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  allowedEndpoints: readonly string[];
  timeoutMs: number;
  requestSha256: string;
}>;
export type IsolationResult = Readonly<{
  schemaVersion: 1;
  requestSha256: string;
  isolation: "enforced";
  exitCode: number;
  signal: string | null;
  timedOut: boolean;
  output: Buffer;
  attempts: readonly NetworkAttempt[];
}>;
export type IsolationAdapter = Readonly<{
  capability: "os-network-isolation-v1";
  name: string;
  run(request: IsolationRequest): Promise<IsolationResult>;
}>;
export type NetworkEvidence = Readonly<{
  schemaVersion: 1;
  mode: NetworkMode;
  commandId: string;
  requestSha256: string;
  isolation: string;
  allowedEndpoints: readonly string[];
  observedAttempts: readonly string[];
  output: Buffer;
  outputSha256: string;
  status: "PASS";
}>;
export function runInNetworkMode(
  options: Readonly<{
    mode: NetworkMode;
    commandId: string;
    command: string;
    args?: readonly string[];
    cwd: string;
    adapter: IsolationAdapter;
    registryOrigin?: string;
    mockOrigin?: string;
    timeoutMs?: number;
    beforeSnapshot?: () => Promise<string>;
    afterSnapshot?: () => Promise<string>;
    environment?: Readonly<Record<string, string>>;
  }>,
): Promise<NetworkEvidence>;
export type OfflineBuildResult = Readonly<{
  schemaVersion: 1;
  command: string;
  distPath: string;
  network: NetworkEvidence;
  networkResultSha256: string;
}>;
export function runOfflineProductionBuild(
  options: Readonly<{
    workspaceRoot: string;
    distPath?: string;
    adapter: IsolationAdapter;
    timeoutMs?: number;
  }>,
): Promise<OfflineBuildResult>;
export function createLinuxIsolationAdapter(): IsolationAdapter;
export function createPreloadIsolationAdapter(
  options: Readonly<{
    wrapperCommand: string;
    preloadPath: string;
    name?: string;
    execute(
      command: string,
      args: readonly string[],
      request: IsolationRequest,
    ): Promise<IsolationResult>;
  }>,
): IsolationAdapter;
