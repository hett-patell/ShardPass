import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeTask12Candidate,
  parseTask12StructuredEvidence,
  verifyTask12ReviewerSignature,
  sha256,
} from "./task12-release-evidence.mjs";
import { verifySecretScanReport } from "./scan-secrets.mjs";

export const PROJECT1_EVIDENCE_SCHEMA_VERSION = 1;
export const PROJECT1_EVIDENCE_KINDS = Object.freeze([
  "bootstrap",
  "offline-static",
  "source-scan",
  "build",
  "candidate-scan",
  "project1-tests",
  "mock-browser",
  "deterministic-build",
  "archive",
  "audit",
  "docs",
  "task12-chrome110",
  "task12-review",
  "final",
]);
const MODES = new Set(["bootstrap", "offline", "mock", "audit"]);
const HEX = /^[a-f0-9]{64}$/u;
const COMMON = [
  "schemaVersion",
  "task",
  "id",
  "kind",
  "command",
  "mode",
  "status",
  "startedAt",
  "finishedAt",
  "developmentOnly",
  "candidate",
  "artifacts",
  "prerequisites",
];
const FINAL_EXTRA = ["archiveSha256", "nodeVersion", "pnpmVersion", "chromeVersion"];
const RELEASE_KINDS = PROJECT1_EVIDENCE_KINDS.filter((kind) => kind !== "final");
const REQUIRED_ARTIFACTS = Object.freeze({
  bootstrap: ["command-output", "network-log", "source-after", "source-before"],
  "offline-static": ["command-output", "network-log"],
  "source-scan": ["command-output", "network-log", "source-scan-report"],
  build: ["candidate-manifest", "build-output", "build-inventory", "network-log"],
  "candidate-scan": ["candidate-scan-report", "command-output", "network-log"],
  "project1-tests": ["test-report", "network-log"],
  "mock-browser": ["test-report", "network-log"],
  "deterministic-build": [
    "reproducibility-report",
    "build-output",
    "build-inventory",
    "network-log",
  ],
  archive: ["archive", "archive-report"],
  audit: ["audit-report", "command-output", "network-log"],
  docs: ["test-report", "network-log"],
  "task12-chrome110": ["task12-chrome-report"],
  "task12-review": [
    "task12-review-disposition",
    "task12-review-report",
    "task12-signature",
    "task12-trust-store",
  ],
  final: [],
});

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) =>
  isObject(value) &&
  Object.keys(value).length === keys.length &&
  Object.keys(value).every((key) => keys.includes(key));
const compareBytes = (left, right) =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
const safeRelative = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  !path.isAbsolute(value) &&
  !value.includes("\\") &&
  path.posix.normalize(value) === value &&
  !value.split("/").includes("..");
const validCandidate = (value) =>
  exactKeys(value, ["candidateDigest", "name", "version"]) &&
  typeof value.name === "string" &&
  value.name.length > 0 &&
  typeof value.version === "string" &&
  value.version.length > 0 &&
  HEX.test(value.candidateDigest);
const canonical = (value) => JSON.stringify(value);

export function parseCanonicalEvidenceJson(text) {
  if (typeof text !== "string" || Buffer.from(text, "utf8").toString("utf8") !== text)
    throw new Error("EVIDENCE_UTF8_INVALID");
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("EVIDENCE_JSON_INVALID");
  }
  if (canonical(value) !== text) throw new Error("EVIDENCE_JSON_NONCANONICAL");
  return value;
}

