import type {
  Task12CandidateIdentity,
  Task12StructuredEvidence,
} from "./task12-release-evidence.mjs";

export type EvidenceKind =
  | "bootstrap"
  | "offline-static"
  | "source-scan"
  | "build"
  | "candidate-scan"
  | "project1-tests"
  | "mock-browser"
  | "deterministic-build"
  | "archive"
  | "audit"
  | "docs"
  | "task12-chrome110"
  | "task12-review"
  | "final";
export type NetworkMode = "bootstrap" | "offline" | "mock" | "audit";
export type EvidenceArtifact = Readonly<{ kind: string; path: string; sha256: string }>;
export type EvidencePrerequisite = Readonly<{
  hash: string;
  id: string;
  kind: Exclude<EvidenceKind, "final">;
}>;
export type Project1EvidenceNode = Readonly<{
  schemaVersion: 1;
  task: "project1-task13";
  id: string;
  kind: EvidenceKind;
  command: string;
  mode: NetworkMode;
  status: "PASS" | "PASS-PROJECT1-RELEASE";
  startedAt: string;
  finishedAt: string;
  developmentOnly: boolean;
  candidate: Task12CandidateIdentity;
  artifacts: readonly EvidenceArtifact[];
  prerequisites: readonly EvidencePrerequisite[];
  archiveSha256?: string;
  nodeVersion?: string;
  pnpmVersion?: string;
  chromeVersion?: string;
}>;
export type Project1FinalDisposition = Readonly<{
  candidate: Task12CandidateIdentity;
  archiveSha256: string;
  finalNode: Project1EvidenceNode;
  finalNodeSha256: string;
  status: string;
}>;
export const PROJECT1_EVIDENCE_SCHEMA_VERSION: 1;
export const PROJECT1_EVIDENCE_KINDS: readonly EvidenceKind[];
export function computeProject1Candidate(dist: string | URL): Promise<Task12CandidateIdentity>;
export function parseCanonicalEvidenceJson(text: string): unknown;
export function hashEvidenceNode(node: Project1EvidenceNode): string;
export function importTask12Evidence(
  options: Readonly<{
    candidate: Task12CandidateIdentity;
    chromeEvidencePath: string | URL;
    finalEvidencePath: string | URL;
    trustStorePath: string | URL;
    now?: Date;
    afterChromeValidation?: () => void | Promise<void>;
    beforeReviewVerification?: () => void | Promise<void>;
  }>,
): Promise<
  Readonly<{
    chrome: Readonly<{ bytes: Buffer; sha256: string; record: Task12StructuredEvidence }>;
    review: Readonly<{
      dispositionBytes: Buffer;
      dispositionSha256: string;
      reportBytes: Buffer;
      reportSha256: string;
      signatureBytes: Buffer;
      signatureSha256: string;
      record: Task12StructuredEvidence;
    }>;
  }>
>;
export function verifyProject1EvidenceGraph(
  options: Readonly<{
    nodes: readonly Project1EvidenceNode[];
    artifactRoot: string | URL;
    expectedCandidate: Task12CandidateIdentity;
    now?: Date;
    release?: boolean;
  }>,
): Promise<Project1FinalDisposition>;
