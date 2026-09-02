import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { scanSecretRoot, SECRET_SCANNER_SCHEMA_VERSION } from "./scan-secrets.mjs";

const root = path.resolve("tests/tooling");
const output = path.resolve("config/project1-secret-allowlist.json");
const authorizedPath =
  /(?:^|\/)(?:[^/]+\.test\.(?:ts|tsx|js|mjs)|project1-candidate-harness\.ts|fixtures?\/[^/]+)$/u;

async function generate() {
  const temporary = await mkdtemp(path.join(tmpdir(), "shardpass-secret-allowlist-"));
  const emptyPath = path.join(temporary, "empty.json");
  await writeFile(emptyPath, '{"schemaVersion":1,"scannerSchemaVersion":1,"allowances":[]}');
  try {
    const report = await scanSecretRoot({
      root,
      rootName: "tests/tooling",
      mode: "source",
      allowlistPath: emptyPath,
      maxTextBytes: 8 * 1024 * 1024,
      maxBinaryBytes: 32 * 1024 * 1024,
    });
    if (report.findings.some(({ path: findingPath }) => !authorizedPath.test(findingPath)))
      throw new Error("SECRET_SCAN_ALLOWLIST_PATH");
    const allowances = report.findings.map((finding) => ({
      schemaVersion: 1,
      scannerSchemaVersion: SECRET_SCANNER_SCHEMA_VERSION,
      mode: "source",
      ...finding,
      rationale: "scanner-test-canary",
    }));
    const canonical = JSON.stringify({
      schemaVersion: 1,
      scannerSchemaVersion: SECRET_SCANNER_SCHEMA_VERSION,
      allowances,
    });
    if (process.argv.includes("--write")) {
      await writeFile(output, canonical);
      process.stdout.write(`Wrote ${allowances.length} exact test-source allowances\n`);
    } else {
      const current = await readFile(output, "utf8");
      if (current !== canonical) throw new Error("SECRET_SCAN_ALLOWLIST_STALE");
      process.stdout.write(`Reviewed ${allowances.length} exact test-source allowances\n`);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href)
  generate().catch((error) => {
    process.stderr.write(
      `${error instanceof Error && error.message.startsWith("SECRET_SCAN_") ? error.message : "SECRET_SCAN_INTERNAL"}\n`,
    );
    process.exitCode = 1;
  });