async function validateTree(root) {
  const seen = new Set();
  const folded = new Set();
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => compareBytes(a.name, b.name));
    for (const entry of entries) {
      if (
        entry.name.normalize("NFC") !== entry.name ||
        entry.name === "." ||
        entry.name === ".." ||
        entry.name.includes("/") ||
        entry.name.includes("\\") ||
        entry.name.includes("\0")
      )
        throw new Error("CANDIDATE_PATH_INVALID");
      const absolute = path.join(directory, entry.name);
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile()))
        throw new Error("CANDIDATE_ENTRY_NONREGULAR");
      if (metadata.isDirectory()) await walk(absolute);
      else {
        const relative = path.relative(root, absolute).split(path.sep).join("/");
        const normalized = relative.normalize("NFC");
        const lower = normalized.toLocaleLowerCase("en-US");
        if (!safeRelative(relative) || seen.has(normalized) || folded.has(lower))
          throw new Error("CANDIDATE_PATH_COLLISION");
        seen.add(normalized);
        folded.add(lower);
      }
    }
  }
  const metadata = await lstat(root);
  if (metadata.isSymbolicLink() || !metadata.isDirectory())
    throw new Error("CANDIDATE_ROOT_INVALID");
  await walk(root);
  if (seen.size === 0 || !seen.has("manifest.json")) throw new Error("CANDIDATE_INCOMPLETE");
}

export async function computeProject1Candidate(dist) {
  const root = dist instanceof URL ? fileURLToPath(dist) : path.resolve(dist);
  await validateTree(root);
  const before = await computeTask12Candidate(root);
  await validateTree(root);
  const after = await computeTask12Candidate(root);
  if (canonical(before) !== canonical(after)) throw new Error("CANDIDATE_MUTATED");
  return before;
}

export function hashEvidenceNode(node) {
  validateNode(node, { allowFinal: true });
  return createHash("sha256").update(canonical(node)).digest("hex");
}

function parseTime(value, now) {
  if (typeof value !== "string") throw new Error("EVIDENCE_TIME_INVALID");
  const time = new Date(value);
  if (!Number.isFinite(time.getTime()) || time.toISOString() !== value || time > now)
    throw new Error("EVIDENCE_TIME_INVALID");
  return time;
}

function validateNode(node, { allowFinal, now = new Date(8640000000000000) } = {}) {
  const expected = node?.kind === "final" ? [...COMMON, ...FINAL_EXTRA] : COMMON;
  if (
    !exactKeys(node, expected) ||
    node.schemaVersion !== 1 ||
    node.task !== "project1-task13" ||
    !PROJECT1_EVIDENCE_KINDS.includes(node.kind) ||
    (!allowFinal && node.kind === "final") ||
    typeof node.id !== "string" ||
    !/^[a-z0-9][a-z0-9.-]*$/u.test(node.id) ||
    typeof node.command !== "string" ||
    node.command.length === 0 ||
    !MODES.has(node.mode) ||
    typeof node.developmentOnly !== "boolean" ||
    !validCandidate(node.candidate) ||
    !Array.isArray(node.artifacts) ||
    !Array.isArray(node.prerequisites)
  )
    throw new Error("EVIDENCE_NODE_INVALID");
  const started = parseTime(node.startedAt, now);
  const finished = parseTime(node.finishedAt, now);
  if (finished < started) throw new Error("EVIDENCE_TIME_REVERSED");
  if (node.kind === "final") {
    if (
      node.mode !== "offline" ||
      node.status !== "PASS-PROJECT1-RELEASE" ||
      !HEX.test(node.archiveSha256) ||
      !/^v22\./u.test(node.nodeVersion) ||
      node.pnpmVersion !== "10.14.0" ||
      !/^110(?:\.|$)/u.test(node.chromeVersion)
    )
      throw new Error("EVIDENCE_FINAL_INVALID");
  } else if (node.status !== "PASS") throw new Error("EVIDENCE_STATUS_INVALID");
  let prior = "";
  for (const artifact of node.artifacts) {
    if (
      !exactKeys(artifact, ["kind", "path", "sha256"]) ||
      typeof artifact.kind !== "string" ||
      !safeRelative(artifact.path) ||
      !HEX.test(artifact.sha256)
    )
      throw new Error("EVIDENCE_ARTIFACT_INVALID");
    const key = `${artifact.kind}\0${artifact.path}\0${artifact.sha256}`;
    if (compareBytes(prior, key) >= 0) throw new Error("EVIDENCE_ARTIFACT_ORDER_INVALID");
    prior = key;
  }
  prior = "";
  for (const edge of node.prerequisites) {
    if (
      !exactKeys(edge, ["hash", "id", "kind"]) ||
      !PROJECT1_EVIDENCE_KINDS.includes(edge.kind) ||
      edge.kind === "final" ||
      typeof edge.id !== "string" ||
      !HEX.test(edge.hash)
    )
      throw new Error("EVIDENCE_EDGE_INVALID");
    const key = `${edge.kind}\0${edge.id}\0${edge.hash}`;
    if (compareBytes(prior, key) >= 0) throw new Error("EVIDENCE_EDGE_ORDER_INVALID");
    prior = key;
  }
}

