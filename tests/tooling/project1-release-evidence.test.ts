import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeTask12Candidate } from "../../scripts/task12-release-evidence.mjs";
import {
  computeProject1Candidate,
  hashEvidenceNode,
  parseCanonicalEvidenceJson,
  verifyProject1EvidenceGraph,
  type EvidenceKind,
  type Project1EvidenceNode,
} from "../../scripts/project1-release-evidence.mjs";

const roots: string[] = [];
const kinds: readonly Exclude<EvidenceKind, "final">[] = [
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
];
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const hex = "a".repeat(64);
const canonical = (value: unknown) => Buffer.from(JSON.stringify(value));

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "p1-evidence-test-"));
  roots.push(root);
  const dist = path.join(root, "dist");
  await mkdir(path.join(dist, "assets"), { recursive: true });
  await writeFile(path.join(dist, "manifest.json"), '{"name":"ShardPass","version":"1.0.0"}');
  await writeFile(path.join(dist, "assets/a.js"), "a\n");
  return { root, dist };
}

async function writeArtifact(root: string, kind: string, name: string, bytes: Buffer) {
  const target = path.join(root, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
  return { kind, path: name, sha256: sha(bytes) };
}

function scanReport(rootName: string, mode: "source" | "candidate", filesScanned = 1) {
  return {
    schemaVersion: 1,
    mode,
    rootName,
    rootDigest: hex,
    allowlistSha256: hex,
    filesScanned,
    findings: [],
    allowancesUsed: [],
    status: "PASS",
  };
}

async function completeGraph(value: Awaited<ReturnType<typeof fixture>>) {
  const candidate = await computeProject1Candidate(value.dist);
  const now = new Date("2026-08-21T12:00:00.000Z");
  const nodes: Project1EvidenceNode[] = [];
  const inventory = [{ path: "manifest.json", size: 42, mode: 0o444, sha256: hex }];
  for (const kind of kinds) {
    const values: [string, string, Buffer][] = [];
    const mode =
      kind === "bootstrap"
        ? "bootstrap"
        : kind === "mock-browser"
          ? "mock"
          : kind === "audit"
            ? "audit"
            : "offline";
    const output = Buffer.from("1 test passed\n");
    const network = {
      schemaVersion: 1,
      requestSha256: hex,
      mode,
      allowedEndpoints:
        mode === "offline"
          ? []
          : [
              mode === "mock"
                ? "http://127.0.0.1:4173"
                : mode === "audit"
                  ? "https://registry.npmjs.org/-/npm/v1/security/audits"
                  : "https://registry.npmjs.org",
            ],
      observedAttempts:
        mode === "offline"
          ? []
          : [
              mode === "mock"
                ? "http://127.0.0.1:4173 allowed"
                : "https://registry.npmjs.org:443 allowed",
            ],
      outputSha256: sha(output),
    };
    if (
      [
        "bootstrap",
        "offline-static",
        "source-scan",
        "build",
        "candidate-scan",
        "project1-tests",
        "mock-browser",
        "deterministic-build",
        "audit",
        "docs",
      ].includes(kind)
    )
      values.push(["network-log", `${kind}/network.json`, canonical(network)]);
    if (["bootstrap", "offline-static", "source-scan", "candidate-scan", "audit"].includes(kind))
      values.push(["command-output", `${kind}/output.log`, output]);
    if (["project1-tests", "mock-browser", "docs"].includes(kind))
      values.push([
        "test-report",
        `${kind}/tests.json`,
        canonical({
          schemaVersion: 1,
          passed: 1,
          failed: 0,
          skipped: 0,
          todo: 0,
          only: 0,
          outputSha256: sha(output),
          status: "PASS",
        }),
      ]);
    if (kind === "bootstrap") {
      values.push(["source-before", "bootstrap/source-before.sha256", Buffer.from(hex)]);
      values.push(["source-after", "bootstrap/source-after.sha256", Buffer.from(hex)]);
    }
    if (kind === "source-scan") {
      const reports = [
        "apps-production",
        "packages-production",
        "scripts-production",
        "tools-production",
        "root-config",
        "current-docs",
      ].map((name) => scanReport(name, "source"));
      values.push([
        "source-scan-report",
        "source-scan/report.json",
        canonical({
          schemaVersion: 1,
          manifestSha256: hex,
          allowlistSha256: hex,
          excludedTestOnlyFiles: [],
          eligibleFileCount: 6,
          reports,
          status: "PASS",
        }),
      ]);
    }
    if (kind === "build") {
      values.push([
        "candidate-manifest",
        "build/candidate.json",
        canonical({
          schemaVersion: 1,
          identity: candidate,
          beforeFreezeSha256: hex,
          afterFreezeSha256: hex,
          files: inventory,
          networkRequestSha256: hex,
          networkResultSha256: hex,
        }),
      ]);
      values.push(["build-output", "build/output.log", output]);
      values.push(["build-inventory", "build/inventory.json", canonical(inventory)]);
    }
    if (kind === "candidate-scan")
      values.push([
        "candidate-scan-report",
        "candidate-scan/report.json",
        canonical(scanReport("dist", "candidate")),
      ]);
    if (kind === "deterministic-build") {
      values.push(["build-output", "rebuild/output.log", output]);
      values.push(["build-inventory", "rebuild/inventory.json", canonical(inventory)]);
      values.push([
        "reproducibility-report",
        "rebuild/report.json",
        canonical({
          schemaVersion: 1,
          sourceSnapshotSha256: hex,
          firstWorkspace: "/tmp/one",
          secondWorkspace: "/tmp/two",
          sharedStoreDirectory: "/tmp/store",
          first: candidate,
          second: candidate,
          firstFiles: inventory.map((file) => ({
            path: file.path,
            size: file.size,
            sha256: file.sha256,
          })),
          secondFiles: inventory.map((file) => ({
            path: file.path,
            size: file.size,
            sha256: file.sha256,
          })),
          firstNetworkRequestSha256: hex,
          secondNetworkRequestSha256: hex,
          status: "PASS",
        }),
      ]);
    }
    if (kind === "archive") {
      const archive = Buffer.from("zip");
      values.push(["archive", "archive/release.zip", archive]);
      values.push([
        "archive-report",
        "archive/report.json",
        canonical({
          schemaVersion: 1,
          sha256: sha(archive),
          secondSha256: sha(archive),
          compression: "store",
          roundTrip: "PASS",
          status: "PASS",
        }),
      ]);
    }
    if (kind === "audit")
      values.push([
        "audit-report",
        "audit/report.json",
        canonical({
          schemaVersion: 1,
          command: "pnpm audit --prod",
          registryEndpoint: "https://registry.npmjs.org/-/npm/v1/security/audits",
          outputSha256: sha(output),
          attempts: network.observedAttempts,
          prohibitedVulnerabilities: 0,
          status: "PASS",
        }),
      ]);
    if (kind === "task12-chrome110")
      values.push([
        "task12-chrome-report",
        "task12/chrome.json",
        canonical({
          schemaVersion: 2,
          task: "project1-task12",
          kind: "chrome110",
          status: "PASS",
          command: "pnpm verify:project1:task12:chrome110",
          result: "PASS-TASK12-CHROME110",
          candidate,
          observedAt: now.toISOString(),
          version: "110.0.1",
        }),
      ]);
    if (kind === "task12-review") {
      values.push([
        "task12-review-disposition",
        "task12/disposition.json",
        canonical({
          schemaVersion: 2,
          task: "project1-task12",
          kind: "final-disposition",
          status: "PASS-TASK12-PHASE3-FINAL",
          command: "pnpm verify:project1:task12:final-review",
          result: "PASS",
          candidate,
          observedAt: now.toISOString(),
          chromeEvidenceSha256: hex,
          reviewReportPath: "report.json",
          reviewReportSha256: hex,
          reviewerId: "reviewer",
          reviewerKeyFingerprint: hex,
          reviewerOrganization: "org",
          signaturePath: "signature",
          signatureSha256: hex,
        }),
      ]);
      values.push([
        "task12-review-report",
        "task12/report.json",
        canonical({
          schemaVersion: 2,
          task: "project1-task12",
          status: "APPROVED",
          candidateDigest: candidate.candidateDigest,
          scope: ["full"],
          reviewer: { id: "reviewer", organization: "org" },
          chromeEvidenceSha256: hex,
          toolResults: { chrome110: "PASS" },
          reviewedAt: now.toISOString(),
        }),
      ]);
      values.push(["task12-signature", "task12/signature", Buffer.from("signature")]);
      values.push([
        "task12-trust-store",
        "task12/trust.json",
        canonical({ schemaVersion: 1, task: "project1-task12", keys: [{}] }),
      ]);
    }
    const artifacts = await Promise.all(
      values.map(([artifactKind, name, bytes]) =>
        writeArtifact(value.root, artifactKind, name, bytes),
      ),
    );
    artifacts.sort((a, b) =>
      Buffer.compare(
        Buffer.from(`${a.kind}\0${a.path}\0${a.sha256}`),
        Buffer.from(`${b.kind}\0${b.path}\0${b.sha256}`),
      ),
    );
    const prior = nodes.at(-1);
    nodes.push({
      schemaVersion: 1,
      task: "project1-task13",
      id: kind,
      kind,
      command: kind,
      mode,
      status: "PASS",
      startedAt: now.toISOString(),
      finishedAt: now.toISOString(),
      developmentOnly: false,
      candidate,
      artifacts,
      prerequisites: prior
        ? [
            {
              hash: hashEvidenceNode(prior),
              id: prior.id,
              kind: prior.kind as Exclude<EvidenceKind, "final">,
            },
          ]
        : [],
    });
  }
  const edges = nodes
    .map((node) => ({
      hash: hashEvidenceNode(node),
      id: node.id,
      kind: node.kind as Exclude<EvidenceKind, "final">,
    }))
    .sort((a, b) =>
      Buffer.compare(
        Buffer.from(`${a.kind}\0${a.id}\0${a.hash}`),
        Buffer.from(`${b.kind}\0${b.id}\0${b.hash}`),
      ),
    );
  nodes.push({
    schemaVersion: 1,
    task: "project1-task13",
    id: "final",
    kind: "final",
    command: "validate pre-final evidence graph and bind root",
    mode: "offline",
    status: "PASS-PROJECT1-RELEASE",
    startedAt: now.toISOString(),
    finishedAt: now.toISOString(),
    developmentOnly: false,
    candidate,
    artifacts: [],
    prerequisites: edges,
    archiveSha256:
      nodes
        .find((node) => node.kind === "archive")
        ?.artifacts.find((artifact) => artifact.kind === "archive")?.sha256 ?? hex,
    nodeVersion: "v22.14.0",
    pnpmVersion: "10.14.0",
    chromeVersion: "110.0.1",
  });
  return { candidate, nodes, now };
}

afterEach(async () =>
  Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true }))),
);

