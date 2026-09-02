import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { computeProject1Candidate } from "../../scripts/project1-release-evidence.mjs";
import type { FrozenCandidate } from "../../scripts/project1-candidate.mjs";

const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const byteSort = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
type FileRecord = Readonly<{ path: string; size: number; mode: number; sha256: string }>;
async function snapshot(root: string): Promise<readonly FileRecord[]> {
  const files: FileRecord[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => byteSort(a.name, b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile()))
        throw new Error("CANDIDATE_ENTRY_NONREGULAR");
      if (metadata.isDirectory()) await walk(absolute);
      else
        files.push({
          path: path.relative(root, absolute).split(path.sep).join("/"),
          size: metadata.size,
          mode: metadata.mode & 0o777,
          sha256: sha256(await readFile(absolute)),
        });
    }
  }
  await walk(root);
  return Object.freeze(files);
}
async function freeze(root: string): Promise<void> {
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else await chmod(absolute, 0o444);
    }
    await chmod(directory, 0o555);
  }
  await walk(root);
}

/** Test-only operation injection. Production modules never import this harness. */
export async function buildFixtureCandidate({
  workspaceRoot,
  runBuild,
}: Readonly<{
  workspaceRoot: string;
  runBuild(context: Readonly<{ cwd: string; outDir: string; markBuild(): void }>): Promise<void>;
}>): Promise<FrozenCandidate> {
  const dist = path.join(workspaceRoot, "dist");
  const staging = `${dist}.fixture`;
  await rm(dist, { recursive: true, force: true });
  await rm(staging, { recursive: true, force: true });
  await mkdir(path.dirname(dist), { recursive: true });
  let count = 0;
  await runBuild({ cwd: workspaceRoot, outDir: staging, markBuild: () => count++ });
  if (count !== 1) throw new Error("CANDIDATE_BUILD_COUNT_INVALID");
  await computeProject1Candidate(staging);
  await rename(staging, dist);
  const identity = await computeProject1Candidate(dist);
  const before = await snapshot(dist);
  await freeze(dist);
  const files = await snapshot(dist);
  return Object.freeze({
    root: dist,
    identity,
    files,
    beforeFreezeSha256: sha256(JSON.stringify(before)),
    snapshotSha256: sha256(JSON.stringify(files)),
    buildOutput: Buffer.from("fixture build"),
    buildOutputSha256: sha256("fixture build"),
    buildCommand: "fixture build",
    networkRequestSha256: sha256("fixture request"),
    networkResultSha256: sha256("fixture result"),
  });
}
