import { rm } from "node:fs/promises";

import { build } from "vite";
import { afterAll, describe, expect, it } from "vitest";

const extensionRoot = new URL("../../", import.meta.url);
const outputDirectory = new URL("../../.test-vault-build/", import.meta.url);

async function buildVaultCss(): Promise<string> {
  const result = await build({
    root: extensionRoot.pathname,
    logLevel: "silent",
    build: {
      cssMinify: false,
      emptyOutDir: true,
      lib: {
        entry: new URL("../../src/vault/VaultApp.tsx", import.meta.url).pathname,
        formats: ["es"],
      },
      minify: false,
      outDir: outputDirectory.pathname,
      target: "chrome110",
      write: false,
    },
  });
  const builds = Array.isArray(result) ? result : [result];

  return builds
    .flatMap((item) => {
      if (!("output" in item)) {
        throw new Error("Expected a completed Vite build output.");
      }
      return item.output;
    })
    .filter((output) => output.type === "asset" && output.fileName.endsWith(".css"))
    .map((output) => (output.type === "asset" ? String(output.source) : ""))
    .join("\n");
}

function localClass(name: string): RegExp {
  return new RegExp(`\\.(_[\\w-]*${name}[\\w-]*|${name}[\\w-]*)`);
}

afterAll(async () => {
  await rm(outputDirectory, { force: true, recursive: true });
});

describe("emitted vault CSS contracts", () => {
  it("emits distinct local explanation classes without literal ID selectors", async () => {
    const css = await buildVaultCss();

    expect(css).toMatch(localClass("searchAvailability"));
    expect(css).toMatch(localClass("createAvailability"));
    expect(css).not.toMatch(/#search-availability\b|#create-availability\b/);
    expect(css).not.toMatch(/(?:searchAvailability|createAvailability)[^}]*display:\s*none/s);
  }, 15_000);

  it("emits exact bounded OTP virtual-row geometry and internal truncation", async () => {
    const css = await buildVaultCss();
    const itemRule = css.match(/\.[\w-]*_item_[\w-]*\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";

    expect(itemRule).toMatch(/height:\s*54px/);
    expect(itemRule).toMatch(/min-height:\s*54px/);
    expect(itemRule).toMatch(/box-sizing:\s*border-box/);
    expect(itemRule).toMatch(/overflow:\s*hidden/);
    expect(css).toMatch(/itemCopy[^}]*min-width:\s*0/s);
    expect(css).toMatch(/itemCopy[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(/itemCopy[^}]*text-overflow:\s*ellipsis/s);
    expect(Number(itemRule.match(/min-height:\s*(\d+)px/)?.[1])).toBeGreaterThanOrEqual(44);
  }, 15_000);

  it("emits explicit non-overlapping group placement at desktop and both responsive thresholds", async () => {
    const css = await buildVaultCss();

    expect(css).toMatch(/searchGroup[^}]*grid-column:\s*1\s*\/\s*3/s);
    expect(css).toMatch(/createGroup[^}]*grid-column:\s*3/s);
    expect(css).toMatch(
      /@media\s*\(max-width:\s*980px\)[\s\S]*searchGroup[^}]*grid-column:\s*1[\s\S]*createGroup[^}]*grid-column:\s*2/,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*760px\)[\s\S]*searchGroup[^}]*grid-column:\s*1[\s\S]*createGroup[^}]*grid-column:\s*1/,
    );
    expect(css).toMatch(/(?:searchAvailability|createAvailability)[^}]*overflow-wrap:\s*anywhere/s);
  }, 15_000);
});
