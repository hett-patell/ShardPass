import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const MODES = new Set(["bootstrap", "offline", "mock", "audit"]);
const SAFE_ENV = new Set(["PATH", "SYSTEMROOT", "TMPDIR", "TEMP", "TMP"]);
const byteSort = (a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
const exactKeys = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

function endpoint(value) {
  const url = new URL(value);
  if (!new Set(["https:", "http:"]).has(url.protocol) || url.username || url.password || url.hash)
    throw new Error("NETWORK_ENDPOINT_INVALID");
  return url;
}
function safeEnvironment(extra) {
  const env = {};
  for (const key of SAFE_ENV) if (process.env[key]) env[key] = process.env[key];
  return { ...env, CI: "1", COREPACK_ENABLE_DOWNLOAD_PROMPT: "0", ...extra };
}
const canonicalNetworkResult = (evidence) =>
  JSON.stringify({
    schemaVersion: evidence.schemaVersion,
    mode: evidence.mode,
    commandId: evidence.commandId,
    requestSha256: evidence.requestSha256,
    isolation: evidence.isolation,
    allowedEndpoints: evidence.allowedEndpoints,
    observedAttempts: evidence.observedAttempts,
    outputSha256: evidence.outputSha256,
    status: evidence.status,
  });
const canonicalRequest = (request) =>
  JSON.stringify({
    mode: request.mode,
    command: request.command,
    args: request.args,
    cwd: path.resolve(request.cwd),
    allowedEndpoints: request.allowedEndpoints,
    env: Object.fromEntries(Object.entries(request.env).sort(([a], [b]) => byteSort(a, b))),
    timeoutMs: request.timeoutMs,
  });

export async function runInNetworkMode({
  mode,
  commandId,
  command,
  args = [],
  cwd,
  adapter,
  registryOrigin,
  mockOrigin,
  timeoutMs = 120000,
  beforeSnapshot,
  afterSnapshot,
  environment = {},
}) {
  if (
    !MODES.has(mode) ||
    typeof commandId !== "string" ||
    !/^[a-z0-9][a-z0-9.-]*$/u.test(commandId) ||
    typeof command !== "string" ||
    command.length === 0 ||
    !Array.isArray(args) ||
    environment === null ||
    typeof environment !== "object" ||
    Array.isArray(environment) ||
    Object.entries(environment).some(
      ([key, value]) =>
        !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) || typeof value !== "string" || value.includes("\0"),
    ) ||
    !adapter ||
    adapter.capability !== "os-network-isolation-v1" ||
    typeof adapter.run !== "function"
  )
    throw new Error("NETWORK_MODE_INVALID");
  let allowedEndpoints = [];
  const commandArgs = [...args];
  if (mode === "mock") {
    const mock = endpoint(mockOrigin);
    if (
      mock.protocol !== "http:" ||
      !new Set(["127.0.0.1", "[::1]", "localhost"]).has(mock.hostname)
    )
      throw new Error("NETWORK_MOCK_ORIGIN_INVALID");
    allowedEndpoints = [mock.origin];
  } else if (mode !== "offline") {
    const registry = endpoint(registryOrigin);
    if (registry.protocol !== "https:" || registry.pathname !== "/" || registry.search)
      throw new Error("NETWORK_REGISTRY_INVALID");
    allowedEndpoints =
      mode === "audit" ? [`${registry.origin}/-/npm/v1/security/audits`] : [registry.origin];
    if (
      mode === "bootstrap" &&
      !(commandArgs[0] === "install" && commandArgs.includes("--frozen-lockfile"))
    )
      throw new Error("NETWORK_BOOTSTRAP_COMMAND_INVALID");
    if (
      mode === "audit" &&
      !(commandArgs.length === 2 && commandArgs[0] === "audit" && commandArgs[1] === "--prod")
    )
      throw new Error("NETWORK_AUDIT_COMMAND_INVALID");
  }
  const request = Object.freeze({
    mode,
    command,
    args: Object.freeze(commandArgs),
    cwd: path.resolve(cwd),
    env: safeEnvironment({
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
      ...(registryOrigin ? { npm_config_registry: new URL(registryOrigin).href } : {}),
      ...environment,
    }),
    allowedEndpoints: Object.freeze(allowedEndpoints),
    timeoutMs,
  });
  const requestSha256 = sha256(canonicalRequest(request));
  const before = beforeSnapshot ? await beforeSnapshot() : undefined;
  const result = await adapter.run(Object.freeze({ ...request, requestSha256 }));
  if (
    !exactKeys(result, [
      "schemaVersion",
      "requestSha256",
      "isolation",
      "exitCode",
      "signal",
      "timedOut",
      "output",
      "attempts",
    ]) ||
    result.schemaVersion !== 1 ||
    result.requestSha256 !== requestSha256 ||
    result.isolation !== "enforced" ||
    result.exitCode !== 0 ||
    result.signal !== null ||
    result.timedOut !== false ||
    !Buffer.isBuffer(result.output) ||
    result.output.length === 0 ||
    !Array.isArray(result.attempts)
  )
    throw new Error("NETWORK_COMMAND_FAILED");
  const attempts = result.attempts
    .map((attempt) => {
      if (
        !exactKeys(attempt, ["protocol", "host", "port", "outcome"]) ||
        typeof attempt.protocol !== "string" ||
        typeof attempt.host !== "string" ||
        !Number.isSafeInteger(attempt.port) ||
        !new Set(["allowed", "denied"]).has(attempt.outcome)
      )
        throw new Error("NETWORK_ATTEMPT_INVALID");
      const allowed = allowedEndpoints.some((allowedEndpoint) => {
        const allowedUrl = new URL(allowedEndpoint);
        return (
          allowedUrl.protocol.slice(0, -1) === attempt.protocol &&
          allowedUrl.hostname === attempt.host &&
          Number(allowedUrl.port || (allowedUrl.protocol === "https:" ? 443 : 80)) === attempt.port
        );
      });
      if ((attempt.outcome === "allowed") !== allowed) throw new Error("NETWORK_POLICY_ESCAPE");
      return `${attempt.protocol}://${attempt.host}:${attempt.port} ${attempt.outcome}`;
    })
    .sort(byteSort);
  if (mode !== "offline" && attempts.length === 0) throw new Error("NETWORK_OBSERVATION_MISSING");
  if (afterSnapshot && before !== (await afterSnapshot()))
    throw new Error("NETWORK_WORKSPACE_MUTATED");
  return Object.freeze({
    schemaVersion: 1,
    mode,
    commandId,
    requestSha256,
    isolation: adapter.name,
    allowedEndpoints: Object.freeze(allowedEndpoints),
    observedAttempts: Object.freeze(attempts),
    output: result.output,
    outputSha256: sha256(result.output),
    status: "PASS",
  });
}

