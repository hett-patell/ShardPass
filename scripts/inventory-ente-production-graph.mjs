import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.resolve(root, process.argv[2] ?? "dist");
const assets = path.resolve(dist, "assets");
const names = (await readdir(assets)).sort();
const entry = names.find((name) => /^ente-srp-worker-entry-[\w-]+\.js$/u.test(name));
if (!entry) throw new Error("Production Ente SRP entry missing");
const queue = [entry];
const visited = new Set();
const files = [];
// Every constraint the manifest publishes names the terms that would disprove it, so the
// emitted booleans are read off the chunks instead of asserted. A graph that gains Chrome,
// storage, or network authority now fails the scan rather than being recorded as compliant.
const CONSTRAINT_TERMS = {
  noNetworkAuthority:
    /XMLHttpRequest|WebSocket|EventSource|fetch\(|sendBeacon|https?:\/\/|wss?:\/\//u,
  noChromeAuthority: /\bchrome\b|\bbrowser\s*\.\s*runtime\b|webextension/u,
  noStorageAuthority: /\bstorage\b|localStorage|sessionStorage|indexedDB|\bcaches\b/u,
  noTranscriptsIncluded: /clientPrivateHex|expectedM1Hex|expectedM2Hex|premasterSecretHex/u,
  noNodeExternals: /__vite-browser-external|\bnode:[a-z]|\brequire\s*\(\s*[^"']/u,
  noRandomBytes: /randomBytes/u,
  noDynamicCode: /eval\(|new Function|importScripts/u,
};
const scanned = Object.fromEntries(Object.keys(CONSTRAINT_TERMS).map((name) => [name, true]));
const violations = [];
while (queue.length > 0) {
  const name = queue.shift();
  if (!name || visited.has(name)) continue;
  visited.add(name);
  const bytes = await readFile(path.resolve(assets, name));
  const source = bytes.toString("utf8");
  for (const [constraint, term] of Object.entries(CONSTRAINT_TERMS))
    if (term.test(source)) {
      scanned[constraint] = false;
      violations.push(`${constraint} in ${name}`);
    }
  const imports = [...source.matchAll(/(?:from\s*|import\s*\()["']\.\/([^"']+\.js)["']/gu)]
    .map((match) => match[1])
    .filter((value) => names.includes(value));
  queue.push(...imports);
  files.push({
    path: `assets/${name}`,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    imports: [...new Set(imports)].sort().map((value) => `assets/${value}`),
  });
}
const allOtherSources = await Promise.all(
  names
    .filter((name) => name.endsWith(".js") && !visited.has(name))
    .map(async (name) => [name, await readFile(path.resolve(assets, name), "utf8")]),
);
for (const [name, source] of allOtherSources) {
  const approvedAuthWorker = /^ente-auth-worker-entry(?:-[\w-]+)?\.js$/u.test(name);
  if (
    /shardpassForbiddenRandomAuthority/u.test(source) ||
    (!approvedAuthWorker && /SrpClient|SRP\.params\[4096\]/u.test(source))
  )
    throw new Error(`SRP compatibility leaked into ${name}`);
  if (
    approvedAuthWorker &&
    (!/\.\/srp-adapter-[\w-]+\.js/u.test(source) ||
      !/(?:\.\/sodium-adapter-[\w-]+\.js|\.\/session-handoff-[\w-]+\.js)/u.test(source))
  )
    throw new Error(`Approved auth worker crypto boundary missing from ${name}`);
}
// dormant: the entry is emitted but unowned. No chunk outside its own graph names the entry
// file, so nothing in the production build can start the worker.
const dormant = allOtherSources.every(([, source]) => !source.includes(entry));
if (!dormant) violations.push(`dormant: ${entry} has a runtime owner`);
if (violations.length > 0)
  throw new Error(`Forbidden production SRP output: ${violations.sort().join(", ")}`);
const manifest = {
  schemaVersion: 1,
  entry: `assets/${entry}`,
  files: files.sort((left, right) => left.path.localeCompare(right.path)),
  constraints: { dormant, ...scanned },
};
await writeFile(
  path.resolve(dist, ".ente-srp-production-graph.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
