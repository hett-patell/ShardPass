import { createHash } from "node:crypto";
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { scanSecretRoot, verifySecretScanReport } from "./scan-secrets.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const MANIFEST_KEYS = ["schemaVersion", "roots", "excludedTestOnlyFiles"];
const ROOT_NAMES = [
  "apps-production",
  "packages-production",
  "scripts-production",
  "tools-production",
  "root-config",
  "current-docs",
];
const PERMITTED_TEST_ONLY = Object.freeze([
  "packages/importers/src/google-migration-direct.test-helper.ts",
  "scripts/capture-legacy-fixtures.mjs",
  "scripts/create-task12-chrome110-evidence.mjs",
  "scripts/create-task12-final-review-evidence.mjs",
  "scripts/generate-ente-sodium-vectors.mjs",
  "scripts/generate-ente-srp-transcripts.mjs",
  "scripts/replay-ente-srp-reference.mjs",
  "scripts/verify-task12-release.mjs",
]);
const rootConfigEligible = (name) =>
  new Set([
    ".npmrc",
    "manifest.json",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "service-worker-loader.js",
  ]).has(name) ||
  /^(?:dependency-cruiser|eslint|playwright|prettier|vite|vitest)(?:\.[a-z0-9-]+)*\.config\.(?:cjs|js|mjs|ts)$/u.test(
    name,
  ) ||
  /^tsconfig(?:\.[a-z0-9-]+)*\.json$/u.test(name);
const safeRelative = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  !value.includes("\\") &&
  !path.posix.isAbsolute(value) &&
  path.posix.normalize(value) === value &&
  !value.split("/").includes("..") &&
  value.normalize("NFC") === value;
const byteSort = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const testNamed = (file) => /(?:^|\/)(?:test|tests)(?:\/|$)|\.(?:test|spec)\./u.test(file);

async function regularFiles(root, relative) {
  const output = [];
  async function walk(current) {
    const absolute = path.join(root, ...current.split("/"));
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile()))
      throw new Error("PRODUCTION_SOURCE_FILE_INVALID");
    if (metadata.isFile()) {
      output.push(current);
      return;
    }
    const entries = await readdir(absolute);
    entries.sort(byteSort);
    for (const name of entries) {
      if (name === "node_modules") continue;
      const child = `${current}/${name}`;
      if (!safeRelative(child)) throw new Error("PRODUCTION_SOURCE_PATH_INVALID");
      await walk(child);
    }
  }
  await walk(relative);
  return output;
}

/** Enumerate the complete production-source universe under each explicitly defined root. */
export async function enumerateEligibleProductionSources(projectRoot) {
  const root = path.resolve(projectRoot);
  const excluded = new Set(PERMITTED_TEST_ONLY);
  const allApps = await regularFiles(root, "apps");
  const allPackages = await regularFiles(root, "packages");
  const allScripts = await regularFiles(root, "scripts");
  const allTools = await regularFiles(root, "tools");
  const rootEntries = (await readdir(root)).filter(rootConfigEligible);
  const allArchitectureDocs = await regularFiles(root, "docs/architecture");
  const allSecurityDocs = await regularFiles(root, "docs/security");
  const groups = [
    {
      name: "apps-production",
      files: allApps.filter(
        (file) =>
          !testNamed(file) &&
          (/^apps\/[^/]+\/package\.json$/u.test(file) ||
            /^apps\/[^/]+\/src\//u.test(file) ||
            /^apps\/[^/]+\/(?:popup|vault)\/index\.html$/u.test(file)),
      ),
    },
    {
      name: "packages-production",
      files: allPackages.filter(
        (file) =>
          !excluded.has(file) &&
          !testNamed(file) &&
          (/^packages\/[^/]+\/package\.json$/u.test(file) || /^packages\/[^/]+\/src\//u.test(file)),
      ),
    },
    {
      name: "scripts-production",
      files: allScripts.filter(
        (file) => !excluded.has(file) && /^scripts\/[^/]+\.(?:mjs|d\.mts)$/u.test(file),
      ),
    },
    {
      name: "tools-production",
      files: allTools.filter((file) => !excluded.has(file)),
    },
    {
      name: "root-config",
      files: rootEntries,
    },
    {
      name: "current-docs",
      files: [...allArchitectureDocs, ...allSecurityDocs],
    },
  ];
  for (const group of groups) group.files.sort(byteSort);
  return Object.freeze(
    groups.map((group) => Object.freeze({ name: group.name, files: Object.freeze(group.files) })),
  );
}

export function parseProductionSourceManifest(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("PRODUCTION_SOURCE_MANIFEST_INVALID");
  }
  if (
    JSON.stringify(value) !== text ||
    Object.keys(value).join(",") !== MANIFEST_KEYS.join(",") ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.roots) ||
    value.roots.length !== ROOT_NAMES.length ||
    !Array.isArray(value.excludedTestOnlyFiles)
  )
    throw new Error("PRODUCTION_SOURCE_MANIFEST_INVALID");
  const files = [];
  for (const [index, root] of value.roots.entries()) {
    if (
      Object.keys(root).join(",") !== "name,files" ||
      root.name !== ROOT_NAMES[index] ||
      !Array.isArray(root.files) ||
      root.files.length === 0 ||
      root.files.some((file) => !safeRelative(file)) ||
      root.files.some(
        (file, fileIndex) => fileIndex > 0 && byteSort(root.files[fileIndex - 1], file) >= 0,
      )
    )
      throw new Error("PRODUCTION_SOURCE_MANIFEST_INVALID");
    files.push(...root.files);
  }
  if (
    new Set(files).size !== files.length ||
    JSON.stringify(value.excludedTestOnlyFiles) !== JSON.stringify(PERMITTED_TEST_ONLY) ||
    value.excludedTestOnlyFiles.some((file) => files.includes(file))
  )
    throw new Error("PRODUCTION_SOURCE_MANIFEST_INVALID");
  return Object.freeze({
    roots: value.roots,
    files: Object.freeze(files),
    excludedTestOnlyFiles: Object.freeze([...value.excludedTestOnlyFiles]),
  });
}

