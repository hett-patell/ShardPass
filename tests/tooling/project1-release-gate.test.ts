import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runProject1ReleaseGate } from "../../scripts/verify-project1-release.mjs";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

function baseOptions(root: string) {
  return {
    mode: "release" as const,
    nodeVersion: "v22.14.0",
    pnpmVersion: "10.14.0",
    chromeVersion: "110.0.1",
    sourceRoot: root,
    inputManifestPath: path.join(root, "inputs.json"),
    testManifestPath: path.join(root, "tests.json"),
    outputRoot: path.join(root, "evidence"),
    registryOrigin: "https://registry.npmjs.org/",
    mockOrigin: "http://127.0.0.1:1234",
    networkAdapter: {
      capability: "os-network-isolation-v1" as const,
      name: "fixture",
      run: () => Promise.reject(new Error("must not run")),
    },
    chromeEvidencePath: path.join(root, "chrome.json"),
    finalEvidencePath: path.join(root, "final.json"),
    trustStorePath: path.join(root, "trust.json"),
    runBuild: () => Promise.reject(new Error("must not build")),
    runDeterministicBuild: () => Promise.reject(new Error("must not rebuild")),
  };
}

describe("Project 1 release gate preconditions", () => {
  it("separates exact release and development runtimes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "p1-gate-test-"));
    roots.push(root);
    await expect(
      runProject1ReleaseGate({ ...baseOptions(root), nodeVersion: "v24.18.0" }),
    ).rejects.toThrow("RELEASE_NODE22_REQUIRED");
    await expect(
      runProject1ReleaseGate({
        ...baseOptions(root),
        mode: "development",
        nodeVersion: "v24.18.0",
        chromeVersion: "110.0.1",
      }),
    ).rejects.toThrow("DEVELOPMENT_CHROMIUM151_REQUIRED");
  });

  it("rejects malformed or renamed checked step manifests before copying", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "p1-gate-test-"));
    roots.push(root);
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "tests.json"), '{"schemaVersion":1,"steps":[]}');
    await expect(runProject1ReleaseGate(baseOptions(root))).rejects.toThrow(
      "RELEASE_TEST_MANIFEST_INVALID",
    );
  });
});
