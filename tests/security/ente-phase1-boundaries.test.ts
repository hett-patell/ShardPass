import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

async function files(directory: string): Promise<string[]> {
  const output: string[] = [];
  for (const name of await readdir(directory)) {
    const value = path.resolve(directory, name);
    if ((await stat(value)).isDirectory()) output.push(...(await files(value)));
    else output.push(value);
  }
  return output;
}

describe("Task12 Phase1 production/tooling boundaries", () => {
  it("keeps deterministic constructors, generators, vectors and tests out of production source imports", async () => {
    const productionRoot = path.resolve(root, "apps/extension/src");
    const sources = await files(productionRoot);
    expect(sources).not.toContain(
      path.resolve(productionRoot, "background/ente/srp-client-core.ts"),
    );
    for (const file of sources) {
      const source = await readFile(file, "utf8");
      expect(source, file).not.toMatch(
        /ForTestOnly|DeterministicEnte|boxSeedKeypair|crypto_box_seed_keypair|tests\/|fixtures\/|generate-ente|sodium-wire-vectors|srp-(?:legacy|current)-/u,
      );
    }
  });

  it("keeps the production Ente graph on safe parser and domain import boundaries", async () => {
    const enteRoots = [
      path.resolve(root, "apps/extension/src/background/ente"),
      path.resolve(root, "apps/extension/src/vault/ente"),
    ];
    for (const directory of enteRoots) {
      for (const file of await files(directory)) {
        const source = await readFile(file, "utf8");
        expect(source, file).not.toMatch(/from\s+["']zod["']/u);
      }
    }
    const repository = await readFile(
      path.resolve(root, "apps/extension/src/background/ente/session-cycle-repository.ts"),
      "utf8",
    );
    expect(repository).toContain('import type { OtpItem } from "@shardpass/domain"');
    expect(repository).not.toContain("OtpItemSchema");
    const dependencyPolicy = await readFile(
      path.resolve(root, "dependency-cruiser.config.cjs"),
      "utf8",
    );
    expect(dependencyPolicy).toContain('name: "ente-production-cannot-import-full-zod"');
    expect(dependencyPolicy).toContain('to: { path: "^zod$" }');
  });

  it("keeps production SRP compatibility aliases in the audited shared build plugin only", async () => {
    const plugin = await readFile(path.resolve(root, "tools/ente-srp-vite-plugin.ts"), "utf8");
    const production = await readFile(path.resolve(root, "vite.config.ts"), "utf8");
    const harness = await readFile(
      path.resolve(root, "tests/crypto-extension/vite.srp.config.ts"),
      "utf8",
    );
    expect(plugin).toContain("shardpass-scoped-ente-srp");
    expect(production).toContain("enteSrpVitePlugin");
    expect(harness).toContain("enteSrpVitePlugin");
    for (const source of [production, harness])
      expect(source).not.toMatch(/find:\s*\/\^(?:node:buffer|buffer|crypto|assert)/u);
  });
});
