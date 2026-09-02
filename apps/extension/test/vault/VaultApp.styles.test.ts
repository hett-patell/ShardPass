import { readFile, rm } from "node:fs/promises";
import path from "node:path";

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

// Stylesheets this task (vault redesign) owns and is responsible for keeping free of
// unsupported Chrome 110-only syntax. Other vault stylesheets (backup/migration/ente
// settings panels) predate this task and are out of scope here.
const OWNED_STYLESHEETS = [
  "src/vault/VaultApp.module.css",
  "src/vault/otp/OtpVaultView.module.css",
  "src/vault/components/EmptyVaultState.module.css",
  "src/vault/components/EmptyDetailState.module.css",
  "src/vault/components/ItemListPanel.module.css",
  "src/vault/components/VaultSidebar.module.css",
  "src/vault/components/NewItemMenu.module.css",
  "src/vault/components/PasswordGeneratorDialog.module.css",
  "src/vault/components/detail/Detail.module.css",
  "src/vault/components/forms/Form.module.css",
];

afterAll(async () => {
  await rm(outputDirectory, { force: true, recursive: true });
});

describe("emitted vault CSS contracts", () => {
  it("emits a three-column sidebar/list/detail grid at desktop widths", async () => {
    const css = await buildVaultCss();

    expect(css).toMatch(localClass("vault"));
    expect(css).toMatch(
      /\.[\w-]*vault[\w-]*\s*\{[^}]*grid-template-columns:\s*[^;]+\s+[^;]+\s+minmax\([^;]+\)/s,
    );
  }, 20_000);

  it("collapses the three-panel grid to a single column at a compact breakpoint", async () => {
    const css = await buildVaultCss();

    expect(css).toMatch(
      /@media\s*\(max-width:\s*760px\)[\s\S]*\.[\w-]*vault[\w-]*\s*\{[^}]*grid-template-columns:\s*1fr/,
    );
  }, 20_000);

  it("respects prefers-reduced-motion in the emitted bundle", async () => {
    const css = await buildVaultCss();

    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  }, 20_000);

  it("keeps a full-viewport document per the VaultApp.module.css source", async () => {
    const extensionRoot = path.resolve(process.cwd(), "apps/extension");
    const css = await readFile(path.join(extensionRoot, "src/vault/VaultApp.module.css"), "utf8");

    expect(css).toMatch(/:global\(\.vaultDocument\)[\s\S]*min-height:\s*100%/);
    expect(css).toMatch(/:global\(\.vaultBody\)[\s\S]*min-height:\s*100vh/);
    expect(css).toMatch(/:global\(\.vaultRoot\)[\s\S]*min-height:\s*100vh/);
    expect(css).not.toMatch(/(?:linear|radial|conic)-gradient/);
  });

  it("avoids unsupported Chrome 110-only CSS syntax in every stylesheet this task owns", async () => {
    const extensionRoot = path.resolve(process.cwd(), "apps/extension");
    const sources = await Promise.all(
      OWNED_STYLESHEETS.map((relativePath) => readFile(path.join(extensionRoot, relativePath), "utf8")),
    );

    for (const [index, css] of sources.entries()) {
      expect(css, OWNED_STYLESHEETS[index]).not.toMatch(
        /color-mix\(|light-dark\(|oklch\(|@starting-style|transition-behavior|field-sizing/,
      );
    }
  });
});