export async function runOfflineProductionBuild({
  workspaceRoot,
  distPath = path.join(workspaceRoot, "dist"),
  adapter,
  timeoutMs = 600000,
}) {
  const root = path.resolve(workspaceRoot);
  const dist = path.resolve(distPath);
  if (!dist.startsWith(`${root}${path.sep}`) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    throw new Error("OFFLINE_BUILD_OPTIONS_INVALID");
  const privateHome = path.join(root, ".shardpass-build-home");
  await rm(dist, { recursive: true, force: true });
  await rm(privateHome, { recursive: true, force: true });
  await mkdir(privateHome, { recursive: true, mode: 0o700 });
  const inventory = path.join(root, "scripts/inventory-ente-production-graph.mjs");
  const script = 'pnpm exec vite build --outDir "$1" && node "$2" "$1"';
  try {
    const network = await runInNetworkMode({
      mode: "offline",
      commandId: "production-build",
      command: "/bin/sh",
      args: ["-eu", "-c", script, "shardpass-production-build", dist, inventory],
      cwd: root,
      adapter,
      timeoutMs,
      environment: {
        HOME: privateHome,
        PNPM_HOME: path.join(privateHome, "pnpm-home"),
        npm_config_offline: "true",
        npm_config_audit: "false",
        npm_config_fund: "false",
        SHARDPASS_BUILD_OUT_DIR: dist,
      },
    });
    await access(dist);
    return Object.freeze({
      schemaVersion: 1,
      command: `pnpm exec vite build --outDir ${dist} && node ${inventory} ${dist}`,
      distPath: dist,
      network,
      networkResultSha256: sha256(canonicalNetworkResult(network)),
    });
  } finally {
    await rm(privateHome, { recursive: true, force: true });
  }
}

function executable(name) {
  const directories = (process.env.PATH ?? "").split(path.delimiter);
  return Promise.any(
    directories.map(async (directory) => {
      const candidate = path.join(directory, name);
      await access(candidate);
      return candidate;
    }),
  ).catch(() => undefined);
}
function execute(command, args, request, attempts = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: request.cwd,
      env: request.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.once("error", reject);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, request.timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({
        schemaVersion: 1,
        requestSha256: request.requestSha256,
        isolation: "enforced",
        exitCode: code ?? -1,
        signal,
        timedOut,
        output: Buffer.concat(chunks),
        attempts,
      });
    });
  });
}

