import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);

async function cssFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const candidate = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await cssFiles(candidate)));
    else if (entry.isFile() && extname(entry.name) === ".css") files.push(candidate);
  }
  return files;
}

function unguardedTextWrap(css: string): boolean {
  let depth = 0;
  const supportDepths: number[] = [];
  for (const token of css.matchAll(/@supports\s*[^{]*\{|\{|\}|\btext-wrap\s*:/giu)) {
    const value = token[0];
    if (value.startsWith("@supports")) {
      depth += 1;
      supportDepths.push(depth);
    } else if (value === "{") {
      depth += 1;
    } else if (value === "}") {
      if (supportDepths.at(-1) === depth) supportDepths.pop();
      depth -= 1;
    } else if (supportDepths.length === 0) {
      return true;
    }
  }
  return false;
}

describe("Chrome 110 CSS compatibility policy", () => {
  it("sets the production Vite target explicitly", async () => {
    const config = await readFile(new URL("vite.config.ts", root), "utf8");
    expect(config).toMatch(/build:\s*\{[\s\S]*?target:\s*["']chrome110["']/u);
  });

  it.each([
    ["application and UI source", ["apps/extension/src", "packages/ui/src"]],
    ["final built CSS", ["dist"]],
  ])("rejects unguarded unsupported text wrapping in %s", async (_label, directories) => {
    const files = (
      await Promise.all(directories.map((directory) => cssFiles(new URL(directory, root).pathname)))
    ).flat();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const css = await readFile(file, "utf8");
      expect(unguardedTextWrap(css), file).toBe(false);
    }
  });

  it("provides baseline wrapping wherever progressive text-wrap is used", async () => {
    const files = await cssFiles(new URL("apps/extension/src", root).pathname);
    for (const file of files) {
      const css = await readFile(file, "utf8");
      if (/\btext-wrap\s*:/iu.test(css)) {
        expect(css, file).toMatch(/white-space:\s*normal/iu);
        expect(css, file).toMatch(/overflow-wrap:\s*anywhere/iu);
      }
    }
  });
});
