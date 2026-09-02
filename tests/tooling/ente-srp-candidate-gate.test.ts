import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const derived = (...hashes: string[]) => `derived-pass:${sha256(hashes.join(":"))}`;

type HashedFile = Readonly<{ path: string; sha256: string }>;
type PackageEvidence = Readonly<{
  name: string;
  version: string;
  integrity: string;
  license: string;
  repository: string;
  packageJsonSha256: string;
  licenseFile: string;
  licenseSha256: string;
  dependencies: readonly string[];
  sourceGraph: readonly HashedFile[];
}>;
type CandidateReport = Readonly<{
  schemaVersion: 1;
  protocolPin: string;
  candidate: PackageEvidence &
    Readonly<{ maintenanceReviewedAt: string; maintenanceDisposition: string }>;
  transitiveGraph: readonly PackageEvidence[];
  sourceGraph: readonly HashedFile[];
  compatibilityGraph: readonly HashedFile[];
  evidence: Readonly<{
    reference: HashedFile;
    candidate: HashedFile;
    legacy: HashedFile;
    current: HashedFile;
    browserHarness: HashedFile;
    outputScanner: HashedFile;
  }>;
  browser: Readonly<{ target: string; packagedReplay: string }>;
  csp: Readonly<{ positive: string; controlledNegative: string }>;
  sideChannel: Readonly<{ review: string; timingSafeProofComparison: string }>;
  output: Readonly<{
    productionEntry: string;
    inventoryManifest: string;
    forbidden: readonly string[];
  }>;
  replays: Readonly<{
    legacy: Readonly<{ disposition: string }>;
    current: Readonly<{ disposition: string }>;
  }>;
  disposition: string;
}>;

const exactKeys = (value: object, keys: readonly string[]) =>
  expect(Object.keys(value).sort()).toEqual([...keys].sort());
const packageDirectory = (item: PackageEvidence): string =>
  path.resolve(
    root,
    "node_modules/.pnpm",
    `${item.name.replace("/", "+")}@${item.version}`,
    "node_modules",
    item.name,
  );
const repositoryUrl = (value: string | { url: string }): string =>
  typeof value === "string" ? value : value.url;

async function loadReport(): Promise<CandidateReport> {
  return JSON.parse(
    await readFile(path.resolve(root, "tests/fixtures/ente/srp-candidate-report.json"), "utf8"),
  ) as CandidateReport;
}
async function verifyGraph(base: string, graph: readonly HashedFile[]): Promise<void> {
  for (const item of graph)
    expect(sha256(await readFile(path.resolve(base, item.path))), item.path).toBe(item.sha256);
}

