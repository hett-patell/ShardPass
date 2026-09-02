import { copyFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const rootPath = new URL("../../", import.meta.url).pathname;
const configPath = join(rootPath, "dependency-cruiser.config.cjs");
const depcruisePath = join(rootPath, "node_modules", ".bin", "depcruise");

let fixturePath: string;

async function writeFixture(relativePath: string, content: string): Promise<void> {
  const filePath = join(fixturePath, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

async function stubPackage(name: string): Promise<void> {
  await writeFixture(
    `node_modules/${name}/package.json`,
    JSON.stringify({ name, version: "0.0.0", main: "index.js" }),
  );
  await writeFixture(`node_modules/${name}/index.js`, "export default {};\n");
}

function cruise(): ReturnType<typeof spawnSync> {
  return spawnSync(
    depcruisePath,
    ["--config", "dependency-cruiser.config.cjs", "apps", "packages"],
    {
      cwd: fixturePath,
      encoding: "utf8",
    },
  );
}

function processText(value: string | Buffer | null): string {
  return typeof value === "string" ? value : (value?.toString("utf8") ?? "");
}

function output(result: ReturnType<typeof spawnSync>): string {
  return `${processText(result.stdout)}\n${processText(result.stderr)}`;
}

describe("dependency boundary policy", () => {
  beforeEach(async () => {
    fixturePath = await mkdtemp(join(tmpdir(), "shardpass-dependencies-"));
    await copyFile(configPath, join(fixturePath, "dependency-cruiser.config.cjs"));
    await Promise.all([
      mkdir(join(fixturePath, "apps"), { recursive: true }),
      mkdir(join(fixturePath, "packages"), { recursive: true }),
      writeFixture(
        "tsconfig.json",
        JSON.stringify({ compilerOptions: { module: "ESNext", moduleResolution: "Bundler" } }),
      ),
    ]);
  });

  afterEach(async () => {
    await rm(fixturePath, { recursive: true, force: true });
  });

  it("rejects a direct webextension import outside the platform boundary", async () => {
    await stubPackage("webextension-polyfill");
    await writeFixture(
      "apps/extension/src/background/index.ts",
      'import browser from "webextension-polyfill";\nvoid browser;\n',
    );

    const result = cruise();

    expect(result.status, output(result)).not.toBe(0);
    expect(output(result)).toContain("apps-use-platform-webextension-boundary");
  });

  it("permits a direct webextension import inside the platform boundary", async () => {
    await stubPackage("webextension-polyfill");
    await writeFixture(
      "apps/extension/src/platform/browser.ts",
      'import browser from "webextension-polyfill";\nvoid browser;\n',
    );

    const result = cruise();

    expect(result.status, output(result)).toBe(0);
  });

  it("rejects a package import from an application", async () => {
    await writeFixture("apps/extension/src/status.ts", "export const status = true;\n");
    await writeFixture(
      "packages/security/src/bad.ts",
      'import { status } from "../../../apps/extension/src/status";\nvoid status;\n',
    );

    const result = cruise();

    expect(result.status, output(result)).not.toBe(0);
    expect(output(result)).toContain("packages-cannot-import-apps");
  });

  it.each([
    [
      "background direct primitive",
      "apps/extension/src/background/bad.ts",
      'import "../../../../packages/crypto/src/kdf-direct";\n',
    ],
    [
      "UI direct primitive",
      "apps/extension/src/popup/bad.ts",
      'import "../../../../packages/crypto/src/kdf-direct";\n',
    ],
    [
      "other package direct primitive",
      "packages/storage/src/bad.ts",
      'import "../../crypto/src/kdf-direct";\n',
    ],
    [
      "production crypto test path",
      "apps/extension/src/background/bad.ts",
      'import "../../../../packages/crypto/test/compatibility-fixture";\n',
    ],
  ])("rejects %s imports", async (_label, importer, source) => {
    await writeFixture("packages/crypto/src/kdf-direct.ts", "export const direct = true;\n");
    await writeFixture(
      "packages/crypto/test/compatibility-fixture.ts",
      "export const fixture = true;\n",
    );
    await writeFixture(importer, source);

    const result = cruise();

    expect(result.status, output(result)).not.toBe(0);
    expect(output(result)).toMatch(/crypto-direct-kdf-boundary|production-cannot-import-tests/u);
  });

  it("allows only the crypto worker entry to import the direct primitive", async () => {
    await writeFixture("packages/crypto/src/kdf-direct.ts", "export const direct = true;\n");
    await writeFixture(
      "packages/crypto/src/kdf-worker-entry.ts",
      'import { direct } from "./kdf-direct";\nvoid direct;\n',
    );
    expect(cruise().status).toBe(0);
  });

  it("rejects a React import from a pure package", async () => {
    await stubPackage("react");
    await writeFixture("packages/security/src/bad.ts", 'import React from "react";\nvoid React;\n');

    const result = cruise();

    expect(result.status, output(result)).not.toBe(0);
    expect(output(result)).toContain("pure-packages-cannot-import-react");
  });
});
