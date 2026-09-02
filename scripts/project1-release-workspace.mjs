import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir, platform, arch } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const byteSort = (a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
const safeName = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  !path.isAbsolute(value) &&
  !value.includes("\\") &&
  path.posix.normalize(value) === value &&
  !value.split("/").includes("..") &&
  value.normalize("NFC") === value;
const exactKeys = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  Object.keys(value).every((key) => keys.includes(key));

export function parseReleaseInputManifest(text) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    throw new Error("RELEASE_INPUT_MANIFEST_INVALID");
  }
  if (
    JSON.stringify(manifest) !== text ||
    !exactKeys(manifest, ["schemaVersion", "allowedTopLevel", "includes", "excludes"]) ||
    manifest.schemaVersion !== 2 ||
    !Array.isArray(manifest.allowedTopLevel) ||
    !Array.isArray(manifest.includes) ||
    !Array.isArray(manifest.excludes)
  )
    throw new Error("RELEASE_INPUT_MANIFEST_INVALID");
  for (const list of [manifest.allowedTopLevel, manifest.includes, manifest.excludes]) {
    if (
      list.length === 0 ||
      [...list].sort(byteSort).some((entry, index) => entry !== list[index]) ||
      new Set(list).size !== list.length ||
      list.some((entry) => !safeName(entry))
    )
      throw new Error("RELEASE_INPUT_MANIFEST_PATH_INVALID");
  }
  if (
    manifest.includes.some((entry) =>
      manifest.excludes.some((excluded) => entry === excluded || entry.startsWith(`${excluded}/`)),
    )
  )
    throw new Error("RELEASE_INPUT_MANIFEST_OVERLAP");
  for (const required of ["package.json", "pnpm-lock.yaml"])
    if (!manifest.includes.includes(required)) throw new Error("RELEASE_INPUT_REQUIRED_OMITTED");
  const covered = new Set([...manifest.includes, ...manifest.excludes]);
  if (
    manifest.allowedTopLevel.some((entry) => entry.includes("/")) ||
    manifest.allowedTopLevel.some((entry) => !covered.has(entry))
  )
    throw new Error("RELEASE_INPUT_MANIFEST_COVERAGE_INVALID");
  return Object.freeze({
    schemaVersion: 2,
    allowedTopLevel: Object.freeze([...manifest.allowedTopLevel]),
    includes: Object.freeze([...manifest.includes]),
    excludes: Object.freeze([...manifest.excludes]),
  });
}

async function filesBelow(sourceRoot, relative, excluded, output) {
  if (
    excluded.some(
      (entry) =>
        relative === entry ||
        relative.startsWith(`${entry}/`) ||
        (entry === "node_modules" && relative.split("/").includes("node_modules")),
    )
  )
    return;
  const absolute = path.join(sourceRoot, ...relative.split("/"));
  const metadata = await lstat(absolute);
  if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile()))
    throw new Error("RELEASE_INPUT_NONREGULAR");
  if (metadata.isFile()) {
    output.push(relative);
    return;
  }
  const entries = await readdir(absolute);
  entries.sort(byteSort);
  const folded = new Set();
  for (const name of entries) {
    if (!safeName(name) || folded.has(name.toLocaleLowerCase("en-US")))
      throw new Error("RELEASE_INPUT_PATH_COLLISION");
    folded.add(name.toLocaleLowerCase("en-US"));
    await filesBelow(sourceRoot, `${relative}/${name}`, excluded, output);
  }
}

async function snapshotDetails(root, files) {
  const digest = createHash("sha256").update("ShardPass release inputs v2\0");
  const fileHashes = [];
  for (const relative of files) {
    const absolute = path.join(root, ...relative.split("/"));
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error("RELEASE_INPUT_MUTATED");
    const bytes = await readFile(absolute);
    const name = Buffer.from(relative, "utf8");
    const lengths = Buffer.alloc(16);
    lengths.writeBigUInt64BE(BigInt(name.length), 0);
    lengths.writeBigUInt64BE(BigInt(bytes.length), 8);
    const fileSha256 = sha256(bytes);
    fileHashes.push(Object.freeze({ path: relative, size: bytes.length, sha256: fileSha256 }));
    digest.update(lengths).update(name).update(bytes);
  }
  return Object.freeze({ digest: digest.digest("hex"), fileHashes: Object.freeze(fileHashes) });
}
const snapshot = async (root, files) => (await snapshotDetails(root, files)).digest;