const jsonArtifact = (bytes) => {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("EVIDENCE_ARTIFACT_SCHEMA_INVALID");
  }
  if (JSON.stringify(value) !== bytes.toString("utf8"))
    throw new Error("EVIDENCE_ARTIFACT_SCHEMA_INVALID");
  return value;
};
const exact = (value, keys) =>
  exactKeys(value, keys) ||
  (() => {
    throw new Error("EVIDENCE_ARTIFACT_SCHEMA_INVALID");
  })();
const validFile = (file, withMode = false) => {
  exact(file, withMode ? ["path", "size", "mode", "sha256"] : ["path", "size", "sha256"]);
  return (
    safeRelative(file.path) &&
    Number.isSafeInteger(file.size) &&
    file.size >= 0 &&
    HEX.test(file.sha256) &&
    (!withMode || (Number.isSafeInteger(file.mode) && file.mode >= 0 && file.mode <= 0o777))
  );
};
function validateNetwork(value, node) {
  exact(value, [
    "schemaVersion",
    "requestSha256",
    "mode",
    "allowedEndpoints",
    "observedAttempts",
    "outputSha256",
  ]);
  if (
    value.schemaVersion !== 1 ||
    value.mode !== node.mode ||
    !HEX.test(value.requestSha256) ||
    !HEX.test(value.outputSha256) ||
    !Array.isArray(value.allowedEndpoints) ||
    !Array.isArray(value.observedAttempts) ||
    value.allowedEndpoints.some((entry) => typeof entry !== "string") ||
    value.observedAttempts.some((entry) => typeof entry !== "string") ||
    (value.mode === "offline" &&
      (value.allowedEndpoints.length !== 0 || value.observedAttempts.length !== 0)) ||
    (value.mode !== "offline" &&
      (value.allowedEndpoints.length === 0 || value.observedAttempts.length === 0))
  )
    throw new Error("EVIDENCE_ARTIFACT_SCHEMA_INVALID");
}
function validateArtifactContent(artifact, bytes, node, context) {
  if (["build-output", "command-output"].includes(artifact.kind)) {
    const network = context.networks.find((value) => value.outputSha256 === artifact.sha256);
    if (!network) throw new Error("EVIDENCE_ARTIFACT_BINDING_INVALID");
    return;
  }
  if (artifact.kind === "archive" || artifact.kind === "task12-signature") return;
  if (["source-before", "source-after"].includes(artifact.kind)) {
    if (!HEX.test(bytes.toString("utf8"))) throw new Error("EVIDENCE_ARTIFACT_SCHEMA_INVALID");
    context.sourceDigests.push(bytes.toString("utf8"));
    return;
  }
  const value = jsonArtifact(bytes);
  if (artifact.kind === "network-log") {
    validateNetwork(value, node);
    context.networks.push(value);
  } else if (["source-scan-report", "candidate-scan-report"].includes(artifact.kind)) {
    if (artifact.kind === "source-scan-report") {
      exact(value, [
        "schemaVersion",
        "manifestSha256",
        "allowlistSha256",
        "excludedTestOnlyFiles",
        "eligibleFileCount",
        "reports",
        "status",
      ]);
      if (
        value.schemaVersion !== 1 ||
        value.status !== "PASS" ||
        !HEX.test(value.manifestSha256) ||
        !HEX.test(value.allowlistSha256) ||
        !Array.isArray(value.excludedTestOnlyFiles) ||
        !Number.isSafeInteger(value.eligibleFileCount) ||
        value.eligibleFileCount <= 0 ||
        !Array.isArray(value.reports) ||
        value.reports.length !== 6 ||
        value.reports.reduce((sum, report) => sum + report.filesScanned, 0) !==
          value.eligibleFileCount
      )
        throw new Error("EVIDENCE_ARTIFACT_SCHEMA_INVALID");
      const expectedSourceRoots = [
        "apps-production",
        "packages-production",
        "scripts-production",
        "tools-production",
        "root-config",
        "current-docs",
      ];
      for (const [index, report] of value.reports.entries()) {
        verifySecretScanReport(report);
        if (
          report.rootName !== expectedSourceRoots[index] ||
          report.mode !== "source" ||
          report.status !== "PASS" ||
          report.allowlistSha256 !== value.allowlistSha256 ||
          report.findings.length !== 0 ||
          report.allowancesUsed.length !== 0
        )
          throw new Error("EVIDENCE_ARTIFACT_SCHEMA_INVALID");
      }
    } else {
      verifySecretScanReport(value);
      if (
        value.mode !== "candidate" ||
        value.rootName !== "dist" ||
        value.status !== "PASS" ||
        value.filesScanned <= 0
      )
        throw new Error("EVIDENCE_ARTIFACT_SCHEMA_INVALID");
    }
  } else if (artifact.kind === "test-report") {
    exact(value, [
      "schemaVersion",
      "passed",
      "failed",
      "skipped",
      "todo",
      "only",
      "outputSha256",
      "status",
    ]);
    if (
      value.schemaVersion !== 1 ||
      !Number.isSafeInteger(value.passed) ||
      value.passed <= 0 ||
      value.failed !== 0 ||
      value.skipped !== 0 ||
      value.todo !== 0 ||
      value.only !== 0 ||
      !HEX.test(value.outputSha256) ||
      value.status !== "PASS"
    )
      throw new Error("EVIDENCE_ARTIFACT_SCHEMA_INVALID");
  } else if (artifact.kind === "candidate-manifest") {
    exact(value, [
      "schemaVersion",
      "identity",
      "beforeFreezeSha256",
      "afterFreezeSha256",
      "files",
      "networkRequestSha256",
      "networkResultSha256",
    ]);
    if (
      value.schemaVersion !== 1 ||
      canonical(value.identity) !== canonical(node.candidate) ||
      !HEX.test(value.beforeFreezeSha256) ||
      !HEX.test(value.afterFreezeSha256) ||
      !HEX.test(value.networkRequestSha256) ||
      !HEX.test(value.networkResultSha256) ||
      !Array.isArray(value.files) ||
      value.files.length === 0 ||
      value.files.some((file) => !validFile(file, true))
    )
      throw new Error("EVIDENCE_ARTIFACT_SCHEMA_INVALID");
    context.manifest = value;
  } else if (artifact.kind === "build-inventory") {
    if (!Array.isArray(value) || value.length === 0 || value.some((file) => !validFile(file, true)))
      throw new Error("EVIDENCE_ARTIFACT_SCHEMA_INVALID");
    context.inventories.push(value);
  } else if (artifact.kind === "reproducibility-report") {
    exact(value, [
      "schemaVersion",
      "sourceSnapshotSha256",
      "firstWorkspace",
      "secondWorkspace",
      "sharedStoreDirectory",
      "first",
      "second",
      "firstFiles",
      "secondFiles",
      "firstNetworkRequestSha256",
      "secondNetworkRequestSha256",
      "status",
    ]);
    if (
      value.schemaVersion !== 1 ||
      value.status !== "PASS" ||
      !HEX.test(value.sourceSnapshotSha256) ||
      value.firstWorkspace === value.secondWorkspace ||
      value.sharedStoreDirectory.length === 0 ||
      canonical(value.first) !== canonical(node.candidate) ||
      canonical(value.second) !== canonical(node.candidate) ||
      canonical(value.firstFiles) !== canonical(value.secondFiles) ||
      !Array.isArray(value.firstFiles) ||
      value.firstFiles.length === 0 ||
      value.firstFiles.some((file) => !validFile(file)) ||
      !HEX.test(value.firstNetworkRequestSha256) ||
      !HEX.test(value.secondNetworkRequestSha256)
    )
      throw new Error("EVIDENCE_ARTIFACT_SCHEMA_INVALID");
  } else if (artifact.kind === "archive-report") {
    exact(value, ["schemaVersion", "sha256", "secondSha256", "compression", "roundTrip", "status"]);
    if (
      value.schemaVersion !== 1 ||
      value.sha256 !== value.secondSha256 ||
      !HEX.test(value.sha256) ||
      value.roundTrip !== "PASS" ||
      value.status !== "PASS"
    )
      throw new Error("EVIDENCE_ARTIFACT_SCHEMA_INVALID");
    context.archiveSha256 = value.sha256;
  } else if (artifact.kind === "audit-report") {
    exact(value, [
      "schemaVersion",
      "command",
      "registryEndpoint",
      "outputSha256",
      "attempts",
      "prohibitedVulnerabilities",
      "status",
    ]);
    if (
      value.schemaVersion !== 1 ||
      value.command !== "pnpm audit --prod" ||
      value.registryEndpoint !== "https://registry.npmjs.org/-/npm/v1/security/audits" ||
      !HEX.test(value.outputSha256) ||
      !Array.isArray(value.attempts) ||
      value.attempts.length === 0 ||
      value.prohibitedVulnerabilities !== 0 ||
      value.status !== "PASS"
    )
      throw new Error("EVIDENCE_ARTIFACT_SCHEMA_INVALID");
  } else if (artifact.kind.startsWith("task12-")) {
    if (artifact.kind === "task12-chrome-report")
      parseTask12StructuredEvidence(bytes.toString("utf8").trim(), {
        expectedKind: "chrome110",
        expectedCandidate: node.candidate,
      });
    else if (artifact.kind === "task12-review-disposition")
      parseTask12StructuredEvidence(bytes.toString("utf8").trim(), {
        expectedKind: "final-disposition",
        expectedCandidate: node.candidate,
      });
    else if (artifact.kind === "task12-review-report") {
      exact(value, [
        "schemaVersion",
        "task",
        "status",
        "candidateDigest",
        "scope",
        "reviewer",
        "chromeEvidenceSha256",
        "toolResults",
        "reviewedAt",
      ]);
      if (
        value.schemaVersion !== 2 ||
        value.task !== "project1-task12" ||
        value.status !== "APPROVED" ||
        value.candidateDigest !== node.candidate.candidateDigest ||
        !Array.isArray(value.scope) ||
        value.scope.length === 0 ||
        !isObject(value.reviewer) ||
        !HEX.test(value.chromeEvidenceSha256) ||
        !isObject(value.toolResults) ||
        typeof value.reviewedAt !== "string"
      )
        throw new Error("EVIDENCE_ARTIFACT_SCHEMA_INVALID");
    } else if (artifact.kind === "task12-trust-store") {
      exact(value, ["schemaVersion", "task", "keys"]);
      if (
        value.schemaVersion !== 1 ||
        value.task !== "project1-task12" ||
        !Array.isArray(value.keys) ||
        value.keys.length === 0
      )
        throw new Error("EVIDENCE_ARTIFACT_SCHEMA_INVALID");
    }
  }
}

