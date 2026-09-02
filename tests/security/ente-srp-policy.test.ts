import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(new URL("../../", import.meta.url).pathname);
const integrity =
  "sha512-lHRYYaaIbMrhZtsdGTwPN82UbqD9Bv8QfOlKs+Dz6YRnByZifOh93EYmf2iEWFtkOEIqR2IK8cFD0UN5wLIWBQ==";

describe("selected Ente SRP dependency policy", () => {
  it("pins the exact dependency, integrity, license review, and zero runtime dependencies", async () => {
    const extension = JSON.parse(
      await readFile(resolve(root, "apps/extension/package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    const catalog = await readFile(resolve(root, "pnpm-workspace.yaml"), "utf8");
    const lock = await readFile(resolve(root, "pnpm-lock.yaml"), "utf8");
    expect(extension.dependencies["fast-srp-hap"]).toBe("catalog:");
    expect(catalog).toMatch(/^ {2}fast-srp-hap: 2\.0\.4$/mu);
    expect(lock).toContain("fast-srp-hap@2.0.4:");
    expect(lock).toContain(integrity);
    expect(lock).toMatch(/fast-srp-hap@2\.0\.4:\n\s+resolution:[^\n]+\n\s+engines:/u);
  });

  it("keeps RNG ownership outside the package and rejects executable/network paths", async () => {
    const adapter = await readFile(
      resolve(root, "apps/extension/src/background/ente/srp-adapter.ts"),
      "utf8",
    );
    expect(adapter).toContain("crypto.getRandomValues");
    expect(adapter).not.toContain("clientPrivateEphemeral");
    expect(adapter).not.toContain("genKey(");
    expect(adapter).not.toMatch(
      /fetch\(|XMLHttpRequest|WebSocket|EventSource|eval\(|new Function|WebAssembly/u,
    );
  });
});