function assertManifestClosure(manifest, eligibleRoots) {
  for (let index = 0; index < eligibleRoots.length; index++) {
    const declared = manifest.roots[index];
    const eligible = eligibleRoots[index];
    if (
      declared.name !== eligible.name ||
      declared.files.length !== eligible.files.length ||
      declared.files.some((file, fileIndex) => file !== eligible.files[fileIndex])
    )
      throw new Error("PRODUCTION_SOURCE_MANIFEST_CLOSURE_INVALID");
  }
}

export async function scanProductionSources({
  projectRoot,
  manifestPath,
  manifestText,
  allowlistPath,
}) {
  const root = path.resolve(projectRoot);
  const text = manifestText ?? (await readFile(manifestPath, "utf8"));
  const manifest = parseProductionSourceManifest(text);
  assertManifestClosure(manifest, await enumerateEligibleProductionSources(root));
  const allowlistBytes = await readFile(allowlistPath);
  if (
    allowlistBytes.toString("utf8") !==
    '{"schemaVersion":1,"scannerSchemaVersion":1,"allowances":[]}'
  )
    throw new Error("PRODUCTION_SOURCE_ALLOWLIST_NOT_EMPTY");
  const staging = await mkdtemp(path.join(tmpdir(), "shardpass-production-source-scan-"));
  try {
    const reports = [];
    for (const group of manifest.roots) {
      const groupRoot = path.join(staging, group.name);
      await mkdir(groupRoot);
      for (const file of group.files) {
        const source = path.resolve(root, ...file.split("/"));
        if (!source.startsWith(`${root}${path.sep}`))
          throw new Error("PRODUCTION_SOURCE_PATH_ESCAPE");
        const metadata = await lstat(source);
        if (metadata.isSymbolicLink() || !metadata.isFile())
          throw new Error("PRODUCTION_SOURCE_FILE_INVALID");
        const target = path.join(groupRoot, ...file.split("/"));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, await readFile(source), { flag: "wx", mode: 0o600 });
      }
      const report = await scanSecretRoot({
        root: groupRoot,
        rootName: group.name,
        mode: "source",
        allowlistPath,
        maxTextBytes: 8 * 1024 * 1024,
        maxBinaryBytes: 32 * 1024 * 1024,
      });
      verifySecretScanReport(report);
      reports.push(report);
    }
    return Object.freeze({
      schemaVersion: 1,
      manifestSha256: hash(text),
      allowlistSha256: hash(allowlistBytes),
      excludedTestOnlyFiles: manifest.excludedTestOnlyFiles,
      eligibleFileCount: manifest.files.length,
      reports: Object.freeze(reports),
      status: reports.every((report) => report.status === "PASS") ? "PASS" : "FAIL",
    });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function main() {
  const manifestPath = path.join(ROOT, "config/project1-production-source-manifest.json");
  if (process.argv.includes("--write")) {
    const current = parseProductionSourceManifest(await readFile(manifestPath, "utf8"));
    const roots = await enumerateEligibleProductionSources(ROOT);
    const next = JSON.stringify({
      schemaVersion: 1,
      roots,
      excludedTestOnlyFiles: current.excludedTestOnlyFiles,
    });
    await writeFile(manifestPath, next);
    process.stdout.write(`${hash(next)}\n`);
    return;
  }
  const report = await scanProductionSources({
    projectRoot: ROOT,
    manifestPath,
    allowlistPath: path.join(ROOT, "config/project1-secret-allowlist-empty.json"),
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.status !== "PASS") process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "PRODUCTION_SOURCE_SCAN_INTERNAL"}\n`,
    );
    process.exitCode = 1;
  });
