import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findExecutablePolicyViolations } from "../../../tools/security/executable-policy";
import { verifyApprovedSodiumIdentity } from "../../../scripts/ente-sodium-wasm-inventory.mjs";
import { assertProductionCsp } from "../csp.test";

const root = new URL("../../../", import.meta.url);

describe("built extension executable security", () => {
  it("keeps the production manifest CSP self-only", async () => {
    const builtManifest = JSON.parse(
      await readFile(new URL("dist/manifest.json", root), "utf8"),
    ) as Record<string, unknown>;

    assertProductionCsp(builtManifest);
  });

  it("contains no crypto smoke or benchmark test material", async () => {
    const forbidden = [
      "crypto-smoke",
      "__shardpassRunDefaultArgon2idBenchmark",
      "ShardPass browser benchmark",
      "runDefaultArgon2idBenchmark",
    ];
    const dist = new URL("dist/", root).pathname;
    const entries = await readdir(dist, { recursive: true, withFileTypes: true });
    const text = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && /\.(?:html|js|json|mjs)$/u.test(entry.name))
        .map((entry) => readFile(path.join(entry.parentPath, entry.name), "utf8")),
    );
    expect(forbidden.every((needle) => text.every((source) => !source.includes(needle)))).toBe(
      true,
    );
  });

  it("recursively rejects dynamic generation, inline code, remote code, and legacy imports", async () => {
    const dist = new URL("dist/", root).pathname;
    const assets = await readdir(path.join(dist, "assets"));
    const workers: string[] = [];
    for (const filename of assets) {
      if (!filename.endsWith(".js")) continue;
      const source = await readFile(path.join(dist, "assets", filename), "utf8");
      if (source.includes("@bufbuild/protobuf/text-encoding")) workers.push(`assets/${filename}`);
    }
    expect(workers).toHaveLength(1);
    expect(workers[0]).toMatch(/^assets\/google-migration-worker-entry-[A-Za-z0-9_-]+\.js$/u);
    const vaultFiles = assets.filter((filename) => /^vault-[A-Za-z0-9_-]+\.js$/u.test(filename));
    expect(vaultFiles).toHaveLength(1);
    const vaultSource = await readFile(path.join(dist, "assets", vaultFiles[0]!), "utf8");
    expect(vaultSource).toContain(`/${workers[0]}`);
    const violations = await findExecutablePolicyViolations(dist);
    const approved = JSON.parse(
      await readFile(new URL("tests/fixtures/ente/sodium-wasm-approved.json", root), "utf8"),
    ) as Record<string, unknown>;
    const sodiumFile = assets.find((file) => file.includes("libsodium-wrappers-"));
    expect(sodiumFile).toBeDefined();
    const sodiumSource = await readFile(path.join(dist, "assets", sodiumFile!), "utf8");
    expect(() => verifyApprovedSodiumIdentity(sodiumSource, approved, "packaged")).not.toThrow();
    // The vault KDF worker derives through that same module: one libsodium copy, one identity.
    const kdfWorkerSource = await readFile(
      path.join(dist, "assets", "kdf-worker-entry.js"),
      "utf8",
    );
    expect(kdfWorkerSource).toMatch(/\.\/libsodium-wrappers-[\w-]+\.js/u);
    expect(kdfWorkerSource).not.toContain("AGFzbQE");
    expect(violations.map(({ rule }) => rule)).toEqual([
      "network-destination",
      "network-destination",
      "network-destination",
    ]);
    expect(violations.map(({ file }) => file).sort()).toEqual([
      expect.stringMatching(/^assets\/ente-auth-worker-entry/u),
      expect.stringMatching(/^assets\/libsodium-wrappers-/u),
      expect.stringMatching(/^assets\/main\.ts-/u),
    ]);
  }, 15_000);
});
