import { createHash } from "node:crypto";
import { chmod, lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { computeProject1Candidate } from "./project1-release-evidence.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const byteSort = (a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));

async function treeSnapshot(root) {
  const files = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => byteSort(a.name, b.name));
    for (const entry of entries) {
      if (entry.name.normalize("NFC") !== entry.name || entry.name.includes("\\"))
        throw new Error("CANDIDATE_PATH_INVALID");
      const absolute = path.join(directory, entry.name);
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile()))
        throw new Error("CANDIDATE_ENTRY_NONREGULAR");
      if (metadata.isDirectory()) await walk(absolute);
      else
        files.push(
          Object.freeze({
            path: path.relative(root, absolute).split(path.sep).join("/"),
            size: metadata.size,
            mode: metadata.mode & 0o777,
            sha256: sha256(await readFile(absolute)),
          }),
        );
    }
  }
  await walk(root);
  return Object.freeze(files);
}

async function freezeTree(root) {
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => byteSort(a.name, b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else await chmod(absolute, 0o444);
    }
    await chmod(directory, 0o555);
  }
  await walk(root);
}

/** Freeze only a dist already produced by the private isolated production build path. */
export async function buildAndFreezeCandidate({ workspaceRoot, distPath, buildEvidence }) {
  const dist = path.resolve(distPath);
  const root = path.resolve(workspaceRoot);
  const hash = /^[a-f0-9]{64}$/u;
  if (
    !dist.startsWith(`${root}${path.sep}`) ||
    buildEvidence === null ||
    typeof buildEvidence !== "object" ||
    Object.keys(buildEvidence).join(",") !==
      "schemaVersion,command,requestSha256,networkResultSha256,output,outputSha256" ||
    buildEvidence.schemaVersion !== 1 ||
    typeof buildEvidence.command !== "string" ||
    !buildEvidence.command ||
    !hash.test(buildEvidence.requestSha256) ||
    !hash.test(buildEvidence.networkResultSha256) ||
    !Buffer.isBuffer(buildEvidence.output) ||
    buildEvidence.output.length === 0 ||
    !hash.test(buildEvidence.outputSha256) ||
    sha256(buildEvidence.output) !== buildEvidence.outputSha256
  )
    throw new Error("CANDIDATE_BUILD_EVIDENCE_INVALID");
  const identity = await computeProject1Candidate(dist);
  const beforeFreeze = await treeSnapshot(dist);
  const beforeFreezeSha256 = sha256(JSON.stringify(beforeFreeze));
  await freezeTree(dist);
  const files = await treeSnapshot(dist);
  const contentFiles = files.map((file) => ({
    path: file.path,
    size: file.size,
    sha256: file.sha256,
  }));
  const beforeContent = beforeFreeze.map((file) => ({
    path: file.path,
    size: file.size,
    sha256: file.sha256,
  }));
  if (sha256(JSON.stringify(contentFiles)) !== sha256(JSON.stringify(beforeContent)))
    throw new Error("CANDIDATE_FREEZE_MUTATED");
  return Object.freeze({
    root: dist,
    identity,
    files,
    beforeFreezeSha256,
    snapshotSha256: sha256(JSON.stringify(files)),
    buildOutput: buildEvidence.output,
    buildOutputSha256: buildEvidence.outputSha256,
    buildCommand: buildEvidence.command,
    networkRequestSha256: buildEvidence.requestSha256,
    networkResultSha256: buildEvidence.networkResultSha256,
  });
}

/**
 * The same shape the release gate freezes, taken from a build without freezing it or asking
 * for build evidence: enough for `createDeterministicArchive` and `assertCandidateUnchanged`,
 * which is what packaging a store upload needs. The release gate keeps its stricter path.
 */
export async function snapshotCandidate(distPath) {
  const root = path.resolve(distPath);
  const [identity, files] = await Promise.all([computeProject1Candidate(root), treeSnapshot(root)]);
  return Object.freeze({
    root,
    identity,
    files,
    snapshotSha256: sha256(JSON.stringify(files)),
  });
}

export async function assertCandidateUnchanged(candidate) {
  const [identity, files] = await Promise.all([
    computeProject1Candidate(candidate.root),
    treeSnapshot(candidate.root),
  ]);
  if (
    JSON.stringify(identity) !== JSON.stringify(candidate.identity) ||
    sha256(JSON.stringify(files)) !== candidate.snapshotSha256
  )
    throw new Error("CANDIDATE_MUTATED");
}
