import { spawnSync } from "node:child_process";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { computeTask12Candidate } from "./task12-release-evidence.mjs";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, ".sdd", "project1-task12-chrome110-evidence.json");
const argument = process.argv.indexOf("--chrome-executable");
const executable = argument >= 0 ? process.argv[argument + 1] : undefined;
const fail = (message) => {
  throw new Error(message);
};
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    env: options.env ?? process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed`);
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
};

async function writeExclusiveAtomic(filePath, bytes) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    const reservation = await open(filePath, "wx", 0o600);
    await reservation.close();
    await rename(temporary, filePath);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true });
    throw error;
  }
}

try {
  if (!executable || process.argv.length !== 4)
    fail("Provide exactly --chrome-executable /absolute/path/to/chrome");
  if (!path.isAbsolute(executable)) fail("Chrome executable path must be absolute");
  const versionOutput = run(executable, ["--version"], { capture: true });
  const match = versionOutput.match(/(?:Chrome|Chromium)\s+(\d+(?:\.\d+){0,3})/u);
  if (!match || Number(match[1].split(".")[0]) !== 110) {
    fail(`Actual browser must be Chrome major 110; received ${versionOutput || "no version"}`);
  }

  run("pnpm", ["build:security"]);
  const candidateBefore = await computeTask12Candidate(path.join(root, "dist"));
  const browserRoot = path.dirname(path.dirname(path.dirname(path.dirname(executable))));
  const expectedExecutable = path.join(browserRoot, "chromium-1234", "chrome-linux64", "chrome");
  if (path.resolve(executable) !== expectedExecutable)
    fail(
      "Chrome 110 must be explicitly supplied at the Playwright chromium-1234 executable location",
    );
  const browserEnvironment = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserRoot };
  run("pnpm", ["build:test:crypto"], { env: browserEnvironment });
  run("pnpm", ["build:test:ente-srp"], { env: browserEnvironment });
  run("pnpm", ["exec", "playwright", "test"], { env: browserEnvironment });
  run("pnpm", [
    "exec",
    "vitest",
    "run",
    "tests/security",
    "--maxWorkers=1",
    "--no-file-parallelism",
  ]);
  const candidateAfter = await computeTask12Candidate(path.join(root, "dist"));
  if (JSON.stringify(candidateAfter) !== JSON.stringify(candidateBefore))
    fail("Packaged candidate changed during Chrome 110 verification");

  const record = {
    schemaVersion: 2,
    task: "project1-task12",
    kind: "chrome110",
    status: "PASS",
    version: match[1],
    command: "pnpm verify:project1:task12:chrome110",
    result: "PASS-TASK12-CHROME110",
    candidate: candidateAfter,
    observedAt: new Date().toISOString(),
  };
  await writeExclusiveAtomic(output, `${JSON.stringify(record)}\n`);
  process.stdout.write(`Wrote ${output}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