/** Real Linux isolation. External modes require an independently configured enforcing wrapper. */
export function createLinuxIsolationAdapter() {
  return Object.freeze({
    capability: "os-network-isolation-v1",
    name: "linux-kernel-network-v1",
    async run(request) {
      if (process.platform !== "linux") throw new Error("NETWORK_ISOLATION_UNAVAILABLE");
      if (request.mode === "offline") {
        const bwrap = await executable("bwrap");
        if (bwrap)
          return execute(
            bwrap,
            ["--unshare-net", "--dev-bind", "/", "/", "--", request.command, ...request.args],
            request,
          );
        const unshare = await executable("unshare");
        if (unshare)
          return execute(unshare, ["--net", "--", request.command, ...request.args], request);
        const firejail = await executable("firejail");
        if (firejail)
          return execute(
            firejail,
            ["--quiet", "--net=none", "--", request.command, ...request.args],
            request,
          );
        throw new Error("NETWORK_ISOLATION_UNAVAILABLE");
      }
      const wrapper = process.env.SHARDPASS_NETWORK_WRAPPER;
      if (!wrapper || !path.isAbsolute(wrapper))
        throw new Error("NETWORK_EXTERNAL_POLICY_UNAVAILABLE");
      await access(wrapper);
      const policy = Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          requestSha256: request.requestSha256,
          mode: request.mode,
          allowedEndpoints: request.allowedEndpoints,
        }),
      ).toString("base64url");
      const result = await execute(
        wrapper,
        ["--policy", policy, "--", request.command, ...request.args],
        request,
      );
      const marker = result.output
        .toString("utf8")
        .split("\n")
        .find((line) => line.startsWith("SHARDPASS_NETWORK_ATTEMPTS="));
      if (!marker) throw new Error("NETWORK_OBSERVATION_MISSING");
      let attempts;
      try {
        attempts = JSON.parse(Buffer.from(marker.slice(27), "base64url").toString("utf8"));
      } catch {
        throw new Error("NETWORK_ATTEMPT_INVALID");
      }
      return { ...result, attempts };
    },
  });
}

export function createPreloadIsolationAdapter({
  wrapperCommand,
  preloadPath,
  name = "process-wrapper-preload-v1",
  execute: executeFixture,
}) {
  if (
    typeof wrapperCommand !== "string" ||
    !wrapperCommand ||
    typeof preloadPath !== "string" ||
    !preloadPath ||
    typeof executeFixture !== "function"
  )
    throw new Error("NETWORK_ADAPTER_INVALID");
  return Object.freeze({
    capability: "os-network-isolation-v1",
    name,
    async run(request) {
      await readFile(preloadPath);
      return executeFixture(
        wrapperCommand,
        [
          "--network-policy",
          request.mode,
          "--preload",
          preloadPath,
          "--",
          request.command,
          ...request.args,
        ],
        request,
      );
    },
  });
}
