import type { Task12CandidateIdentity } from "./task12-release-evidence.mjs";
import type { FrozenCandidate } from "./project1-candidate.mjs";
export type ArchiveIdentity = Readonly<{
  path: string;
  sha256: string;
  size: number;
  candidate: Task12CandidateIdentity;
  entryCount: number;
  compression: "DEFLATE-9";
  timestamp: "1980-01-01T00:00:00.000Z";
}>;
export function createDeterministicArchive(
  candidate: FrozenCandidate,
  output: string,
  /** `flat` writes the files at the archive root, as a store upload requires. */
  options?: Readonly<{ flat?: boolean }>,
): Promise<ArchiveIdentity>;
export function verifyArchiveRoundTrip(
  candidate: FrozenCandidate,
  archive: ArchiveIdentity | string,
  limits?: Readonly<{ maxEntries: number; maxBytes: number }>,
  options?: Readonly<{ flat?: boolean }>,
): Promise<void>;
