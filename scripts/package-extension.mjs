import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createDeterministicArchive, verifyArchiveRoundTrip } from "./project1-archive.mjs";
import { snapshotCandidate } from "./project1-candidate.mjs";

/**
 * Packages the build in `dist/` as the zip a store upload takes: `manifest.json` at the root,
 * every byte fixed, so the same build always produces the same file. The evidence archive the
 * release gate writes keeps a `ShardPass-<version>/` directory and cannot be uploaded.
 *
 * Run `pnpm package`, which builds through the security gate first. This script never builds:
 * it packages whatever passed.
 */
const projectRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

async function main() {
  const dist = path.join(projectRoot, "dist");
  const candidate = await snapshotCandidate(dist);
  const { version } = candidate.identity;
  const output = path.join(projectRoot, "release", `shardpass-${version}.zip`);
  const archive = await createDeterministicArchive(candidate, output, { flat: true });
  // Unpacks the file just written and rebuilds the candidate identity from it: proof that what
  // is about to be uploaded is the build that was verified, not a neighbouring directory.
  await verifyArchiveRoundTrip(candidate, archive, undefined, { flat: true });
  const manifest = JSON.parse(await readFile(path.join(dist, "manifest.json"), "utf8"));
  process.stdout.write(
    [
      `Packaged ShardPass ${version} (${manifest.name})`,
      `  ${path.relative(projectRoot, archive.path)}`,
      `  ${archive.entryCount} entries, ${(archive.size / 1024).toFixed(1)} KiB`,
      `  sha256 ${archive.sha256}`,
      "",
      "Upload this file to the Chrome Web Store dashboard.",
      "",
    ].join("\n"),
  );
}

main().catch((error) => {
  const code = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Packaging failed: ${code}\n`);
  process.exitCode = 1;
});
