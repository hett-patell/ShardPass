import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const output = path.resolve(root, ".test-dist/ente-srp-extension");
// The production build runs into a scratch folder, never into dist/: a test that emptied the
// real output and then timed out under load left the loadable extension gone.
const productionOutput = await mkdtemp(path.join(tmpdir(), "shardpass-production-graph-"));
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
let built = false;

async function emittedJavaScript(): Promise<ReadonlyArray<readonly [string, string]>> {
  if (!built) {
    await promisify(execFile)("pnpm", ["build:test:ente-srp"], { cwd: root });
    built = true;
  }
  const assets = path.join(output, "assets");
  return Promise.all(
    (await readdir(assets))
      .filter((name) => name.endsWith(".js"))
      .sort()
      .map(async (name) => [name, await readFile(path.join(assets, name), "utf8")] as const),
  );
}

afterAll(async () => {
  await rm(productionOutput, { recursive: true, force: true });
});

describe("isolated Ente SRP emitted graph policy", () => {
  it("has only the exact worker graph and records deterministic content hashes", async () => {
    const files = await emittedJavaScript();
    expect(files.map(([name]) => name)).toEqual([
      expect.stringMatching(/^ente-srp-runner-[\w-]+\.js$/u),
      expect.stringMatching(/^ente-srp-worker-[\w-]+\.js$/u),
      expect.stringMatching(/^enteSrpTest-[\w-]+\.js$/u),
      expect.stringMatching(/^worker\.ts-[\w-]+\.js$/u),
    ]);
    const inventory = files.map(([name, source]) => ({
      logicalName: name.replace(/-[\w-]+\.js$/u, ".js"),
      sha256: sha256(source),
      size: Buffer.byteLength(source),
    }));
    expect(inventory).toHaveLength(4);
    expect(new Set(inventory.map(({ sha256: digest }) => digest)).size).toBe(4);
  });

  it("rejects random, network, eval, remote, and unexpected runtime compatibility", async () => {
    const files = await emittedJavaScript();
    const source = files.map(([, value]) => value).join("\n");
    expect(source).not.toMatch(
      /randomBytes|XMLHttpRequest|WebSocket|EventSource|fetch\(|importScripts|eval\(|new Function|https?:\/\/|wss?:\/\//u,
    );
    expect(source).not.toMatch(/createHash\(["'](?!sha256)/u);
    expect(source).not.toMatch(/\brequire\s*\(\s*[^"']/u);
    expect(source.match(/\.getRandomValues\(/gu)).toHaveLength(1);
  });

  it("binds the audited shared plugin to the actual production graph and exact hashes", async () => {
    await promisify(execFile)("pnpm", ["exec", "vite", "build"], {
      cwd: root,
      env: { ...process.env, SHARDPASS_OUT_DIR: productionOutput },
    });
    await promisify(execFile)(process.execPath, ["scripts/inventory-ente-production-graph.mjs", productionOutput], { cwd: root });
    const manifest = JSON.parse(
      await readFile(path.resolve(productionOutput, ".ente-srp-production-graph.json"), "utf8"),
    ) as {
      entry: string;
      files: Array<{ path: string; sha256: string }>;
      constraints: Record<string, boolean>;
    };
    expect(manifest.entry).toMatch(/^assets\/ente-srp-worker-entry-[\w-]+\.js$/u);
    expect(Object.values(manifest.constraints).every(Boolean)).toBe(true);
    for (const file of manifest.files) {
      const source = await readFile(path.resolve(productionOutput, file.path), "utf8");
      expect(sha256(source)).toBe(file.sha256);
      expect(source).not.toMatch(
        /randomBytes|__vite-browser-external|node:buffer|fetch\(|WebSocket|EventSource|clientPrivateHex|expectedM1Hex|expectedM2Hex/u,
      );
    }
    const production = await readFile(path.resolve(root, "vite.config.ts"), "utf8");
    const harness = await readFile(
      path.resolve(root, "tests/crypto-extension/vite.srp.config.ts"),
      "utf8",
    );
    expect(production).toContain("enteSrpVitePlugin");
    expect(harness).toContain("enteSrpVitePlugin");
  }, 30_000);
});