async function verifyNodeArtifacts(root, node) {
  const context = { networks: [], sourceDigests: [], inventories: [] };
  const loaded = [];
  for (const artifact of node.artifacts) {
    const absolute = path.resolve(root, ...artifact.path.split("/"));
    if (absolute !== path.resolve(root) && !absolute.startsWith(`${path.resolve(root)}${path.sep}`))
      throw new Error("EVIDENCE_ARTIFACT_ESCAPE");
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink() || !metadata.isFile())
      throw new Error("EVIDENCE_ARTIFACT_NONREGULAR");
    const bytes = await readFile(absolute);
    if (bytes.length === 0) throw new Error("EVIDENCE_ARTIFACT_EMPTY");
    if (sha256(bytes) !== artifact.sha256) throw new Error("EVIDENCE_ARTIFACT_HASH_MISMATCH");
    loaded.push([artifact, bytes]);
    if (artifact.kind === "network-log") validateArtifactContent(artifact, bytes, node, context);
  }
  for (const [artifact, bytes] of loaded)
    if (artifact.kind !== "network-log") validateArtifactContent(artifact, bytes, node, context);
  if (
    context.sourceDigests.length &&
    (context.sourceDigests.length !== 2 || context.sourceDigests[0] !== context.sourceDigests[1])
  )
    throw new Error("EVIDENCE_ARTIFACT_BINDING_INVALID");
  if (
    context.manifest &&
    context.inventories.some(
      (inventory) => canonical(inventory) !== canonical(context.manifest.files),
    )
  )
    throw new Error("EVIDENCE_ARTIFACT_BINDING_INVALID");
  if (
    context.archiveSha256 &&
    !node.artifacts.some(
      (artifact) => artifact.kind === "archive" && artifact.sha256 === context.archiveSha256,
    )
  )
    throw new Error("EVIDENCE_ARTIFACT_BINDING_INVALID");
}