describe("non-waivable executable Ente SRP candidate gate", () => {
  it("derives fresh replay, browser, CSP and final dispositions from bound evidence", async () => {
    const report = await loadReport();
    exactKeys(report, [
      "schemaVersion",
      "protocolPin",
      "candidate",
      "transitiveGraph",
      "sourceGraph",
      "compatibilityGraph",
      "browser",
      "csp",
      "sideChannel",
      "output",
      "replays",
      "disposition",
      "evidence",
    ]);
    expect(report.schemaVersion).toBe(1);
    expect(report.protocolPin).toBe("c69dcf66704ad7ec1f95e32920455be429a566ef");
    for (const evidence of Object.values(report.evidence))
      expect(sha256(await readFile(path.resolve(root, evidence.path))), evidence.path).toBe(
        evidence.sha256,
      );
    const evidence = report.evidence;
    expect(report.replays.legacy.disposition).toBe(
      derived(evidence.reference.sha256, evidence.candidate.sha256, evidence.legacy.sha256),
    );
    expect(report.replays.current.disposition).toBe(
      derived(evidence.reference.sha256, evidence.candidate.sha256, evidence.current.sha256),
    );
    expect(report.browser).toEqual({
      target: "chrome110",
      packagedReplay: derived(
        evidence.browserHarness.sha256,
        evidence.legacy.sha256,
        evidence.current.sha256,
      ),
    });
    expect(report.csp).toEqual({
      positive: derived(evidence.browserHarness.sha256),
      controlledNegative: derived(evidence.browserHarness.sha256, "controlled-negative"),
    });
    expect(report.disposition).toBe(
      derived(
        report.replays.legacy.disposition,
        report.replays.current.disposition,
        report.browser.packagedReplay,
        report.csp.positive,
        report.csp.controlledNegative,
        evidence.outputScanner.sha256,
      ),
    );
  });

  it("derives the complete runtime graph from installed metadata and lock evidence", async () => {
    const report = await loadReport();
    const lock = await readFile(path.resolve(root, "pnpm-lock.yaml"), "utf8");
    expect(report.transitiveGraph.map(({ name }) => name)).toEqual([
      "fast-srp-hap",
      "buffer",
      "base64-js",
      "ieee754",
      "@noble/hashes",
    ]);
    for (const item of report.transitiveGraph) {
      const directory = packageDirectory(item);
      const packageBytes = await readFile(path.resolve(directory, "package.json"));
      const metadata = JSON.parse(packageBytes.toString()) as {
        name: string;
        version: string;
        license: string;
        repository: string | { url: string };
        dependencies?: Record<string, string>;
      };
      expect(item).toMatchObject({
        name: metadata.name,
        version: metadata.version,
        license: metadata.license,
        repository: repositoryUrl(metadata.repository),
        packageJsonSha256: sha256(packageBytes),
      });
      expect(lock).toContain(`${item.name}@${item.version}`);
      expect(lock).toContain(item.integrity);
      expect(sha256(await readFile(path.resolve(directory, item.licenseFile)))).toBe(
        item.licenseSha256,
      );
      await verifyGraph(directory, item.sourceGraph);
      const installedEdges = Object.keys(metadata.dependencies ?? {}).map((name) => {
        const resolved = report.transitiveGraph.find((candidate) => candidate.name === name);
        expect(resolved, `missing installed edge ${item.name} -> ${name}`).toBeDefined();
        return `${name}@${resolved?.version}`;
      });
      expect(item.dependencies).toEqual(installedEdges);
    }
    const installedCandidate = report.transitiveGraph[0];
    expect(installedCandidate).toBeDefined();
    if (!installedCandidate) throw new Error("candidate graph missing");
    expect(report.candidate).toMatchObject({
      name: installedCandidate.name,
      version: installedCandidate.version,
      integrity: installedCandidate.integrity,
      license: installedCandidate.license,
      repository: installedCandidate.repository,
      packageJsonSha256: installedCandidate.packageJsonSha256,
      licenseSha256: installedCandidate.licenseSha256,
    });
    expect(report.candidate.repository).toBe("https://github.com/homebridge/fast-srp");
    await verifyGraph(packageDirectory(installedCandidate), report.sourceGraph);
    await verifyGraph(
      path.resolve(root, "apps/extension/src/background/ente/srp-compat"),
      report.compatibilityGraph,
    );
  });

  it("binds and validates production output inventory and scanner", async () => {
    const report = await loadReport();
    expect(report.evidence.outputScanner.path).toBe("scripts/scan-build.mjs");
    const production = JSON.parse(
      await readFile(path.resolve(root, report.output.inventoryManifest), "utf8"),
    ) as { entry: string; files: HashedFile[]; constraints: Record<string, boolean> };
    expect(production.entry).toMatch(/^assets\/ente-srp-worker-entry-[\w-]+\.js$/u);
    expect(production.files.length).toBeGreaterThanOrEqual(1);
    for (const item of production.files)
      expect(sha256(await readFile(path.resolve(root, "dist", item.path)))).toBe(item.sha256);
    expect(Object.values(production.constraints).every((value) => value === true)).toBe(true);
  });
});
