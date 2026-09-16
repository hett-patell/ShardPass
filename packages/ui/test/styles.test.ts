import { readFile, rm } from "node:fs/promises";
import { build } from "vite";
import { afterAll, describe, expect, it } from "vitest";

const uiRoot = new URL("../", import.meta.url);
const tokensUrl = new URL("../src/styles/tokens.css", import.meta.url);
const primitivesUrl = new URL("../src/primitives/primitives.module.css", import.meta.url);
const outputDirectory = new URL("../.test-build/", import.meta.url);

async function readStyles(): Promise<{ primitives: string; tokens: string }> {
  const [primitives, tokens] = await Promise.all([
    readFile(primitivesUrl, "utf8"),
    readFile(tokensUrl, "utf8"),
  ]);
  return { primitives, tokens };
}

afterAll(async () => {
  await rm(outputDirectory, { force: true, recursive: true });
});

describe("UI CSS contracts", () => {
  it("emits the Button loading text's local visually-hidden CSS module class", async () => {
    const result = await build({
      root: uiRoot.pathname,
      logLevel: "silent",
      build: {
        cssMinify: false,
        emptyOutDir: true,
        lib: {
          entry: new URL("../src/primitives/Button.tsx", import.meta.url).pathname,
          formats: ["es"],
        },
        minify: false,
        outDir: outputDirectory.pathname,
        target: "chrome110",
        write: false,
      },
    });
    const builds = Array.isArray(result) ? result : [result];
    const css = builds
      .flatMap((item) => {
        if (!("output" in item)) {
          throw new Error("Expected a completed Vite build output.");
        }
        return item.output;
      })
      .filter((output) => output.type === "asset" && output.fileName.endsWith(".css"))
      .map((output) => (output.type === "asset" ? String(output.source) : ""))
      .join("\n");

    expect(css).toMatch(/\.(_[\w-]*visuallyHidden[\w-]*|visuallyHidden[\w-]*)\s*\{/);
    expect(css).toContain("clip-path: inset(50%)");
    expect(css).toContain("white-space: nowrap");
  });

  it("defaults to the dark graphite theme and defines the light variant under data-theme", async () => {
    const { tokens } = await readStyles();
    const [defaultBlock, lightBlock] = tokens.split(':root[data-theme="light"]');

    expect(defaultBlock).toContain("color-scheme: dark;");
    expect(defaultBlock).toContain("--bg-primary: #0c0c0d;");
    expect(defaultBlock).toContain("--accent: #ff4d2e;");
    expect(lightBlock).toContain("color-scheme: light;");
    expect(lightBlock).toContain("--bg-primary: #fafafa;");
    // The OS preference is resolved in theme.ts, not by the stylesheet, so a stored choice
    // always wins and every token has exactly one definition per theme.
    expect(tokens).not.toContain("prefers-color-scheme");
  });

  it("defines shadow tokens and an ordered, collision-free stacking scale", async () => {
    const { tokens } = await readStyles();

    for (const role of ["sm", "md"]) {
      expect(tokens).toMatch(new RegExp(`--shadow-${role}:\\s*[^;]+;`));
    }

    const stackRoles = [
      "dropdown",
      "sticky",
      "modal-backdrop",
      "modal",
      "toast",
      "picker",
      "tooltip",
    ];
    const values = stackRoles.map((role) => {
      const match = new RegExp(`--z-${role}:\\s*(\\d+);`).exec(tokens);
      expect(match, `missing --z-${role}`).not.toBeNull();
      return Number(match?.[1]);
    });

    expect(values).toEqual([...values].sort((left, right) => left - right));
    expect(new Set(values).size).toBe(values.length);
  });

  it("uses semantic status tokens for badges and stays within the Chrome 110 CSS policy", async () => {
    const { primitives, tokens } = await readStyles();
    const css = `${tokens}\n${primitives}`;

    for (const status of ["success", "warning", "danger", "info"]) {
      expect(tokens).toMatch(new RegExp(`--${status}:\\s*#[0-9a-f]{6};`, "i"));
      expect(tokens).toMatch(
        new RegExp(`--${status}-subtle:\\s*(#[0-9a-f]{6}|rgba\\([^)]+\\));`, "i"),
      );
    }
    expect(primitives).toContain("color: var(--status-color)");
    expect(primitives).toContain("background: var(--status-bg)");

    const unsupportedWithoutFallback = [
      /color-mix\s*\(/i,
      /light-dark\s*\(/i,
      /oklch\s*\(/i,
      /@starting-style\b/i,
      /\btransition-behavior\s*:/i,
      /\bfield-sizing\s*:/i,
    ];
    for (const pattern of unsupportedWithoutFallback) {
      expect(css).not.toMatch(pattern);
    }
  });

  it("colors the AppHeader mark with the shared accent token", async () => {
    const { primitives } = await readStyles();

    expect(primitives).toMatch(/\.headerMark\s*\{[^}]*color:\s*var\(--accent\);[^}]*\}/s);
  });
});
