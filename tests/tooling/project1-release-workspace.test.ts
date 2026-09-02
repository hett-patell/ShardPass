import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseReleaseInputManifest,
  createDisposableWorkspace,
  assertWorkspaceUnchanged,
  cleanupDisposableWorkspace,
  createIndependentRebuildWorkspace,
  runFrozenBootstrap,
} from "../../scripts/project1-release-workspace.mjs";
const roots: string[] = [];
async function temp() {
  const value = await mkdtemp(path.join(tmpdir(), "p1-workspace-test-"));
  roots.push(value);
  return value;
}
afterEach(async () =>
  Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true }))),
);
const manifest =
  '{"schemaVersion":2,"allowedTopLevel":["dist","inputs.json","node_modules","package.json","pnpm-lock.yaml","src"],"includes":["package.json","pnpm-lock.yaml","src"],"excludes":["dist","inputs.json","node_modules"]}';
async function fixture() {
  delete process.env.NODE_PATH;
  const source = await temp();
  await mkdir(path.join(source, "src"));
  await writeFile(path.join(source, "src/a.ts"), "export {};\n");
  await writeFile(path.join(source, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await writeFile(
    path.join(source, "package.json"),
    JSON.stringify({
      packageManager: "pnpm@10.14.0",
      engines: { node: ">=22.14.0 <23", pnpm: "10.14.0" },
    }),
  );
  const manifestPath = path.join(source, "inputs.json");
  await writeFile(manifestPath, manifest);
  return { source, manifestPath };
}
describe("Project 1 release workspace", () => {
  it("parses only canonical sorted exact manifests", () => {
    expect(parseReleaseInputManifest(manifest).includes).toEqual([
      "package.json",
      "pnpm-lock.yaml",
      "src",
    ]);
    expect(() => parseReleaseInputManifest(`${manifest}\n`)).toThrow();
    expect(() =>
      parseReleaseInputManifest(
        '{"schemaVersion":2,"allowedTopLevel":["a","dist","src"],"includes":["src","a"],"excludes":["dist"]}',
      ),
    ).toThrow();
  });
  it("rejects unexpected root entries and omitted package-manager/release inputs", async () => {
    const value = await fixture();
    await writeFile(path.join(value.source, "credential.pem"), "secret");
    await expect(
      createDisposableWorkspace({ sourceRoot: value.source, manifestPath: value.manifestPath }),
    ).rejects.toThrow("RELEASE_INPUT_UNEXPECTED_TOP_LEVEL");

    await rm(path.join(value.source, "credential.pem"));
    for (const required of ["package.json", "pnpm-lock.yaml"]) {
      const malformed = JSON.parse(manifest) as {
        schemaVersion: number;
        allowedTopLevel: string[];
        includes: string[];
        excludes: string[];
      };
      malformed.includes = malformed.includes.filter((entry) => entry !== required);
      await writeFile(value.manifestPath, JSON.stringify(malformed));
      await expect(
        createDisposableWorkspace({ sourceRoot: value.source, manifestPath: value.manifestPath }),
      ).rejects.toThrow("RELEASE_INPUT_REQUIRED_OMITTED");
    }
  });

  it("requires pnpm workspace/catalog, npm config, patches, and configs when present", async () => {
    const value = await fixture();
    for (const name of [".npmrc", "pnpm-workspace.yaml", "patches", "vite.config.ts"]) {
      const target = path.join(value.source, name);
      if (name === "patches") await mkdir(target);
      else await writeFile(target, "fixture\n");
      await expect(
        createDisposableWorkspace({ sourceRoot: value.source, manifestPath: value.manifestPath }),
      ).rejects.toThrow("RELEASE_INPUT_UNEXPECTED_TOP_LEVEL");
      await rm(target, { recursive: true });
    }
  });

  it("copies exact regular files, records individual hashes, snapshots mutation, and cleans", async () => {
    const value = await fixture();
    const workspace = await createDisposableWorkspace({
      sourceRoot: value.source,
      manifestPath: value.manifestPath,
    });
    expect(await readFile(path.join(workspace.root, "src/a.ts"), "utf8")).toBe("export {};\n");
    const sourceHash = workspace.fileHashes.find((entry) => entry.path === "src/a.ts");
    expect(sourceHash?.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(workspace.storeIdentity).toMatch(/^[a-f0-9]{64}$/u);
    await assertWorkspaceUnchanged(workspace);
    await writeFile(path.join(workspace.root, "src/a.ts"), "changed");
    await expect(assertWorkspaceUnchanged(workspace)).rejects.toThrow("RELEASE_WORKSPACE_MUTATED");
    await cleanupDisposableWorkspace(workspace);
  });
  it("rejects symlink inputs and ambient NODE_PATH", async () => {
    const value = await fixture();
    await symlink("a.ts", path.join(value.source, "src/link.ts"));
    await expect(
      createDisposableWorkspace({ sourceRoot: value.source, manifestPath: value.manifestPath }),
    ).rejects.toThrow("RELEASE_INPUT_NONREGULAR");
    const prior = process.env.NODE_PATH;
    process.env.NODE_PATH = "/tmp/global";
    try {
      await expect(
        createDisposableWorkspace({ sourceRoot: value.source, manifestPath: value.manifestPath }),
      ).rejects.toThrow("AMBIENT_NODE_PATH_FORBIDDEN");
    } finally {
      if (prior === undefined) delete process.env.NODE_PATH;
      else process.env.NODE_PATH = prior;
    }
  });
  it("creates an independent second workspace from the same source and frozen store", async () => {
    const value = await fixture();
    const first = await createDisposableWorkspace({
      sourceRoot: value.source,
      manifestPath: value.manifestPath,
    });
    const second = await createIndependentRebuildWorkspace({
      firstWorkspace: first,
      sourceRoot: value.source,
      manifestPath: value.manifestPath,
    });
    expect(second.root).not.toBe(first.root);
    expect(second.parent).not.toBe(first.parent);
    expect(second.storeDirectory).toBe(first.storeDirectory);
    expect(second.sourceSnapshotSha256).toBe(first.sourceSnapshotSha256);
    await writeFile(path.join(value.source, "src/a.ts"), "mutated\n");
    await expect(
      createIndependentRebuildWorkspace({
        firstWorkspace: first,
        sourceRoot: value.source,
        manifestPath: value.manifestPath,
      }),
    ).rejects.toThrow("RELEASE_REBUILD_SOURCE_MISMATCH");
    await cleanupDisposableWorkspace(second);
    await cleanupDisposableWorkspace(first);
  });

  it("uses exact frozen bootstrap and rejects wrong tools", async () => {
    const value = await fixture();
    const workspace = await createDisposableWorkspace({
      sourceRoot: value.source,
      manifestPath: value.manifestPath,
    });
    const calls: string[] = [];
    const runCommand = (command: string, args: readonly string[]) => {
      calls.push(`${command} ${args.join(" ")}`);
      if (args[0] === "--version")
        return Promise.resolve(Buffer.from(command.includes("node") ? "v22.14.0\n" : "10.14.0\n"));
      return Promise.resolve(Buffer.from("installed"));
    };
    const evidence = await runFrozenBootstrap(workspace, {
      registryOrigin: "https://registry.npmjs.org/",
      runCommand,
    });
    expect(evidence.status).toBe("PASS");
    expect(calls.at(-1)).toContain("install --frozen-lockfile");
    await expect(
      runFrozenBootstrap(workspace, { registryOrigin: "http://registry.npmjs.org/", runCommand }),
    ).rejects.toThrow("BOOTSTRAP_REGISTRY_INVALID");
    await cleanupDisposableWorkspace(workspace);
  });
});
