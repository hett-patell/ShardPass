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
const forbidden =
  /randomBytes|__vite-browser-external|node:buffer|\brequire\s*\(\s*[^"']|eval\(|new Function|importScripts|XMLHttpRequest|WebSocket|EventSource|fetch\(|https?:\/\/|wss?:\/\/|clientPrivateHex|expectedM1Hex|expectedM2Hex|premasterSecretHex/u;
while (queue.length > 0) {
  const name = queue.shift();
  if (!name || visited.has(name)) continue;
  visited.add(name);
  const bytes = await readFile(path.resolve(assets, name));
  const source = bytes.toString("utf8");
  if (forbidden.test(source)) throw new Error(`Forbidden production SRP output in ${name}`);
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
const manifest = {
  schemaVersion: 1,
  entry: `assets/${entry}`,
  files: files.sort((left, right) => left.path.localeCompare(right.path)),
  constraints: {
    dormant: true,
    noNetworkAuthority: true,
    noChromeAuthority: true,
    noStorageAuthority: true,
    noTranscriptsIncluded: true,
    noNodeExternals: true,
    noRandomBytes: true,
    noDynamicCode: true,
  },
};
await writeFile(
  path.resolve(dist, ".ente-srp-production-graph.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
