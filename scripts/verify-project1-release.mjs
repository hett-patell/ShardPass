import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createDisposableWorkspace,
  createIndependentRebuildWorkspace,
  assertWorkspaceUnchanged,
  cleanupDisposableWorkspace,
} from "./project1-release-workspace.mjs";
import {
  createLinuxIsolationAdapter,
  runInNetworkMode,
  runOfflineProductionBuild,
} from "./project1-network-runner.mjs";
import { buildAndFreezeCandidate, assertCandidateUnchanged } from "./project1-candidate.mjs";
import { createDeterministicArchive, verifyArchiveRoundTrip } from "./project1-archive.mjs";
import {
  hashEvidenceNode,
  importTask12Evidence,
  verifyProject1EvidenceGraph,
} from "./project1-release-evidence.mjs";
import { scanSecretRoot, verifySecretScanReport } from "./scan-secrets.mjs";
import { scanProductionSources } from "./scan-project1-production-sources.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const KIND_BY_STEP = {
  "offline-static": "offline-static",
  lint: "offline-static",
  format: "offline-static",
  dependencies: "offline-static",
  "source-scan": "source-scan",
  "project1-tests": "project1-tests",
  "mock-browser": "mock-browser",
  audit: "audit",
  docs: "docs",
};
// The id names the step; the command is what actually runs under it. Pinning only the ids let a
// step keep its name while its command was swapped for a cheaper one, so both are pinned here.
const STEP_BY_ID = {
  "offline-static": { mode: "offline", command: ["pnpm", "typecheck"] },
  lint: { mode: "offline", command: ["pnpm", "lint"] },
  format: { mode: "offline", command: ["pnpm", "format:check"] },
  dependencies: { mode: "offline", command: ["pnpm", "dependencies"] },
  "source-scan": { mode: "offline", command: ["pnpm", "scan:secrets:source"] },
  "project1-tests": {
    mode: "offline",
    command: ["pnpm", "exec", "vitest", "run", "--maxWorkers=1", "--no-file-parallelism"],
  },
  "mock-browser": { mode: "mock", command: ["pnpm", "test:browser:built"] },
  audit: { mode: "audit", command: ["pnpm", "audit", "--prod"] },
  docs: {
    mode: "offline",
    command: ["pnpm", "exec", "vitest", "run", "tests/security/docs.test.ts"],
  },
};
// One list, so the required order and the pinned commands cannot drift apart.
const REQUIRED_STEPS = Object.keys(STEP_BY_ID);
const byteSort = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
function parseTestManifest(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("RELEASE_TEST_MANIFEST_INVALID");
  }
  if (
    JSON.stringify(value) !== text ||
    Object.keys(value).join(",") !== "schemaVersion,steps" ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.steps) ||
    value.steps.length !== REQUIRED_STEPS.length ||
    value.steps.map((step) => step.id).join("\0") !== REQUIRED_STEPS.join("\0")
  )
    throw new Error("RELEASE_TEST_MANIFEST_INVALID");
  for (const step of value.steps) {
    const expected = STEP_BY_ID[step.id];
    if (
      Object.keys(step).join(",") !== "id,mode,command" ||
      expected === undefined ||
      step.mode !== expected.mode ||
      !Array.isArray(step.command) ||
      step.command.join("\0") !== expected.command.join("\0")
    )
      throw new Error("RELEASE_TEST_MANIFEST_INVALID");
  }
  return value;
}
function evidenceNode({
  id,
  kind,
  mode,
  command,
  candidate,
  developmentOnly,
  artifacts,
  prerequisites,
  startedAt,
  finishedAt,
  status = "PASS",
  extra = {},
}) {
  if (!(startedAt instanceof Date) || !(finishedAt instanceof Date) || finishedAt < startedAt)
    throw new Error("RELEASE_EVIDENCE_TIME_INVALID");
  return {
    schemaVersion: 1,
    task: "project1-task13",
    id,
    kind,
    command,
    mode,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    developmentOnly,
    candidate,
    artifacts: [...artifacts].sort((a, b) =>
      byteSort(`${a.kind}\0${a.path}\0${a.sha256}`, `${b.kind}\0${b.path}\0${b.sha256}`),
    ),
    prerequisites: [...prerequisites].sort((a, b) =>
      byteSort(`${a.kind}\0${a.id}\0${a.hash}`, `${b.kind}\0${b.id}\0${b.hash}`),
    ),
    ...extra,
  };
}
const edge = (node) => ({ hash: hashEvidenceNode(node), id: node.id, kind: node.kind });
async function artifact(root, kind, name, bytes) {
  if (!Buffer.isBuffer(bytes))
    bytes = Buffer.from(typeof bytes === "string" ? bytes : JSON.stringify(bytes));
  if (bytes.length === 0) throw new Error("RELEASE_ARTIFACT_EMPTY");
  const relative = name.replaceAll("\\", "/");
  const target = path.join(root, ...relative.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
  return { kind, path: relative, sha256: sha256(bytes) };
}
function parseTests(output) {
  const text = output.toString("utf8");
  const failed = [...text.matchAll(/(?:fail(?:ed|ures?)?|errors?)\D+(\d+)/giu)].reduce(
    (sum, match) => sum + Number(match[1]),
    0,
  );
  const skipped = [...text.matchAll(/(?:skip(?:ped)?|pending|todo)\D+(\d+)/giu)].reduce(
    (sum, match) => sum + Number(match[1]),
    0,
  );
  const only = /(?:\.only\b|exclusive tests?\D+[1-9])/iu.test(text) ? 1 : 0;
  const passed = [...text.matchAll(/(?:pass(?:ed)?|tests?)\D+([1-9]\d*)/giu)].reduce(
    (sum, match) => Math.max(sum, Number(match[1])),
    0,
  );
  if (failed || skipped || only || passed === 0) throw new Error("RELEASE_TEST_REPORT_INVALID");
  return {
    schemaVersion: 1,
    passed,
    failed: 0,
    skipped: 0,
    todo: 0,
    only: 0,
    outputSha256: sha256(output),
    status: "PASS",
  };
}
function networkLog(evidence) {
  return {
    schemaVersion: 1,
    requestSha256: evidence.requestSha256,
    mode: evidence.mode,
    allowedEndpoints: evidence.allowedEndpoints,
    observedAttempts: evidence.observedAttempts,
    outputSha256: evidence.outputSha256,
  };
}
async function networkArtifacts(root, id, evidence, test = false) {
  const values = [await artifact(root, "network-log", `${id}/network.json`, networkLog(evidence))];
  values.push(
    await artifact(
      root,
      test ? "test-report" : "command-output",
      `${id}/${test ? "tests.json" : "output.log"}`,
      test ? parseTests(evidence.output) : evidence.output,
    ),
  );
  return values;
}
async function copyArtifact(root, kind, name, source) {
  const bytes = await readFile(source);
  return artifact(root, kind, name, bytes);
}
function parseObservedBrowserVersion(output) {
  return /(?:Google Chrome(?: for Testing)?|Chrome|Chromium)\s+(\d+(?:\.\d+){0,3})/u.exec(
    output,
  )?.[1];
}
async function observeBrowserVersion(mode) {
  let executable = process.env.TASK12_CHROME_EXECUTABLE;
  if (mode === "development" && !executable) {
    const { chromium } = await import("playwright");
    executable = chromium.executablePath();
  }
  if (!executable || !path.isAbsolute(executable))
    throw new Error(
      mode === "release"
        ? "RELEASE_CHROME110_EXECUTABLE_REQUIRED"
        : "DEVELOPMENT_CHROMIUM151_REQUIRED",
    );
  let output;
  try {
    output = execFileSync(executable, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(
      mode === "release"
        ? "RELEASE_CHROME110_EXECUTABLE_REQUIRED"
        : "DEVELOPMENT_CHROMIUM151_REQUIRED",
    );
  }
  const version = parseObservedBrowserVersion(output);
  if (!version) throw new Error("RELEASE_BROWSER_VERSION_UNOBSERVED");
  return version;
}
function observePnpmVersion() {
  const userAgent = /^pnpm\/([^\s]+)/u.exec(process.env.npm_config_user_agent ?? "")?.[1];
  if (userAgent) return userAgent;
  try {
    return execFileSync("pnpm", ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error("RELEASE_PNPM_VERSION_UNOBSERVED");
  }
}

export async function runProject1ReleaseGate(options = {}) {
  const mode = options.mode;
  if (!new Set(["release", "development"]).has(mode)) throw new Error("RELEASE_MODE_INVALID");
  const developmentOnly = mode === "development";
  const nodeVersion = options.nodeVersion ?? process.version;
  const pnpmVersion = options.pnpmVersion ?? observePnpmVersion();
  const chromeVersion = options.chromeVersion ?? (await observeBrowserVersion(mode));
  if (mode === "release" && !/^v22\.(?:1[4-9]|[2-9]\d)\./u.test(nodeVersion))
    throw new Error("RELEASE_NODE22_REQUIRED");
  if (mode === "development" && !/^v24\./u.test(nodeVersion))
    throw new Error("DEVELOPMENT_NODE24_REQUIRED");
  if (pnpmVersion !== "10.14.0") throw new Error("RELEASE_PNPM_VERSION_INVALID");
  if (mode === "release" && !/^110(?:\.|$)/u.test(chromeVersion))
    throw new Error("RELEASE_CHROME110_REQUIRED");
  if (mode === "development" && !/^151(?:\.0\.7922\.34)?$/u.test(chromeVersion))
    throw new Error("DEVELOPMENT_CHROMIUM151_REQUIRED");
  const clock = options.clock ?? (() => new Date());
  let lastTimestamp;
  const timestamp = () => {
    const value = clock();
    if (
      !(value instanceof Date) ||
      !Number.isFinite(value.getTime()) ||
      (lastTimestamp && value < lastTimestamp)
    )
      throw new Error("RELEASE_CLOCK_NON_MONOTONIC");
    lastTimestamp = value;
    return value;
  };
  const capture = async (operation) => {
    const startedAt = timestamp();
    const value = await operation();
    const finishedAt = timestamp();
    return { value, startedAt, finishedAt };
  };
  const tests = parseTestManifest(
    await readFile(
      options.testManifestPath ?? path.join(ROOT, "config/project1-release-tests.json"),
      "utf8",
    ),
  );
  const outputRoot = options.outputRoot
    ? path.resolve(options.outputRoot)
    : await mkdtemp(path.join(tmpdir(), "shardpass-project1-evidence-"));
  if (options.outputRoot) await mkdir(outputRoot, { recursive: false });
  const adapter = options.networkAdapter ?? createLinuxIsolationAdapter();
  let workspace;
  let rebuildWorkspace;
  let primaryError;
  const nodes = [];
  try {
    workspace = await createDisposableWorkspace({
      sourceRoot: options.sourceRoot ?? ROOT,
      manifestPath:
        options.inputManifestPath ?? path.join(ROOT, "config/project1-release-inputs.json"),
      temporaryRoot: options.temporaryRoot,
    });
    const provisional = { name: "ShardPass", version: "0", candidateDigest: "0".repeat(64) };
    const sourceBefore = await artifact(
      outputRoot,
      "source-before",
      "bootstrap/source-before.sha256",
      workspace.sourceSnapshotSha256,
    );
    const bootstrapStartedAt = timestamp();
    const bootstrapEvidence = await runInNetworkMode({
      mode: "bootstrap",
      commandId: "bootstrap",
      command: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      args: ["install", "--frozen-lockfile", `--store-dir=${workspace.storeDirectory}`],
      cwd: workspace.root,
      adapter,
      registryOrigin: options.registryOrigin,
    });
    await assertWorkspaceUnchanged(workspace);
    const bootstrapFinishedAt = timestamp();
    const bootstrapArtifacts = [
      sourceBefore,
      await artifact(
        outputRoot,
        "source-after",
        "bootstrap/source-after.sha256",
        workspace.sourceSnapshotSha256,
      ),
      ...(await networkArtifacts(outputRoot, "bootstrap", bootstrapEvidence)),
    ];
    nodes.push(
      evidenceNode({
        id: "bootstrap",
        kind: "bootstrap",
        mode: "bootstrap",
        command: "pnpm install --frozen-lockfile",
        candidate: provisional,
        developmentOnly,
        artifacts: bootstrapArtifacts,
        prerequisites: [],
        startedAt: bootstrapStartedAt,
        finishedAt: bootstrapFinishedAt,
      }),
    );
    for (const step of tests.steps.filter((item) =>
      ["offline-static", "lint", "format", "dependencies", "source-scan"].includes(item.id),
    )) {
      const stepStartedAt = timestamp();
      const result = await runInNetworkMode({
        mode: step.mode,
        commandId: step.id,
        command: step.command[0],
        args: step.command.slice(1),
        cwd: workspace.root,
        adapter,
        registryOrigin: options.registryOrigin,
      });
      let artifacts;
      if (step.id === "source-scan") {
        const report = await scanProductionSources({
          projectRoot: workspace.root,
          manifestPath: path.join(
            workspace.root,
            "config/project1-production-source-manifest.json",
          ),
          allowlistPath: path.join(workspace.root, "config/project1-secret-allowlist-empty.json"),
        });
        if (report.status !== "PASS" || report.reports.some((item) => item.filesScanned === 0))
          throw new Error("RELEASE_SOURCE_SCAN_INVALID");
        artifacts = [
          await artifact(outputRoot, "source-scan-report", "source-scan/report.json", report),
          ...(await networkArtifacts(outputRoot, "source-scan", result)),
        ];
      } else artifacts = await networkArtifacts(outputRoot, step.id, result);
      const stepFinishedAt = timestamp();
      nodes.push(
        evidenceNode({
          id: step.id,
          kind: KIND_BY_STEP[step.id],
          mode: step.mode,
          command: step.command.join(" "),
          candidate: provisional,
          developmentOnly,
          artifacts,
          prerequisites: [edge(nodes.at(-1))],
          startedAt: stepStartedAt,
          finishedAt: stepFinishedAt,
        }),
      );
    }
    const buildStartedAt = timestamp();
    const candidateBuild = await runOfflineProductionBuild({
      workspaceRoot: workspace.root,
      adapter,
    });
    const candidate = await buildAndFreezeCandidate({
      workspaceRoot: workspace.root,
      distPath: candidateBuild.distPath,
      buildEvidence: {
        schemaVersion: 1,
        command: candidateBuild.command,
        requestSha256: candidateBuild.network.requestSha256,
        networkResultSha256: candidateBuild.networkResultSha256,
        output: candidateBuild.network.output,
        outputSha256: candidateBuild.network.outputSha256,
      },
    });
    for (const prior of nodes) prior.candidate = candidate.identity;
    for (let index = 1; index < nodes.length; index++) priorEdge(nodes, index);
    const manifest = {
      schemaVersion: 1,
      identity: candidate.identity,
      beforeFreezeSha256: candidate.beforeFreezeSha256,
      afterFreezeSha256: candidate.snapshotSha256,
      files: candidate.files,
      networkRequestSha256: candidate.networkRequestSha256,
      networkResultSha256: candidate.networkResultSha256,
    };
    const buildArtifacts = [
      await artifact(outputRoot, "candidate-manifest", "build/candidate.json", manifest),
      await artifact(outputRoot, "build-output", "build/output.log", candidate.buildOutput),
      await artifact(outputRoot, "build-inventory", "build/inventory.json", candidate.files),
      await artifact(
        outputRoot,
        "network-log",
        "build/network.json",
        networkLog(candidateBuild.network),
      ),
    ];
    const buildFinishedAt = timestamp();
    nodes.push(
      evidenceNode({
        id: "build",
        kind: "build",
        mode: "offline",
        command:
          "pnpm exec vite build --outDir <candidate> && node scripts/inventory-ente-production-graph.mjs <candidate>",
        candidate: candidate.identity,
        developmentOnly,
        artifacts: buildArtifacts,
        prerequisites: [edge(nodes.at(-1))],
        startedAt: buildStartedAt,
        finishedAt: buildFinishedAt,
      }),
    );
    const candidateScan = await capture(async () => {
      const report = await scanSecretRoot({
        root: candidate.root,
        rootName: "dist",
        mode: "candidate",
        allowlistPath: path.join(workspace.root, "config/project1-secret-allowlist-empty.json"),
        maxTextBytes: 8 * 1024 * 1024,
        maxBinaryBytes: 32 * 1024 * 1024,
      });
      verifySecretScanReport(report);
      if (report.status !== "PASS" || report.filesScanned === 0)
        throw new Error("RELEASE_CANDIDATE_SCAN_INVALID");
      const network = await runInNetworkMode({
        mode: "offline",
        commandId: "candidate-scan",
        command: process.execPath,
        args: [
          path.join(workspace.root, "scripts/scan-secrets.mjs"),
          candidate.root,
          "candidate",
          path.join(workspace.root, "config/project1-secret-allowlist-empty.json"),
        ],
        cwd: workspace.root,
        adapter,
      });
      return { report, network };
    });
    const candidateReport = candidateScan.value.report;
    const scanNetwork = candidateScan.value.network;
    nodes.push(
      evidenceNode({
        id: "candidate-scan",
        kind: "candidate-scan",
        mode: "offline",
        command: "candidate scan",
        candidate: candidate.identity,
        developmentOnly,
        artifacts: [
          await artifact(
            outputRoot,
            "candidate-scan-report",
            "candidate-scan/report.json",
            candidateReport,
          ),
          ...(await networkArtifacts(outputRoot, "candidate-scan", scanNetwork)),
        ],
        prerequisites: [edge(nodes.at(-1))],
        startedAt: candidateScan.startedAt,
        finishedAt: candidateScan.finishedAt,
      }),
    );
    for (const step of tests.steps.filter((item) =>
      ["project1-tests", "mock-browser"].includes(item.id),
    )) {
      const execution = await capture(() =>
        runInNetworkMode({
          mode: step.mode,
          commandId: step.id,
          command: step.command[0],
          args: step.command.slice(1),
          cwd: workspace.root,
          adapter,
          mockOrigin: options.mockOrigin,
        }),
      );
      const result = execution.value;
      nodes.push(
        evidenceNode({
          id: step.id,
          kind: KIND_BY_STEP[step.id],
          mode: step.mode,
          command: step.command.join(" "),
          candidate: candidate.identity,
          developmentOnly,
          artifacts: await networkArtifacts(outputRoot, step.id, result, true),
          prerequisites: [edge(nodes.at(-1))],
          startedAt: execution.startedAt,
          finishedAt: execution.finishedAt,
        }),
      );
      await assertCandidateUnchanged(candidate);
    }
    const rebuild = await capture(async () => {
      rebuildWorkspace = await createIndependentRebuildWorkspace({
        firstWorkspace: workspace,
        sourceRoot: options.sourceRoot ?? ROOT,
        manifestPath:
          options.inputManifestPath ?? path.join(ROOT, "config/project1-release-inputs.json"),
        temporaryRoot: options.temporaryRoot,
      });
      const rebuildNetwork = await runInNetworkMode({
        mode: "offline",
        commandId: "rebuild-install",
        command: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
        args: [
          "install",
          "--offline",
          "--frozen-lockfile",
          `--store-dir=${workspace.storeDirectory}`,
        ],
        cwd: rebuildWorkspace.root,
        adapter,
        environment: {
          HOME: path.join(rebuildWorkspace.parent, "home"),
          npm_config_offline: "true",
        },
      });
      const isolatedBuild = await runOfflineProductionBuild({
        workspaceRoot: rebuildWorkspace.root,
        adapter,
      });
      const frozen = await buildAndFreezeCandidate({
        workspaceRoot: rebuildWorkspace.root,
        distPath: isolatedBuild.distPath,
        buildEvidence: {
          schemaVersion: 1,
          command: isolatedBuild.command,
          requestSha256: isolatedBuild.network.requestSha256,
          networkResultSha256: isolatedBuild.networkResultSha256,
          output: isolatedBuild.network.output,
          outputSha256: isolatedBuild.network.outputSha256,
        },
      });
      await assertWorkspaceUnchanged(rebuildWorkspace);
      return { candidate: frozen, build: isolatedBuild, install: rebuildNetwork };
    });
    const rebuilt = rebuild.value.candidate;
    const identityFiles = (files) =>
      files.map((file) => ({ path: file.path, size: file.size, sha256: file.sha256 }));
    if (
      JSON.stringify(rebuilt.identity) !== JSON.stringify(candidate.identity) ||
      JSON.stringify(identityFiles(rebuilt.files)) !==
        JSON.stringify(identityFiles(candidate.files))
    )
      throw new Error("RELEASE_REBUILD_MISMATCH");
    nodes.push(
      evidenceNode({
        id: "deterministic-build",
        kind: "deterministic-build",
        mode: "offline",
        command:
          "pnpm install --offline --frozen-lockfile --store-dir=<frozen-store> && pnpm exec vite build --outDir <second-candidate> && node scripts/inventory-ente-production-graph.mjs <second-candidate>",
        candidate: candidate.identity,
        developmentOnly,
        artifacts: [
          await artifact(outputRoot, "reproducibility-report", "rebuild/report.json", {
            schemaVersion: 1,
            sourceSnapshotSha256: workspace.sourceSnapshotSha256,
            firstWorkspace: workspace.root,
            secondWorkspace: rebuildWorkspace.root,
            sharedStoreDirectory: workspace.storeDirectory,
            first: candidate.identity,
            second: rebuilt.identity,
            firstFiles: identityFiles(candidate.files),
            secondFiles: identityFiles(rebuilt.files),
            firstNetworkRequestSha256: candidate.networkRequestSha256,
            secondNetworkRequestSha256: rebuilt.networkRequestSha256,
            status: "PASS",
          }),
          await artifact(outputRoot, "build-output", "rebuild/output.log", rebuilt.buildOutput),
          await artifact(outputRoot, "build-inventory", "rebuild/inventory.json", rebuilt.files),
          await artifact(
            outputRoot,
            "network-log",
            "rebuild/install-network.json",
            networkLog(rebuild.value.install),
          ),
          await artifact(
            outputRoot,
            "network-log",
            "rebuild/build-network.json",
            networkLog(rebuild.value.build.network),
          ),
        ],
        prerequisites: [edge(nodes.at(-1))],
        startedAt: rebuild.startedAt,
        finishedAt: rebuild.finishedAt,
      }),
    );
    const auditStep = tests.steps.find((step) => step.id === "audit");
    const auditExecution = await capture(() =>
      runInNetworkMode({
        mode: "audit",
        commandId: "audit",
        command: auditStep.command[0],
        args: auditStep.command.slice(1),
        cwd: workspace.root,
        adapter,
        registryOrigin: options.registryOrigin,
        beforeSnapshot: () => Promise.resolve(candidate.snapshotSha256),
        afterSnapshot: async () => {
          await assertCandidateUnchanged(candidate);
          return candidate.snapshotSha256;
        },
      }),
    );
    const audit = auditExecution.value;
    nodes.push(
      evidenceNode({
        id: "audit",
        kind: "audit",
        mode: "audit",
        command: auditStep.command.join(" "),
        candidate: candidate.identity,
        developmentOnly,
        artifacts: [
          await artifact(outputRoot, "audit-report", "audit/report.json", {
            schemaVersion: 1,
            outputSha256: audit.outputSha256,
            command: "pnpm audit --prod",
            registryEndpoint: "https://registry.npmjs.org/-/npm/v1/security/audits",
            attempts: audit.observedAttempts,
            prohibitedVulnerabilities: 0,
            status: "PASS",
          }),
          ...(await networkArtifacts(outputRoot, "audit", audit)),
        ],
        prerequisites: [edge(nodes.at(-1))],
        startedAt: auditExecution.startedAt,
        finishedAt: auditExecution.finishedAt,
      }),
    );
    const task12ChromeStartedAt = timestamp();
    let task12ChromeFinishedAt;
    let task12ReviewStartedAt;
    const imported = await importTask12Evidence({
      candidate: candidate.identity,
      chromeEvidencePath: options.chromeEvidencePath,
      finalEvidencePath: options.finalEvidencePath,
      trustStorePath: options.trustStorePath,
      now: task12ChromeStartedAt,
      afterChromeValidation: async () => {
        await options.operationHook?.("task12-chrome-validated");
        task12ChromeFinishedAt = timestamp();
      },
      beforeReviewVerification: async () => {
        task12ReviewStartedAt = timestamp();
        await options.operationHook?.("task12-review-verification-started");
      },
    });
    const task12ReviewFinishedAt = timestamp();
    if (!task12ChromeFinishedAt || !task12ReviewStartedAt)
      throw new Error("RELEASE_TASK12_TIMING_INVALID");
    nodes.push(
      evidenceNode({
        id: "task12-chrome110",
        kind: "task12-chrome110",
        mode: "offline",
        command: "import Task12 Chrome110",
        candidate: candidate.identity,
        developmentOnly,
        artifacts: [
          await artifact(
            outputRoot,
            "task12-chrome-report",
            "task12/chrome.json",
            imported.chrome.bytes,
          ),
        ],
        prerequisites: [edge(nodes.at(-1))],
        startedAt: task12ChromeStartedAt,
        finishedAt: task12ChromeFinishedAt,
      }),
    );
    nodes.push(
      evidenceNode({
        id: "task12-review",
        kind: "task12-review",
        mode: "offline",
        command: "verify Task12 reviewer evidence",
        candidate: candidate.identity,
        developmentOnly,
        artifacts: [
          await artifact(
            outputRoot,
            "task12-review-disposition",
            "task12/disposition.json",
            imported.review.dispositionBytes,
          ),
          await artifact(
            outputRoot,
            "task12-review-report",
            "task12/report.json",
            imported.review.reportBytes,
          ),
          await artifact(
            outputRoot,
            "task12-signature",
            "task12/signature",
            imported.review.signatureBytes,
          ),
          await copyArtifact(
            outputRoot,
            "task12-trust-store",
            "task12/trust.json",
            options.trustStorePath,
          ),
        ],
        prerequisites: [edge(nodes.at(-1))],
        startedAt: task12ReviewStartedAt,
        finishedAt: task12ReviewFinishedAt,
      }),
    );
    const archiveExecution = await capture(async () => {
      const one = await createDeterministicArchive(
        candidate,
        path.join(outputRoot, `ShardPass-${candidate.identity.version}.zip`),
      );
      const two = await createDeterministicArchive(
        candidate,
        path.join(outputRoot, `ShardPass-${candidate.identity.version}.verify.zip`),
      );
      if (one.sha256 !== two.sha256) throw new Error("ARCHIVE_NONDETERMINISTIC");
      await verifyArchiveRoundTrip(candidate, one);
      return { one, two };
    });
    const { one, two } = archiveExecution.value;
    nodes.push(
      evidenceNode({
        id: "archive",
        kind: "archive",
        mode: "offline",
        command: "deterministic ZIP twice and roundtrip",
        candidate: candidate.identity,
        developmentOnly,
        artifacts: [
          { kind: "archive", path: path.basename(one.path), sha256: one.sha256 },
          await artifact(outputRoot, "archive-report", "archive/report.json", {
            schemaVersion: 1,
            sha256: one.sha256,
            secondSha256: two.sha256,
            compression: one.compression,
            roundTrip: "PASS",
            status: "PASS",
          }),
        ],
        prerequisites: [edge(nodes.at(-1))],
        startedAt: archiveExecution.startedAt,
        finishedAt: archiveExecution.finishedAt,
      }),
    );
    const docsStep = tests.steps.find((step) => step.id === "docs");
    const docsExecution = await capture(() =>
      runInNetworkMode({
        mode: "offline",
        commandId: "docs",
        command: docsStep.command[0],
        args: docsStep.command.slice(1),
        cwd: workspace.root,
        adapter,
      }),
    );
    const docs = docsExecution.value;
    nodes.push(
      evidenceNode({
        id: "docs",
        kind: "docs",
        mode: "offline",
        command: docsStep.command.join(" "),
        candidate: candidate.identity,
        developmentOnly,
        artifacts: await networkArtifacts(outputRoot, "docs", docs, true),
        prerequisites: [edge(nodes.at(-1))],
        startedAt: docsExecution.startedAt,
        finishedAt: docsExecution.finishedAt,
      }),
    );
    if (developmentOnly)
      return Object.freeze({
        candidate: candidate.identity,
        archiveSha256: one.sha256,
        status: "DEVELOPMENT-ONLY",
        nodes: Object.freeze(nodes),
      });
    const finalStartedAt = timestamp();
    await options.operationHook?.("pre-final-graph-validation-started");
    const preFinal = evidenceNode({
      id: "final",
      kind: "final",
      mode: "offline",
      command: "validate pre-final evidence graph and bind root",
      candidate: candidate.identity,
      developmentOnly: false,
      artifacts: [],
      prerequisites: nodes.map(edge),
      startedAt: finalStartedAt,
      finishedAt: finalStartedAt,
      status: "PASS-PROJECT1-RELEASE",
      extra: { archiveSha256: one.sha256, nodeVersion, pnpmVersion, chromeVersion },
    });
    await verifyProject1EvidenceGraph({
      nodes: [...nodes, preFinal],
      artifactRoot: outputRoot,
      expectedCandidate: candidate.identity,
      now: finalStartedAt,
      release: true,
    });
    await options.operationHook?.("pre-final-graph-validated");
    const finalFinishedAt = timestamp();
    const final = evidenceNode({
      ...preFinal,
      startedAt: finalStartedAt,
      finishedAt: finalFinishedAt,
    });
    nodes.push(final);
    const disposition = await verifyProject1EvidenceGraph({
      nodes,
      artifactRoot: outputRoot,
      expectedCandidate: candidate.identity,
      now: timestamp(),
      release: true,
    });
    await assertCandidateUnchanged(candidate);
    await writeFile(path.join(outputRoot, "project1-evidence.json"), JSON.stringify(nodes), {
      flag: "wx",
      mode: 0o600,
    });
    return disposition;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (workspace) {
      try {
        if (rebuildWorkspace) {
          await assertWorkspaceUnchanged(rebuildWorkspace);
          await cleanupDisposableWorkspace(rebuildWorkspace);
        }
        await assertWorkspaceUnchanged(workspace);
        await cleanupDisposableWorkspace(workspace);
      } catch (error) {
        if (!primaryError) {
          // Cleanup integrity is part of the gate result; fail instead of returning PASS.
          // eslint-disable-next-line no-unsafe-finally
          throw new Error("RELEASE_CLEANUP_FAILED", { cause: error });
        }
      }
    }
  }
}
function priorEdge(nodes, index) {
  nodes[index].prerequisites = [edge(nodes[index - 1])];
}
async function main() {
  const mode = process.argv.find((value) => value.startsWith("--mode="))?.slice(7);
  if (!new Set(["release", "development"]).has(mode))
    throw new Error("Usage: node scripts/verify-project1-release.mjs --mode=release|development");
  const value = await runProject1ReleaseGate({
    mode,
    outputRoot: process.env.SHARDPASS_EVIDENCE_DIR,
    registryOrigin: process.env.SHARDPASS_REGISTRY_ORIGIN ?? "https://registry.npmjs.org/",
    mockOrigin: process.env.SHARDPASS_MOCK_ORIGIN ?? "http://127.0.0.1:4173",
    chromeEvidencePath:
      process.env.TASK12_CHROME_EVIDENCE ??
      path.join(ROOT, ".sdd/project1-task12-chrome110-evidence.json"),
    finalEvidencePath:
      process.env.TASK12_FINAL_EVIDENCE ??
      path.join(ROOT, ".sdd/project1-task12-final-disposition.json"),
    trustStorePath: process.env.TASK12_REVIEWER_TRUST_STORE,
  });
  process.stdout.write(`${value.status}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await main().catch((error) => {
    console.error(
      error instanceof Error ? error.message.replace(/[\r\n].*/su, "") : "PROJECT1_RELEASE_FAILED",
    );
    process.exitCode = 1;
  });
