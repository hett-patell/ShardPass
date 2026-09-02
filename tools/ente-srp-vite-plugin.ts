import path from "node:path";
import type { Plugin } from "vite";

export const ENTE_SRP_PRODUCTION_ENTRY = "ente-srp-worker-entry";

export type EnteSrpViteOptions = Readonly<{
  workspaceRoot: string;
  productionEntry: string;
  requireProductionEntry?: boolean;
  requireGraph?: boolean;
}>;

/**
 * Scopes the reviewed Node compatibility surface to fast-srp-hap's production
 * worker graph and rejects leakage into every other emitted entry.
 */
export function enteSrpVitePlugin(options: EnteSrpViteOptions): Plugin {
  const compatibility = path.resolve(
    options.workspaceRoot,
    "apps/extension/src/background/ente/srp-compat",
  );
  const candidateRoot = `${path.sep}fast-srp-hap${path.sep}`;
  const compatRoot = `${path.sep}srp-compat${path.sep}`;
  const productionEntry = path.resolve(options.productionEntry);

  return {
    name: "shardpass-scoped-ente-srp",
    enforce: "pre",
    config() {
      return {
        resolve: {
          alias: [
            { find: /^node:buffer$/u, replacement: path.resolve(compatibility, "buffer.ts") },
            { find: /^buffer$/u, replacement: path.resolve(compatibility, "buffer.ts") },
            { find: /^crypto$/u, replacement: path.resolve(compatibility, "crypto.ts") },
            { find: /^assert$/u, replacement: path.resolve(compatibility, "assert.ts") },
          ],
        },
      };
    },
    renderChunk: {
      order: "post",
      handler(code, chunk) {
        const belongsToSrpGraph =
          chunk.name === ENTE_SRP_PRODUCTION_ENTRY ||
          Object.keys(chunk.modules).some(
            (id) => id.includes(candidateRoot) || id.includes(compatRoot),
          );
        const bufferCapabilityProbe =
          'typeof console<"u"&&typeof console.error=="function"&&console.error';
        if (!belongsToSrpGraph && !code.includes(bufferCapabilityProbe)) return;
        let replacement = code.replaceAll(".randomBytes", ".__shardpassForbiddenRandomAuthority");
        replacement = replacement.replaceAll("console.warn", "__shardpassNoopWarning");
        replacement = replacement.replaceAll("console.log", "__shardpassNoopWarning");
        replacement = replacement.replaceAll("console.error", "__shardpassNoopWarning");
        replacement = replacement.replaceAll('typeof console<"u"', "false");
        replacement = replacement.replaceAll('typeof console<"undefined"', "false");
        replacement = replacement.replaceAll("r.console", "r.__shardpassNoConsole");
        if (
          belongsToSrpGraph &&
          (replacement.includes("randomBytes") || /\bconsole\b/u.test(replacement))
        )
          throw new Error(
            `Unexpected authority in Ente SRP worker output: ${replacement.match(/.{0,40}(?:randomBytes|console).{0,40}/gu)?.join(" | ") ?? "unknown"}`,
          );
        if (replacement.includes("__shardpassNoopWarning"))
          replacement = `const __shardpassNoopWarning=()=>{};${replacement}`;
        return replacement === code ? undefined : { code: replacement, map: null };
      },
    },
    generateBundle(_output, bundle) {
      const chunks = Object.values(bundle).filter((item) => item.type === "chunk");
      const candidateChunks = chunks.filter((chunk) =>
        Object.keys(chunk.modules).some(
          (id) => id.includes(candidateRoot) || id.includes(compatRoot),
        ),
      );
      if (candidateChunks.length === 0) {
        if (options.requireGraph !== false)
          throw new Error("Ente SRP worker graph was not emitted");
        return;
      }
      if (options.requireProductionEntry !== false) {
        const productionChunk = chunks.find((chunk) =>
          Object.keys(chunk.modules).some((id) => path.resolve(id) === productionEntry),
        );
        if (!productionChunk || productionChunk.name !== ENTE_SRP_PRODUCTION_ENTRY)
          throw new Error("Configured production Ente SRP entry was not emitted");
      }
      if (options.requireProductionEntry !== false) {
        for (const chunk of candidateChunks) {
          const entryOwners = chunks
            .filter((owner) => owner.isEntry && owner.imports.includes(chunk.fileName))
            .map((owner) => owner.name);
          const approvedEntry = (name: string) =>
            name === ENTE_SRP_PRODUCTION_ENTRY || name === "enteAuthWorkerEntry";
          if (
            chunk.isEntry
              ? !approvedEntry(chunk.name)
              : entryOwners.some((name) => !approvedEntry(name))
          )
            throw new Error(`Ente SRP compatibility leaked into ${chunk.fileName}`);
        }
      }
    },
  };
}
