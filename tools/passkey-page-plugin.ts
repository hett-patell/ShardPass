import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { transformWithEsbuild, type Plugin, type ResolvedConfig } from "vite";

export const PASSKEY_PAGE_FILE = "assets/passkey-page.js";

/** The manifest entry for the main-world interceptor; exported so a test can pin it. */
export const PASSKEY_PAGE_CONTENT_SCRIPT = Object.freeze({
  matches: ["<all_urls>"],
  js: [PASSKEY_PAGE_FILE],
  run_at: "document_start",
  all_frames: true,
  world: "MAIN",
});

export function withPasskeyPageScript<T extends { content_scripts?: unknown[] }>(manifest: T): T {
  const others = (manifest.content_scripts ?? []).filter(
    (script) => !((script as { js?: string[] }).js ?? []).includes(PASSKEY_PAGE_FILE),
  );
  return { ...manifest, content_scripts: [...others, PASSKEY_PAGE_CONTENT_SCRIPT] };
}

/**
 * Emits the WebAuthn interceptor as a standalone script and declares it as a MAIN-world
 * content script. It bypasses the crx pipeline on purpose: that pipeline wraps every content
 * script in a loader that dynamic-imports through chrome.runtime, which does not exist in a
 * page's world. Runs after everything else has been written.
 */
export function passkeyPagePlugin(options: { source: string }): Plugin {
  let config: ResolvedConfig | null = null;
  return {
    name: "shardpass-passkey-page",
    enforce: "post",
    configResolved(resolved) {
      config = resolved;
    },
    async closeBundle() {
      if (config === null || config.command !== "build") return;
      const outDir = path.resolve(config.root, config.build.outDir);
      const source = await readFile(options.source, "utf8");
      const { code } = await transformWithEsbuild(source, options.source, {
        loader: "ts",
        target: "chrome111",
        format: "iife",
        minify: true,
        sourcemap: false,
      });
      await mkdir(path.join(outDir, "assets"), { recursive: true });
      await writeFile(path.join(outDir, PASSKEY_PAGE_FILE), code);
      const manifestPath = path.join(outDir, "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        content_scripts?: unknown[];
      };
      await writeFile(manifestPath, JSON.stringify(withPasskeyPageScript(manifest), null, 2));
    },
  };
}
