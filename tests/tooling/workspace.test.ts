import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);

describe("workspace policy", () => {
  it("keeps generated builds and local secrets out of source", async () => {
    const ignore = await readFile(new URL(".gitignore", root), "utf8");

    expect(ignore).toContain("dist/");
    expect(ignore).toContain(".env*");
    expect(ignore).not.toContain("assets/");
  });

  it("uses the approved Node and pnpm runtime baseline", async () => {
    const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8")) as {
      packageManager?: string;
      engines?: Record<string, string>;
    };

    expect(packageJson.packageManager).toBe("pnpm@10.14.0");
    expect(packageJson.engines).toEqual({ node: ">=22.14.0 <23", pnpm: "10.14.0" });
  });

  it("uses strict TypeScript across future app and package sources", async () => {
    const baseConfig = JSON.parse(await readFile(new URL("tsconfig.base.json", root), "utf8")) as {
      compilerOptions?: Record<string, unknown>;
    };
    const rootConfig = JSON.parse(await readFile(new URL("tsconfig.json", root), "utf8")) as {
      include?: string[];
    };

    expect(baseConfig.compilerOptions?.strict).toBe(true);
    expect(baseConfig.compilerOptions?.noUncheckedIndexedAccess).toBe(true);
    expect(baseConfig.compilerOptions?.exactOptionalPropertyTypes).toBe(true);
    const eslintConfig = await readFile(new URL("eslint.config.js", root), "utf8");

    expect(rootConfig.include).toEqual(
      expect.arrayContaining([
        "apps/**/*.ts",
        "apps/**/*.tsx",
        "packages/**/*.ts",
        "packages/**/*.tsx",
        "tools/**/*.ts",
      ]),
    );
    expect(eslintConfig).toContain("projectService: true");
    expect(eslintConfig).toContain("tsconfigRootDir: import.meta.dirname");
  });

  it("orders a clean production build before dedicated output security tests", async () => {
    const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};

    expect(scripts.test).toBe("vitest run");
    expect(scripts["test:security-output"]).toBe(
      "vitest run --config tests/security/vitest-output.config.ts",
    );
    const buildSecuritySteps = scripts["build:security"]?.split(" && ");
    expect(buildSecuritySteps).toEqual([
      "node scripts/clean-dist.mjs",
      "vite build",
      "node scripts/inventory-ente-production-graph.mjs",
      "vitest run --config tests/security/vitest-output.config.ts",
      "node --experimental-strip-types scripts/scan-build.mjs",
    ]);
    expect(await readFile(new URL("scripts/clean-dist.mjs", root), "utf8")).toContain(
      'rm(new URL("../dist", import.meta.url), { recursive: true, force: true })',
    );
    expect(scripts.verify).toContain("pnpm test &&");
    expect(scripts.verify).toContain("pnpm build:security");
    expect(scripts.verify).not.toMatch(/pnpm test:security-output.*pnpm build:security/u);
    expect(scripts["verify:project0"]).toBe(
      "node scripts/check-engine.mjs && pnpm verify:project0:evidence",
    );
    expect(scripts["verify:project0:local-node24"]).toBe(
      "node scripts/check-engine.mjs --allow-node24 && pnpm verify:project0:evidence",
    );
    expect(scripts["verify:project0:evidence"]).toContain("pnpm test:browser:built");
    expect(scripts["verify:project0:evidence"]).toContain(
      "node scripts/verify-reproducible-build.mjs",
    );
    expect(scripts["verify:project0:evidence"]).toContain("pnpm audit --prod");
  });

  it("defines repeatable engine-enforced Project 1 Task 8 evidence commands", async () => {
    const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};

    expect(scripts["format:check:project1:task8"]).toBe(
      "prettier --check . --ignore-path .prettierignore --ignore-path .prettierignore.project1-task8",
    );
    expect(await readFile(new URL(".prettierignore.project1-task8", root), "utf8")).toBe(
      [
        "# Task 8 evidence is append-only and the sealed Task 7 recovery artifact is read-only.",
        ".sdd/project1-task8-execution-ledger.md",
        ".sdd/recovery/project1-task7-contaminated-execution-ledger-2026-08-10.md",
        "",
      ].join("\n"),
    );
    expect(scripts["test:project1:task8"]).toBe(
      "vitest run packages/domain packages/otp packages/otp-storage packages/storage packages/messaging packages/security apps/extension/test/background apps/extension/test/platform apps/extension/test/popup apps/extension/test/vault",
    );
    expect(scripts["verify:project1:task8:evidence"]).toBe(
      "pnpm typecheck && pnpm lint && pnpm format:check:project1:task8 && pnpm dependencies && pnpm build:security && pnpm test && pnpm exec vitest run tests/browser/startup-diagnostics.test.ts tests/browser/startup-process-harness.test.ts && pnpm test:browser:built && pnpm exec vitest run tests/security tests/legacy && node scripts/verify-reproducible-build.mjs && pnpm audit --prod",
    );
    expect(scripts["verify:project1:task8"]).toBe(
      "node scripts/check-engine.mjs --local-command=verify:project1:task8:local-node24 && pnpm verify:project1:task8:evidence",
    );
    expect(scripts["verify:project1:task8:local-node24"]).toBe(
      "node scripts/check-engine.mjs --allow-node24 && pnpm verify:project1:task8:evidence",
    );

    for (const name of [
      "verify:project1:task8:evidence",
      "verify:project1:task8",
      "verify:project1:task8:local-node24",
    ]) {
      expect(scripts[name]).not.toMatch(
        /(?:^|\s)(?:git|pnpm\s+verify:project1:task8(?:\s|$)|--update-snapshots|--write)(?:\s|$)/u,
      );
    }
  });

  it("defines complete engine-enforced Project 1 Task 9 acceptance commands", async () => {
    const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8")) as {
      packageManager?: string;
      engines?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};

    expect(scripts["format:check:project1:task9"]).toBe(
      "prettier --check . --ignore-path .prettierignore --ignore-path .prettierignore.project1-task9",
    );
    expect(await readFile(new URL(".prettierignore.project1-task9", root), "utf8")).toBe(
      [
        "# Task 9 evidence is append-only; the Task 8 ledger and sealed Task 7 recovery artifact are pre-existing evidence.",
        ".sdd/project1-task9-execution-ledger.md",
        ".sdd/project1-task8-execution-ledger.md",
        ".sdd/recovery/project1-task7-contaminated-execution-ledger-2026-08-10.md",
        "",
      ].join("\n"),
    );
    expect((await readFile(new URL(".prettierignore", root), "utf8")).split("\n")).toContain(
      "packages/importers/src/generated/google-authenticator-migration_pb.ts",
    );
    expect(scripts["test:project1:task9"]).toBe(
      "vitest run packages/importers packages/messaging packages/storage apps/extension/test/background apps/extension/test/platform apps/extension/test/vault",
    );
    expect(scripts["verify:project1:task9:evidence"]).toBe(
      "pnpm typecheck && pnpm lint && pnpm format:check:project1:task9 && pnpm dependencies && pnpm build:security && pnpm exec vitest run --maxWorkers=1 --no-file-parallelism && pnpm exec vitest run packages/importers --maxWorkers=1 --no-file-parallelism && pnpm exec vitest run tests/browser/startup-diagnostics.test.ts tests/browser/startup-process-harness.test.ts --maxWorkers=1 --no-file-parallelism && pnpm test:browser:built && pnpm exec vitest run tests/security tests/legacy --maxWorkers=1 --no-file-parallelism && node scripts/verify-reproducible-build.mjs && pnpm audit --prod",
    );
    expect(scripts["test:browser:built"]).toBe(
      "pnpm build:test:crypto && pnpm build:test:ente-srp && playwright test",
    );
    expect(packageJson).toMatchObject({
      packageManager: "pnpm@10.14.0",
      engines: { node: ">=22.14.0 <23", pnpm: "10.14.0" },
    });
    expect(scripts["verify:project1:task9"]).toBe(
      "node scripts/check-engine.mjs --local-command=verify:project1:task9:local-node24 && pnpm verify:project1:task9:evidence",
    );
    expect(scripts["verify:project1:task9:local-node24"]).toBe(
      "node scripts/check-engine.mjs --allow-node24 && pnpm verify:project1:task9:evidence",
    );

    for (const name of [
      "verify:project1:task9:evidence",
      "verify:project1:task9",
      "verify:project1:task9:local-node24",
    ]) {
      expect(scripts[name]).not.toMatch(
        /(?:^|\s)(?:git|pnpm\s+verify:project1:task9(?:\s|$)|--update-snapshots|--write)(?:\s|$)/u,
      );
    }
    expect(scripts["verify:project1:task9:evidence"]).not.toContain("pnpm test:browser &&");
  });

  it("prints Task 9 local guidance on Node 24 without starting evidence", () => {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("scripts/check-engine.mjs", root)),
        "--local-command=verify:project1:task9:local-node24",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          npm_config_user_agent: "pnpm/10.14.0 npm/? node/v24.18.0 linux x64",
        },
      },
    );

    expect(result.status).toBe(process.versions.node.startsWith("24.") ? 1 : 0);
    if (process.versions.node.startsWith("24.")) {
      expect(result.stderr).toBe(
        `Project 1 Task 9 requires Node >=22.14.0 <23 and pnpm 10.14.0; found Node ${process.versions.node} and pnpm 10.14.0. Use verify:project1:task9:local-node24 for development evidence only.\n`,
      );
      expect(result.stderr).not.toContain("Project 0");
      expect(result.stderr).not.toContain("verify:project0:local-node24");
      expect(result.stdout).toBe("");
    }
  });

  it("prints Task 8 local guidance on Node 24 without leaking Project 0 guidance", () => {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("scripts/check-engine.mjs", root)),
        "--local-command=verify:project1:task8:local-node24",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          npm_config_user_agent: "pnpm/10.14.0 npm/? node/v24.18.0 linux x64",
        },
      },
    );

    expect(result.status).toBe(process.versions.node.startsWith("24.") ? 1 : 0);
    if (process.versions.node.startsWith("24.")) {
      expect(result.stderr).toContain(
        "Use verify:project1:task8:local-node24 for development evidence only.",
      );
      expect(result.stderr).not.toContain("verify:project0:local-node24");
    }
  });

  it("orders the Task 12 production inventory prerequisite before serial evidence", async () => {
    const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};

    expect(scripts["test:project1:task12"]).toBe(
      "pnpm build && vitest run apps/extension/test/background apps/extension/test/platform apps/extension/test/popup apps/extension/test/vault tests/security tests/legacy tests/tooling --maxWorkers=1 --no-file-parallelism",
    );
    expect(scripts["verify:project1:task12:evidence"]).toContain(
      "pnpm exec vitest run --maxWorkers=1 --no-file-parallelism",
    );
    expect(scripts["verify:project1:task12:evidence"]).not.toContain("&& pnpm test &&");
  });

  it("synchronizes official and local Task 12 commands with the release verifier", async () => {
    const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};
    expect(scripts["verify:project1:task12"]).toBe(
      "node scripts/check-engine.mjs --local-command=verify:project1:task12:local-node24 && node scripts/verify-task12-release.mjs",
    );
    expect(scripts["verify:project1:task12:local-node24"]).toBe(
      "node scripts/check-engine.mjs --allow-node24 && node scripts/verify-task12-release.mjs",
    );
    const verifier = await readFile(new URL("scripts/verify-task12-release.mjs", root), "utf8");
    expect(verifier).toContain('spawnSync("pnpm", ["verify:project1:task12:evidence"]');
  });

  it("exposes one exact Project 1 release command and one development-only helper", async () => {
    const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8")) as {
      scripts?: Record<string, string>;
      packageManager?: string;
      engines?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};
    expect(packageJson.packageManager).toBe("pnpm@10.14.0");
    expect(packageJson.engines).toEqual({ node: ">=22.14.0 <23", pnpm: "10.14.0" });
    expect(scripts["verify:project1"]).toBe(
      "node scripts/check-engine.mjs --local-command=verify:project1:local-node24 && node scripts/verify-project1-release.mjs --mode=release",
    );
    expect(scripts["verify:project1:local-node24"]).toBe(
      "node scripts/check-engine.mjs --allow-node24 && node scripts/verify-project1-release.mjs --mode=development",
    );
    expect(
      Object.keys(scripts).filter((name) => /^verify:project1(?::local-node24)?$/u.test(name)),
    ).toEqual(["verify:project1", "verify:project1:local-node24"]);
    for (const [name, command] of Object.entries(scripts).filter(([name]) =>
      name.startsWith("verify:project1"),
    )) {
      expect(command, name).not.toContain("--ignore-engines");
      expect(command, name).not.toMatch(/(?:chrome|browser).*(?:override|version)=/iu);
      if (name !== "verify:project1") expect(command, name).not.toContain("--mode=release");
      expect(command, name).not.toContain("PASS-PROJECT1-RELEASE");
    }
    const engine = await readFile(new URL("scripts/check-engine.mjs", root), "utf8");
    expect(engine.match(/"verify:project1:local-node24"/gu)).toHaveLength(2);
  });

  it("prints Project 1 local guidance on Node 24 before release evidence starts", () => {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("scripts/check-engine.mjs", root)),
        "--local-command=verify:project1:local-node24",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          npm_config_user_agent: "pnpm/10.14.0 npm/? node/v24.18.0 linux x64",
        },
      },
    );

    if (process.versions.node.startsWith("24.")) {
      expect(result.status).toBe(1);
      expect(result.stderr).toBe(
        `Project 1 requires Node >=22.14.0 <23 and pnpm 10.14.0; found Node ${process.versions.node} and pnpm 10.14.0. Use verify:project1:local-node24 for development evidence only.\n`,
      );
      expect(result.stdout).toBe("");
    }
  });

  it("prints Task 12 local guidance on Node 24 before evidence starts", () => {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("scripts/check-engine.mjs", root)),
        "--local-command=verify:project1:task12:local-node24",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          npm_config_user_agent: "pnpm/10.14.0 npm/? node/v24.18.0 linux x64",
        },
      },
    );

    expect(result.status).toBe(process.versions.node.startsWith("24.") ? 1 : 0);
    if (process.versions.node.startsWith("24.")) {
      expect(result.stderr).toBe(
        `Project 1 Task 12 requires Node >=22.14.0 <23 and pnpm 10.14.0; found Node ${process.versions.node} and pnpm 10.14.0. Use verify:project1:task12:local-node24 for development evidence only.\n`,
      );
      expect(result.stdout).toBe("");
    }
  });

  it("accepts the exact Task 12 local bypass on Node 24", () => {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("scripts/check-engine.mjs", root)), "--allow-node24"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          npm_config_user_agent: "pnpm/10.14.0 npm/? node/v24.18.0 linux x64",
        },
      },
    );

    if (process.versions.node.startsWith("24.")) {
      expect(result.status).toBe(0);
      expect(result.stderr).toContain("Development-only runtime bypass");
    }
  });

  it("rejects an unallowlisted local command without reflecting it", () => {
    const injected = "verify:project1:task12:local-node24;unsafe";
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("scripts/check-engine.mjs", root)), `--local-command=${injected}`],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          npm_config_user_agent: "pnpm/10.14.0 npm/? node/v24.18.0 linux x64",
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid local verification command.");
    expect(result.stderr).not.toContain(injected);
  });

  it("defines explicit Node and DOM test projects without omitting workspace tests", async () => {
    const config = await readFile(new URL("vitest.config.ts", root), "utf8");

    expect(config).toContain('name: "node"');
    expect(config).toContain('environment: "node"');
    expect(config).toContain('name: "dom"');
    expect(config).toContain('environment: "jsdom"');
    expect(config).toContain('"apps/**/test/**/*.test.{ts,tsx}"');
    expect(config).toContain('"packages/**/test/**/*.test.{ts,tsx}"');
    expect(config).toContain('"tests/**/*.test.ts"');
  });
});
