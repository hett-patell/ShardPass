export type Task12EvidenceKind = "chrome110" | "final-disposition";

export type Task12CandidateIdentity = Readonly<{
  name: string;
  version: string;
  candidateDigest: string;
}>;

export type Task12StructuredEvidence = Readonly<{
  schemaVersion: 2;
  task: "project1-task12";
  kind: Task12EvidenceKind;
  status: string;
  version?: string;
  command: string;
  result: string;
  candidate: Task12CandidateIdentity;
  observedAt: string;
  reviewerId?: string;
  reviewerOrganization?: string;
  reviewerKeyFingerprint?: string;
  reviewReportPath?: string;
  reviewReportSha256?: string;
  signaturePath?: string;
  signatureSha256?: string;
  chromeEvidenceSha256?: string;
}>;

export const TASK12_FULL_REVIEW_SCOPE: readonly [
  "content-popup-authority",
  "Ente",
  "crypto-storage",
  "migration-import-backup",
  "clipboard-HOTP",
  "scanner-allowlist",
  "clean-install",
  "network-modes",
  "archive",
  "orchestration",
];

export type Task12ReviewerApproval = Readonly<{
  schemaVersion: 2;
  task: "project1-task12";
  status: "APPROVED";
  candidateDigest: string;
  scope: typeof TASK12_FULL_REVIEW_SCOPE;
  reviewer: Readonly<{ id: string; organization: string }>;
  chromeEvidenceSha256: string;
  toolResults: Readonly<{ chrome110: "PASS"; security: "PASS"; browser: "PASS" }>;
  reviewedAt: string;
}>;

export type Task12TrustedReviewer = Readonly<{
  reviewerId: string;
  organization: string;
  fingerprint: string;
  publicKey: Readonly<{ format: "pem-spki" | "raw-ed25519"; value: string }>;
  active: true;
  notBefore: string;
  notAfter: string;
}>;

export function computeTask12Candidate(
  distDirectory: string | URL,
): Promise<Task12CandidateIdentity>;
export function sha256(value: string | NodeJS.ArrayBufferView): string;
export function parseTask12StructuredEvidence(
  text: string,
  options: Readonly<{
    expectedKind: Task12EvidenceKind;
    expectedCandidate?: Task12CandidateIdentity;
    now?: Date;
  }>,
): Task12StructuredEvidence;
export function parseTask12ReviewerApproval(
  text: string,
  options: Readonly<{
    expectedCandidateDigest: string;
    expectedChromeEvidenceSha256: string;
    expectedSignatureSha256?: string;
    now?: Date;
  }>,
): Task12ReviewerApproval;
export function parseTask12ReviewerTrustStore(
  text: string,
  options?: Readonly<{ now?: Date }>,
): Readonly<{ keys: Task12TrustedReviewer[] }>;
export function verifyTask12ReviewerSignature(
  reportBytes: Buffer,
  signatureBytes: Buffer,
  trustStoreText: string,
  options: Readonly<{
    expectedCandidateDigest: string;
    expectedChromeEvidenceSha256: string;
    now?: Date;
  }>,
): Readonly<{
  approval: Task12ReviewerApproval;
  reviewerId: string;
  organization: string;
  fingerprint: string;
}>;
export function verifyTask12ReleaseEvidence(
  options: Readonly<{
    ledgerPath: string | URL;
    distPath: string | URL;
    chromeEvidencePath: string | URL;
    finalEvidencePath: string | URL;
    trustStorePath?: string | URL;
    now?: Date;
  }>,
): Promise<Readonly<{ failures: string[] }>>;
