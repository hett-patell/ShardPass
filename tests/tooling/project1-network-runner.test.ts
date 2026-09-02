import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLinuxIsolationAdapter,
  runInNetworkMode,
  runOfflineProductionBuild,
} from "../../scripts/project1-network-runner.mjs";
const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);
const adapter = (
  attempts: readonly {
    protocol: string;
    host: string;
    port: number;
    outcome: "allowed" | "denied";
  }[] = [],
) => ({
  capability: "os-network-isolation-v1" as const,
  name: "test-isolation",
  run: (request: { requestSha256: string }) =>
    Promise.resolve({
      schemaVersion: 1 as const,
      requestSha256: request.requestSha256,
      isolation: "enforced" as const,
      exitCode: 0,
      signal: null,
      timedOut: false,
      output: Buffer.from("safe output"),
      attempts,
    }),
});
describe("Project 1 network mode runner", () => {
  it("denies all observed offline attempts", async () => {
    const evidence = await runInNetworkMode({
      mode: "offline",
      commandId: "static",
      command: "node",
      args: ["check.mjs"],
      cwd: "/tmp",
      adapter: adapter([{ protocol: "tcp", host: "203.0.113.1", port: 443, outcome: "denied" }]),
    });
    expect(evidence.allowedEndpoints).toEqual([]);
    expect(evidence.requestSha256).toMatch(/^[a-f0-9]{64}$/u);
  });
  it("allows exact bootstrap registry and rejects alternate success", async () => {
    await expect(
      runInNetworkMode({
        mode: "bootstrap",
        commandId: "install",
        command: "pnpm",
        args: ["install", "--frozen-lockfile"],
        cwd: "/tmp",
        registryOrigin: "https://registry.npmjs.org/",
        adapter: adapter([
          { protocol: "https", host: "registry.npmjs.org", port: 443, outcome: "allowed" },
        ]),
      }),
    ).resolves.toMatchObject({ status: "PASS" });
    await expect(
      runInNetworkMode({
        mode: "bootstrap",
        commandId: "install",
        command: "pnpm",
        args: ["install", "--frozen-lockfile"],
        cwd: "/tmp",
        registryOrigin: "https://registry.npmjs.org/",
        adapter: adapter([
          { protocol: "https", host: "example.test", port: 443, outcome: "allowed" },
        ]),
      }),
    ).rejects.toThrow("NETWORK_POLICY_ESCAPE");
  });
  it("permits exact mock loopback and exact audit command", async () => {
    await expect(
      runInNetworkMode({
        mode: "mock",
        commandId: "browser",
        command: "playwright",
        cwd: "/tmp",
        mockOrigin: "http://127.0.0.1:3210",
        adapter: adapter([{ protocol: "http", host: "127.0.0.1", port: 3210, outcome: "allowed" }]),
      }),
    ).resolves.toBeDefined();
    await expect(
      runInNetworkMode({
        mode: "audit",
        commandId: "audit",
        command: "pnpm",
        args: ["install"],
        cwd: "/tmp",
        registryOrigin: "https://registry.npmjs.org/",
        adapter: adapter(),
      }),
    ).rejects.toThrow("NETWORK_AUDIT_COMMAND_INVALID");
  });
  it("uses real isolation to block descendant DNS, IPv4, IPv6, proxy, redirect, loopback, and external probes", async () => {
    if (process.platform !== "linux") return;
    const root = await mkdtemp(path.join(tmpdir(), "p1-network-conformance-"));
    roots.push(root);
    const probe = path.join(root, "probe.mjs");
    await writeFile(
      probe,
      `import dns from "node:dns/promises";
import net from "node:net";
import { spawnSync } from "node:child_process";
const attempts=[];
const probe=async(kind,fn)=>{try{await fn();attempts.push(kind+":ESCAPED")}catch{attempts.push(kind+":DENIED")}};
await probe("dns",()=>dns.lookup("example.com"));
await probe("ipv4",()=>new Promise((r,j)=>net.connect(443,"1.1.1.1").once("connect",r).once("error",j)));
await probe("ipv6",()=>new Promise((r,j)=>net.connect(443,"2606:4700:4700::1111").once("connect",r).once("error",j)));
await probe("loopback",()=>new Promise((r,j)=>net.connect(9,"127.0.0.1").once("connect",r).once("error",j)));
const child=spawnSync(process.execPath,["-e",'require("net").connect(443,"1.1.1.1").on("error",()=>process.exit(0))'],{timeout:3000});
attempts.push("subprocess:"+(child.status===0?"DENIED":"FAILED"));
console.log(attempts.join("\\n"));
`,
    );
    const evidence = await runInNetworkMode({
      mode: "offline",
      commandId: "conformance",
      command: process.execPath,
      args: [probe],
      cwd: root,
      adapter: createLinuxIsolationAdapter(),
      timeoutMs: 10000,
    });
    const output = evidence.output.toString("utf8");
    for (const kind of ["dns", "ipv4", "ipv6", "loopback", "subprocess"])
      expect(output).toContain(`${kind}:DENIED`);
    expect(output).not.toContain("ESCAPED");
  });

  it("runs the exact production build offline with sanitized environment and hash-bound result", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "p1-production-build-"));
    roots.push(root);
    const dist = path.join(root, "candidate-dist");
    const seen: Array<Record<string, unknown>> = [];
    process.env.HTTPS_PROXY = "http://credential:secret@proxy.test";
    process.env.NODE_PATH = "/ambient/modules";
    process.env.AWS_SECRET_ACCESS_KEY = "ambient-secret";
    process.env.HOME = "/ambient/home";
    const buildAdapter = {
      capability: "os-network-isolation-v1" as const,
      name: "fixture-isolation",
      async run(request: {
        requestSha256: string;
        args: readonly string[];
        cwd: string;
        env: NodeJS.ProcessEnv;
      }) {
        seen.push(request);
        expect(request.args).toEqual([
          "-eu",
          "-c",
          'pnpm exec vite build --outDir "$1" && node "$2" "$1"',
          "shardpass-production-build",
          dist,
          path.join(root, "scripts/inventory-ente-production-graph.mjs"),
        ]);
        expect(request.env).not.toHaveProperty("HTTPS_PROXY");
        expect(request.env).not.toHaveProperty("NODE_PATH");
        expect(request.env).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
        expect(request.env.HOME).not.toBe("/ambient/home");
        expect(request.env.SHARDPASS_BUILD_OUT_DIR).toBe(dist);
        await mkdir(dist, { recursive: true });
        await writeFile(path.join(dist, "manifest.json"), '{"name":"ShardPass","version":"1"}');
        return {
          schemaVersion: 1 as const,
          requestSha256: request.requestSha256,
          isolation: "enforced" as const,
          exitCode: 0,
          signal: null,
          timedOut: false,
          output: Buffer.from("offline build\n"),
          attempts: [
            { protocol: "tcp", host: "203.0.113.1", port: 443, outcome: "denied" as const },
          ],
        };
      },
    };
    try {
      const result = await runOfflineProductionBuild({
        workspaceRoot: root,
        distPath: dist,
        adapter: buildAdapter,
      });
      expect(seen).toHaveLength(1);
      expect(result.network.requestSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(result.network.observedAttempts).toEqual(["tcp://203.0.113.1:443 denied"]);
      expect(result.networkResultSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(result.distPath).toBe(dist);
    } finally {
      delete process.env.HTTPS_PROXY;
      delete process.env.NODE_PATH;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      delete process.env.HOME;
    }
  });

  it("fails production build when isolation is missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "p1-production-build-"));
    roots.push(root);
    await expect(
      runOfflineProductionBuild({ workspaceRoot: root, adapter: undefined as never }),
    ).rejects.toThrow("NETWORK_MODE_INVALID");
  });

  it("rejects omitted, malformed, empty, or hash-unbound operation results", async () => {
    const base = { mode: "offline" as const, commandId: "x", command: "node", cwd: "/tmp" };
    await expect(runInNetworkMode({ ...base, adapter: {} as never })).rejects.toThrow(
      "NETWORK_MODE_INVALID",
    );
    for (const run of [
      () => Promise.resolve(undefined),
      () =>
        Promise.resolve({
          isolation: "enforced",
          exitCode: 0,
          output: Buffer.from("x"),
          attempts: [],
        }),
      (request: { requestSha256: string }) =>
        Promise.resolve({
          schemaVersion: 1,
          requestSha256: `${request.requestSha256}x`,
          isolation: "enforced",
          exitCode: 0,
          signal: null,
          timedOut: false,
          output: Buffer.from("x"),
          attempts: [],
        }),
      (request: { requestSha256: string }) =>
        Promise.resolve({
          schemaVersion: 1,
          requestSha256: request.requestSha256,
          isolation: "enforced",
          exitCode: 0,
          signal: null,
          timedOut: false,
          output: Buffer.alloc(0),
          attempts: [],
        }),
    ])
      await expect(
        runInNetworkMode({
          ...base,
          adapter: { capability: "os-network-isolation-v1", name: "fake", run } as never,
        }),
      ).rejects.toThrow("NETWORK_COMMAND_FAILED");
  });
});