export async function importTask12Evidence({
  candidate,
  chromeEvidencePath,
  finalEvidencePath,
  trustStorePath,
  now = new Date(),
  afterChromeValidation = () => undefined,
  beforeReviewVerification = () => undefined,
}) {
  const chromeBytes = await readFile(chromeEvidencePath);
  const chrome = parseTask12StructuredEvidence(chromeBytes.toString("utf8").trim(), {
    expectedKind: "chrome110",
    expectedCandidate: candidate,
    now,
  });
  await afterChromeValidation();
  await beforeReviewVerification();
  const finalBytes = await readFile(finalEvidencePath);
  const final = parseTask12StructuredEvidence(finalBytes.toString("utf8").trim(), {
    expectedKind: "final-disposition",
    expectedCandidate: candidate,
    now,
  });
  if (final.chromeEvidenceSha256 !== sha256(chromeBytes))
    throw new Error("TASK12_CHROME_HASH_MISMATCH");
  const evidenceDirectory = path.dirname(path.resolve(finalEvidencePath));
  const reportPath = path.resolve(evidenceDirectory, final.reviewReportPath);
  const signaturePath = path.resolve(evidenceDirectory, final.signaturePath);
  const [reportBytes, signatureBytes, trustStoreText] = await Promise.all([
    readFile(reportPath),
    readFile(signaturePath),
    readFile(trustStorePath, "utf8"),
  ]);
  const verified = verifyTask12ReviewerSignature(reportBytes, signatureBytes, trustStoreText, {
    expectedCandidateDigest: candidate.candidateDigest,
    expectedChromeEvidenceSha256: sha256(chromeBytes),
    now,
  });
  if (
    sha256(reportBytes) !== final.reviewReportSha256 ||
    sha256(signatureBytes) !== final.signatureSha256 ||
    verified.reviewerId !== final.reviewerId ||
    verified.organization !== final.reviewerOrganization ||
    verified.fingerprint !== final.reviewerKeyFingerprint
  )
    throw new Error("TASK12_REVIEW_BINDING_INVALID");
  return Object.freeze({
    chrome: Object.freeze({ bytes: chromeBytes, sha256: sha256(chromeBytes), record: chrome }),
    review: Object.freeze({
      dispositionBytes: finalBytes,
      dispositionSha256: sha256(finalBytes),
      reportBytes,
      reportSha256: sha256(reportBytes),
      signatureBytes,
      signatureSha256: sha256(signatureBytes),
      record: final,
    }),
  });
}

