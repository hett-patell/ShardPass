import type { Task12CandidateIdentity } from "./task12-release-evidence.mjs";
export type FrozenCandidateFile = Readonly<{
  path: string;
  size: number;
  mode: number;
  sha256: string;
}>;
export type FrozenCandidate = Readonly<{
  root: string;
  identity: Task12CandidateIdentity;
  files: readonly FrozenCandidateFile[];
  beforeFreezeSha256: string;
  snapshotSha256: string;
  buildOutput: Buffer;
  buildOutputSha256: string;
  buildCommand: string;
  networkRequestSha256: string;
  networkResultSha256: string;
}>;
export type OfflineCandidateBuildEvidence = Readonly<{
  schemaVersion: 1;
  command: string;
  requestSha256: string;
  networkResultSha256: string;
  output: Buffer;
  outputSha256: string;
}>;
export function buildAndFreezeCandidate(
  options: Readonly<{
    workspaceRoot: string;
    distPath: string;
    buildEvidence: OfflineCandidateBuildEvidence;
  }>,
): Promise<FrozenCandidate>;
export function assertCandidateUnchanged(candidate: FrozenCandidate): Promise<void>;
export function snapshotCandidate(
  distPath: string,
): Promise<Pick<FrozenCandidate, "root" | "identity" | "files" | "snapshotSha256">>;
