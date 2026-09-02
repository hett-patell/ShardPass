import type {
  Project1FinalDisposition,
  Project1EvidenceNode,
} from "./project1-release-evidence.mjs";
import type { IsolationAdapter } from "./project1-network-runner.mjs";
import type { FrozenCandidate } from "./project1-candidate.mjs";
export type Project1ReleaseGateOptions = Readonly<{
  mode: "release" | "development";
  nodeVersion: string;
  pnpmVersion: string;
  chromeVersion: string;
  sourceRoot?: string;
  inputManifestPath?: string;
  testManifestPath?: string;
  temporaryRoot?: string;
  outputRoot: string;
  registryOrigin: string;
  mockOrigin: string;
  networkAdapter: IsolationAdapter;
  chromeEvidencePath: string;
  finalEvidencePath: string;
  trustStorePath: string;
  clock?: () => Date;
  operationHook?: (operation: string) => void | Promise<void>;
  bootstrapCommand?: (
    command: string,
    args: readonly string[],
    options: unknown,
  ) => Promise<Buffer>;
  runBuild(context: Readonly<{ cwd: string; outDir: string; markBuild(): void }>): Promise<void>;
  scanCandidate?(candidate: FrozenCandidate): Promise<void>;
  runDeterministicBuild(candidate: FrozenCandidate): Promise<void>;
}>;
export function runProject1ReleaseGate(options: Project1ReleaseGateOptions): Promise<
  | Project1FinalDisposition
  | Readonly<{
      candidate: FrozenCandidate["identity"];
      archiveSha256: string;
      status: "DEVELOPMENT-ONLY";
      nodes: readonly Project1EvidenceNode[];
    }>
>;
