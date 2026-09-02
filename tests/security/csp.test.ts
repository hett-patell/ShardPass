import { describe, expect, it } from "vitest";

import manifest from "../../apps/extension/src/manifest";

export const productionCsp =
  "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' https://api.ente.io; img-src 'self' data:; media-src 'self'; font-src 'self'; style-src 'self'";

export function assertProductionCsp(candidate: Record<string, unknown>): void {
  expect(candidate.content_security_policy).toEqual({ extension_pages: productionCsp });
  expect(JSON.stringify(candidate)).not.toMatch(/(?:^|[ '])'unsafe-eval'(?:[ ';]|$)/u);
  expect(JSON.stringify(candidate).match(/wasm-unsafe-eval/gu)).toHaveLength(1);
  expect(JSON.stringify(candidate).match(/https:\/\/api\.ente\.io/gu)).toHaveLength(2);
}

describe("extension source content security policy", () => {
  it("keeps the source policy fixed to the approved Ente authority", () => {
    assertProductionCsp(manifest as unknown as Record<string, unknown>);
    expect(productionCsp).toContain("connect-src 'self' https://api.ente.io");
    expect(productionCsp).not.toMatch(/wss?:|blob:|data:application/u);
  });

  it("keeps owner-approved libsodium WASM authority exact in production and the harness", async () => {
    expect(productionCsp).toContain("wasm-unsafe-eval");
    const harness = await import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("../crypto-extension/manifest.ts", import.meta.url), "utf8"),
    );
    expect(harness).toContain(
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self'",
    );
    expect(harness).not.toMatch(/(?:^|[ '])'unsafe-eval'(?:[ ';]|$)/u);
    expect(harness).not.toMatch(/https?:|blob:|data:application/u);
  });
});
