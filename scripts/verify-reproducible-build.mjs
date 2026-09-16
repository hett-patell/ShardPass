import { createHash } from "node:crypto";
import { access, lstat, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function filesRecursively(directory, root = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
      const relative = path.relative(root, candidate).split(path.sep).join("/");
      throw new Error(`Nonregular build entry: ${relative}`);
    }
    if (metadata.isDirectory()) files.push(...(await filesRecursively(candidate, root)));
    else files.push(candidate);
  }
  return files;
}

export async function snapshotBuildDirectory(directory) {
  const root = path.resolve(directory);
  const rootMetadata = await lstat(root);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error(`Build root must be a real non-symlink directory: ${root}`);
  }
  const files = await filesRecursively(root);
  const snapshot = await Promise.all(
    files.map(async (file) => ({
      path: path.relative(root, file).split(path.sep).join("/"),
      sha256: createHash("sha256")
        .update(await readFile(file))
        .digest("hex"),
    })),
  );
  return snapshot.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export async function compareBuildDirectories(first, second) {
  const [left, right] = await Promise.all([
    snapshotBuildDirectory(first),
    snapshotBuildDirectory(second),
  ]);
  const leftByPath = new Map(left.map((entry) => [entry.path, entry.sha256]));
  const rightByPath = new Map(right.map((entry) => [entry.path, entry.sha256]));
  const differences = [];
  for (const name of [...new Set([...leftByPath.keys(), ...rightByPath.keys()])].sort()) {
    const leftHash = leftByPath.get(name);
    const rightHash = rightByPath.get(name);
    if (leftHash === undefined) differences.push(`${name}: missing from first build`);
    else if (rightHash === undefined) differences.push(`${name}: missing from second build`);
    else if (leftHash !== rightHash)
      differences.push(`${name}: SHA-256 differs (${leftHash} != ${rightHash})`);
  }
  return differences;
}

function runBuild(outDir) {
  return new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const child = spawn(command, ["exec", "vite", "build"], {
      cwd: projectRoot,
      env: { ...process.env, SHARDPASS_OUT_DIR: outDir },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`Build failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.`),
        );
    });
  });
}

/** Files a later build step writes into dist on purpose, which a scratch build does not have. */
const GENERATED_AFTER_BUILD = new Set([".ente-srp-production-graph.json"]);

/**
 * Compares the working `dist` with a clean build of the same tree. A missing `dist` is not a
 * failure here (nothing has been built yet); a `dist` that differs is.
 */
async function compareAgainstDist(reference) {
  const dist = path.resolve(projectRoot, "dist");
  try {
    await access(path.join(dist, "manifest.json"));
  } catch {
    return [];
  }
  const differences = await compareBuildDirectories(reference, dist);
  return differences.filter(
    (difference) => ![...GENERATED_AFTER_BUILD].some((name) => difference.includes(name)),
  );
}

async function main() {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "shardpass-reproducible-"));
  const first = path.join(temporaryRoot, "first");
  const second = path.join(temporaryRoot, "second");
  try {
    await runBuild(first);
    await runBuild(second);
    const differences = await compareBuildDirectories(first, second);
    if (differences.length > 0) {
      for (const difference of differences) console.error(difference);
      process.exitCode = 1;
      return;
    }
    const snapshot = await snapshotBuildDirectory(first);
    // Two scratch builds agreeing only proves the build is deterministic. The artifact that
    // was scanned, hashed and loaded in a browser is `dist`, so it is compared as well:
    // anything placed there by hand, or left behind by an older build, shows up here.
    const distDifferences = await compareAgainstDist(first);
    if (distDifferences.length > 0) {
      for (const difference of distDifferences) console.error(difference);
      process.exitCode = 1;
      return;
    }
    console.log(
      `Reproducible build verified: ${snapshot.length} files with identical SHA-256 bytes, and dist matches.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await main();