export async function verifyProject1EvidenceGraph({
  nodes,
  artifactRoot,
  expectedCandidate,
  now = new Date(),
  release = true,
}) {
  if (!Array.isArray(nodes) || nodes.length === 0) throw new Error("EVIDENCE_GRAPH_EMPTY");
  const byId = new Map();
  const byHash = new Map();
  for (const node of nodes) {
    validateNode(node, { allowFinal: true, now });
    const artifactKinds = new Set(node.artifacts.map((artifact) => artifact.kind));
    for (const required of REQUIRED_ARTIFACTS[node.kind])
      if (!artifactKinds.has(required)) throw new Error("EVIDENCE_REQUIRED_ARTIFACT_MISSING");
    const hash = hashEvidenceNode(node);
    if (byId.has(node.id) || byHash.has(hash)) throw new Error("EVIDENCE_IDENTITY_DUPLICATE");
    if (canonical(node.candidate) !== canonical(expectedCandidate))
      throw new Error("EVIDENCE_CANDIDATE_DRIFT");
    if (release && node.developmentOnly) throw new Error("EVIDENCE_DEVELOPMENT_ANCESTRY");
    await verifyNodeArtifacts(artifactRoot, node);
    byId.set(node.id, { node, hash });
    byHash.set(hash, node);
  }
  const finals = nodes.filter((node) => node.kind === "final");
  if (finals.length !== 1) throw new Error("EVIDENCE_FINAL_ROOT_INVALID");
  const referenced = new Set();
  for (const node of nodes)
    for (const edge of node.prerequisites) {
      const target = byId.get(edge.id);
      if (
        !target ||
        target.hash !== edge.hash ||
        target.node.kind !== edge.kind ||
        target.node.kind === "final"
      )
        throw new Error("EVIDENCE_PREREQUISITE_INVALID");
      if (new Date(target.node.finishedAt) > new Date(node.startedAt))
        throw new Error("EVIDENCE_PREREQUISITE_TIME_INVALID");
      referenced.add(edge.id);
    }
  const final = finals[0];
  const finalKinds = new Set(final.prerequisites.map((edge) => edge.kind));
  for (const kind of RELEASE_KINDS)
    if (!nodes.some((node) => node.kind === kind) || !finalKinds.has(kind))
      throw new Error("EVIDENCE_REQUIRED_KIND_MISSING");
  for (const node of nodes)
    if (node !== final && !referenced.has(node.id)) throw new Error("EVIDENCE_ORPHAN_NODE");
  const visiting = new Set();
  const visited = new Set();
  const visit = (node) => {
    if (visiting.has(node.id)) throw new Error("EVIDENCE_CYCLE");
    if (visited.has(node.id)) return;
    visiting.add(node.id);
    for (const edge of node.prerequisites) visit(byId.get(edge.id).node);
    visiting.delete(node.id);
    visited.add(node.id);
  };
  visit(final);
  if (visited.size !== nodes.length) throw new Error("EVIDENCE_UNROOTED_NODE");
  return Object.freeze({
    candidate: expectedCandidate,
    archiveSha256: final.archiveSha256,
    finalNode: final,
    finalNodeSha256: hashEvidenceNode(final),
    status: final.status,
  });
}