export async function createDisposableWorkspace({
  sourceRoot,
  manifestPath,
  temporaryRoot = tmpdir(),
  sharedStoreDirectory,
}) {
  if (process.env.NODE_PATH) throw new Error("AMBIENT_NODE_PATH_FORBIDDEN");
  const source = sourceRoot instanceof URL ? fileURLToPath(sourceRoot) : path.resolve(sourceRoot);
  const manifestText = await readFile(manifestPath, "utf8");
  const manifest = parseReleaseInputManifest(manifestText);
  const rootEntries = (await readdir(source)).sort(byteSort);
  if (rootEntries.some((entry) => !manifest.allowedTopLevel.includes(entry)))
    throw new Error("RELEASE_INPUT_UNEXPECTED_TOP_LEVEL");
  const files = [];
  for (const include of manifest.includes)
    await filesBelow(source, include, manifest.excludes, files);
  files.sort(byteSort);
  const before = await snapshot(source, files);
  const parent = await mkdtemp(path.join(path.resolve(temporaryRoot), "shardpass-release-"));
  await stat(parent)
    .then((entry) => entry.mode & 0o777)
    .then(async (mode) => {
      if (mode !== 0o700)
        await import("node:fs/promises").then(({ chmod }) => chmod(parent, 0o700));
    });
  const root = path.join(parent, "workspace");
  const storeDirectory = sharedStoreDirectory
    ? path.resolve(sharedStoreDirectory)
    : path.join(parent, "pnpm-store");
  if (sharedStoreDirectory) {
    const store = await stat(storeDirectory);
    if (!store.isDirectory()) throw new Error("RELEASE_STORE_INVALID");
  }
  await mkdir(root, { mode: 0o700 });
  if (!sharedStoreDirectory) await mkdir(storeDirectory, { mode: 0o700 });
  try {
    for (const relative of files) {
      const target = path.join(root, ...relative.split("/"));
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await copyFile(path.join(source, ...relative.split("/")), target, constants.COPYFILE_EXCL);
    }
    const [after, copied, details] = await Promise.all([
      snapshot(source, files),
      snapshot(root, files),
      snapshotDetails(root, files),
    ]);
    if (before !== after || before !== copied) throw new Error("RELEASE_INPUT_MUTATED");
    return Object.freeze({
      root,
      storeDirectory,
      storeIdentity: sha256(`ShardPass isolated pnpm store v1\0${path.resolve(storeDirectory)}`),
      sourceSnapshotSha256: before,
      releaseInputsSha256: sha256(manifestText),
      files: Object.freeze(files),
      fileHashes: details.fileHashes,
      parent,
    });
  } catch (error) {
    await rm(parent, { recursive: true, force: true });
    throw error;
  }
}

export async function createIndependentRebuildWorkspace({
  firstWorkspace,
  sourceRoot,
  manifestPath,
  temporaryRoot = tmpdir(),
}) {
  const second = await createDisposableWorkspace({
    sourceRoot,
    manifestPath,
    temporaryRoot,
    sharedStoreDirectory: firstWorkspace.storeDirectory,
  });
  if (
    second.root === firstWorkspace.root ||
    second.parent === firstWorkspace.parent ||
    second.sourceSnapshotSha256 !== firstWorkspace.sourceSnapshotSha256 ||
    second.releaseInputsSha256 !== firstWorkspace.releaseInputsSha256 ||
    second.storeDirectory !== firstWorkspace.storeDirectory
  ) {
    await cleanupDisposableWorkspace(second);
    throw new Error("RELEASE_REBUILD_SOURCE_MISMATCH");
  }
  return second;
}