describe("Project 1 release evidence", () => {
  it("preserves Task12 identity after stricter tree checks", async () => {
    const value = await fixture();
    expect(await computeProject1Candidate(value.dist)).toEqual(
      await computeTask12Candidate(value.dist),
    );
    await symlink("manifest.json", path.join(value.dist, "link"));
    await expect(computeProject1Candidate(value.dist)).rejects.toThrow(
      "CANDIDATE_ENTRY_NONREGULAR",
    );
  });

  it("parses canonical JSON only", () => {
    expect(parseCanonicalEvidenceJson('{"a":1}')).toEqual({ a: 1 });
    expect(() => parseCanonicalEvidenceJson('{ "a": 1 }')).toThrow("EVIDENCE_JSON_NONCANONICAL");
  });

  it("validates substantive artifacts and rejects every field tamper", async () => {
    const value = await fixture();
    const graph = await completeGraph(value);
    await expect(
      verifyProject1EvidenceGraph({
        nodes: graph.nodes,
        artifactRoot: value.root,
        expectedCandidate: graph.candidate,
        now: graph.now,
      }),
    ).resolves.toMatchObject({ status: "PASS-PROJECT1-RELEASE" });
    for (const node of graph.nodes.filter((item) => item.artifacts.length)) {
      const artifact = node.artifacts.find(
        (item) => item.kind !== "archive" && item.kind !== "task12-signature",
      );
      if (!artifact) continue;
      const target = path.join(value.root, artifact.path);
      const original = await readFile(target);
      let tampered: Buffer;
      try {
        const parsed = JSON.parse(original.toString()) as Record<string, unknown> | unknown[];
        if (Array.isArray(parsed)) parsed.push({ injected: true });
        else parsed.injected = true;
        tampered = canonical(parsed);
      } catch {
        tampered = Buffer.concat([original, Buffer.from("tamper")]);
      }
      await writeFile(target, tampered);
      const nodes = graph.nodes.map((item) =>
        item.id === node.id
          ? {
              ...item,
              artifacts: item.artifacts.map((entry) =>
                entry.path === artifact.path ? { ...entry, sha256: sha(tampered) } : entry,
              ),
            }
          : item,
      );
      try {
        await verifyProject1EvidenceGraph({
          nodes,
          artifactRoot: value.root,
          expectedCandidate: graph.candidate,
          now: graph.now,
        });
        throw new Error(`tamper accepted: ${node.kind}/${artifact.kind}`);
      } catch (error) {
        expect((error as Error).message).not.toMatch(/^tamper accepted:/u);
      }
      await writeFile(target, original);
    }
  });
});
