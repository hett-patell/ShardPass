import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url).pathname;

type Pinned = Readonly<{
  schemaVersion: number;
  allowedLicenses: readonly string[];
  dependencies: readonly Readonly<{ name: string; license: string; why: string }>[];
}>;

type PackageJson = Readonly<{
  name?: string;
  license?: string;
  dependencies?: Readonly<Record<string, string>>;
}>;

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

/** Every workspace package that ships code, with the external packages it declares. */
async function workspaceDependencies(): Promise<Map<string, { by: string; dir: string }[]>> {
  const { glob } = await import("node:fs/promises");
  const found = new Map<string, { by: string; dir: string }[]>();
  for await (const entry of glob(["apps/*/package.json", "packages/*/package.json"], {
    cwd: root,
  })) {
    const manifest = await readJson<PackageJson>(path.join(root, entry));
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      if (name.startsWith("@shardpass/")) continue;
      found.set(name, [
        ...(found.get(name) ?? []),
        { by: manifest.name ?? entry, dir: path.dirname(path.join(root, entry)) },
      ]);
    }
  }
  return found;
}

/**
 * The installed package's own manifest, read through the link pnpm puts in the declaring
 * package's node_modules. Resolution by specifier does not work: a package may forbid
 * `require("name/package.json")` through its exports map.
 */
async function installedLicense(
  name: string,
  declaredBy: readonly { by: string; dir: string }[],
): Promise<string> {
  for (const { dir } of [...declaredBy, { by: "", dir: root }]) {
    const manifestPath = path.join(dir, "node_modules", name, "package.json");
    try {
      const manifest = await readJson<PackageJson>(manifestPath);
      if (typeof manifest.license === "string") return manifest.license;
    } catch {
      // Not linked here; try the next declaring package.
    }
  }
  throw new Error(
    `${name} (declared by ${declaredBy.map((entry) => entry.by).join(", ")}) is not installed`,
  );
}

describe("runtime dependencies", () => {
  it("ships exactly the pinned set, each with a stated reason", async () => {
    const pinned = await readJson<Pinned>(path.join(root, "config/runtime-dependencies.json"));
    const declared = await workspaceDependencies();
    expect([...declared.keys()].sort()).toEqual(pinned.dependencies.map(({ name }) => name).sort());
    for (const entry of pinned.dependencies)
      expect(entry.why.length, `${entry.name} needs a reason`).toBeGreaterThan(12);
  });

  it("carries no licence that a MIT-licensed extension may not redistribute", async () => {
    const pinned = await readJson<Pinned>(path.join(root, "config/runtime-dependencies.json"));
    const allowed = new Set(pinned.allowedLicenses);
    // Nothing copyleft: ShardPass is MIT, and a GPL/AGPL dependency would change what the
    // whole extension may be distributed under.
    for (const license of allowed) expect(license).not.toMatch(/GPL|SSPL|CC-BY-NC|proprietary/iu);
    const declared = await workspaceDependencies();
    for (const [name, by] of declared) {
      const license = await installedLicense(name, by);
      const entry = pinned.dependencies.find((candidate) => candidate.name === name);
      expect(entry, `${name} is installed but not pinned`).toBeDefined();
      expect(license, `${name} changed licence`).toBe(entry?.license);
      expect(allowed.has(license), `${name} is ${license}`).toBe(true);
    }
  });
});