const SAFE_ENV = ["HOME", "PATH", "SYSTEMROOT", "TMPDIR", "TEMP", "TMP"];
function cleanEnvironment(extra = {}) {
  const env = {};
  for (const key of SAFE_ENV) if (process.env[key]) env[key] = process.env[key];
  return {
    ...env,
    CI: "1",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
    ...extra,
  };
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [];
    let timer;
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && !signal) resolve(Buffer.concat(chunks));
      else reject(new Error(signal ? "BOOTSTRAP_SIGNAL" : "BOOTSTRAP_FAILED"));
    });
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("BOOTSTRAP_TIMEOUT"));
    }, options.timeoutMs);
  });
}

export async function runFrozenBootstrap(
  workspace,
  { registryOrigin, timeoutMs = 600000, runCommand = run } = {},
) {
  const registry = new URL(registryOrigin);
  if (
    registry.protocol !== "https:" ||
    registry.pathname !== "/" ||
    registry.search ||
    registry.hash ||
    registry.username ||
    registry.password
  )
    throw new Error("BOOTSTRAP_REGISTRY_INVALID");
  const before = await snapshot(workspace.root, workspace.files);
  const packageJson = JSON.parse(await readFile(path.join(workspace.root, "package.json"), "utf8"));
  const env = cleanEnvironment({
    npm_config_registry: registry.href,
    PNPM_HOME: path.join(workspace.parent, "pnpm-home"),
  });
  const nodeVersion = String(
    (
      await runCommand(process.execPath, ["--version"], { cwd: workspace.root, env, timeoutMs })
    ).toString(),
  ).trim();
  const pnpmVersion = String(
    (
      await runCommand(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["--version"], {
        cwd: workspace.root,
        env,
        timeoutMs,
      })
    ).toString(),
  ).trim();
  if (
    !/^v22\.(?:1[4-9]|[2-9][0-9])\./u.test(nodeVersion) ||
    pnpmVersion !== "10.14.0" ||
    packageJson.packageManager !== "pnpm@10.14.0" ||
    packageJson.engines?.node !== ">=22.14.0 <23" ||
    packageJson.engines?.pnpm !== "10.14.0"
  )
    throw new Error("BOOTSTRAP_TOOLCHAIN_INVALID");
  const output = await runCommand(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["install", "--frozen-lockfile", `--store-dir=${workspace.storeDirectory}`],
    { cwd: workspace.root, env, timeoutMs },
  );
  if ((await snapshot(workspace.root, workspace.files)) !== before)
    throw new Error("BOOTSTRAP_SOURCE_MUTATED");
  return Object.freeze({
    schemaVersion: 1,
    command: "pnpm install --frozen-lockfile",
    nodeVersion,
    pnpmVersion,
    packageManager: packageJson.packageManager,
    engines: packageJson.engines,
    platform: platform(),
    arch: arch(),
    registryOrigin: registry.origin,
    storeIdentity: sha256(workspace.storeDirectory),
    sourceSnapshotSha256: before,
    outputSha256: sha256(output),
    status: "PASS",
  });
}

export async function assertWorkspaceUnchanged(workspace) {
  if ((await snapshot(workspace.root, workspace.files)) !== workspace.sourceSnapshotSha256)
    throw new Error("RELEASE_WORKSPACE_MUTATED");
}
export async function cleanupDisposableWorkspace(workspace) {
  const parent = path.resolve(workspace.parent);
  if (
    !path.basename(parent).startsWith("shardpass-release-") ||
    !path.resolve(workspace.root).startsWith(`${parent}${path.sep}`)
  )
    throw new Error("RELEASE_CLEANUP_PATH_INVALID");
  await rm(parent, { recursive: true });
  await access(parent).then(
    () => {
      throw new Error("RELEASE_CLEANUP_FAILED");
    },
    () => undefined,
  );
}
