import { createHash } from "node:crypto";
import { access, lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parse } from "acorn";
import { parse as parseHtml } from "parse5";

import { findExecutablePolicyViolations } from "../tools/security/executable-policy.ts";
import { verifyApprovedSodiumIdentity } from "./ente-sodium-wasm-inventory.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const executableRemoteUrl = /^(?:https?:)?\/\//iu;
const sourceMapReference = /(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL\s*=/u;
const forbiddenConsoleMethod =
  /\bconsole\s*(?:\.\s*(?:log|debug|info)\b|\[\s*["'](?:log|debug|info)["']\s*\])/u;
// error and warn as well, everywhere ShardPass's own code ends up. They are not forbidden in
// the third-party bundles below, which log on their own account and cannot be edited here.
const forbiddenConsoleReport =
  /\bconsole\s*(?:\.\s*(?:error|warn|trace|table|dir)\b|\[\s*["'](?:error|warn|trace|table|dir)["']\s*\])/u;
/** Vendored bundles whose own logging is not ShardPass's to remove (React DOM, libsodium). */
const vendorLoggingChunk =
  /^assets\/(?:client|react-dom|libsodium(?:-wrappers)?(?:-sumo)?)-[\w-]+\.js$/u;
// A bare `console` identifier, but not the word inside a string literal: the passphrase
// wordlist bundled with the password generator contains "console".
const rawConsoleReference = /(?<!["'`])\bconsole\b(?!\s*(?:\.|\[|["'`]))/u;
const legacyName =
  /(?:_commonjsHelpers-BNVkcQi_|detect-GJf8O2wT|format-BF4VSr4S|index\.html-XjjvDkko|index\.ts-BbWVF1-a|index\.ts-DTcWtSwh|index\.ts-loader-BWnrBa67|index-wA3AHzJ-|log-B-C8fiGH)/u;
const testArtifactPath =
  /(?:^|[/_.-])(?:__tests__|tests?|fixtures?|picker-harness|test-harness|vitest|playwright)(?:$|[/_.-])/iu;
// Module names, not the English word "playwright": the strength worker ships a dictionary.
const testHarnessText =
  /(?:picker-harness|test-harness|tests\/fixtures|__tests__|@playwright\/|playwright\/test|playwright-core|vitest)/iu;
const cryptoTestArtifact =
  /(?:crypto-smoke|__shardpassRunDefaultArgon2idBenchmark|ShardPass browser benchmark|runDefaultArgon2idBenchmark|createVaultKeyMaterialForTesting|packages\/crypto\/test\/compatibility-fixture|synthetic separate backup password|JBSWY3DPEHPK3PXP|TEST-ONLY ShardPass fixture password|srp-(?:legacy-1\.2\.1|current-pin)-transcript|expected(?:A|M1|M2|SessionKey)Hex|clientPrivateHex|serverPrivateHex|sodium-wire-vectors)/u;
const textExtensions = new Set([".css", ".html", ".js", ".json", ".mjs", ".svg", ".txt"]);
const environmentFile = /^\.env(?:\..+)?$/u;
const environmentFilenameText = /(?:^|["'`/\\])\.env(?:\.[A-Za-z\d_.-]+)?(?:$|["'`/\\])/u;
const allowedManifestKeys = new Set([
  "action",
  "background",
  // Shortcut names only; the manifest test pins which commands exist and what each does.
  "commands",
  "content_scripts",
  "content_security_policy",
  "description",
  // Harmless optional metadata; it is not an executable root.
  "homepage_url",
  "host_permissions",
  "manifest_version",
  "minimum_chrome_version",
  "name",
  "options_page",
  "permissions",
  "short_name",
  "version",
  // CRXJS generates this solely for the reviewed inert content-script asset.
  "web_accessible_resources",
]);
const executableManifestFields = new Set([
  "options_ui",
  "devtools_page",
  "side_panel",
  "chrome_url_overrides",
  "sandbox",
  "newtab",
]);
const nestedManifestKeys = {
  action: new Set(["default_popup", "default_title"]),
  background: new Set(["service_worker", "type"]),
  content_script: new Set(["all_frames", "js", "matches", "run_at", "world"]),
  content_security_policy: new Set(["extension_pages"]),
  web_accessible_resource: new Set(["matches", "resources", "use_dynamic_url"]),
};

const legacyHashes = new Map([
  ["manifest.json", "12c29933707cd477ee3d65de4dc28e0587af19480df267fa922245412a307245"],
  ["service-worker-loader.js", "3be8c6948af2def24d89286022d5867b3f2f963f829a1e089fe131e3e1f4be2d"],
  ["src/popup/index.html", "8d65ec7998e6fa021963b8ac1bc92c039f644f3a0eefbed7885a0d48fcf006ee"],
  [
    "assets/_commonjsHelpers-BNVkcQi_.js",
    "ca911bd3a8b2f04bc231a59dba4f656ec0e7b29e432804b6b249a283d51563ba",
  ],
  ["assets/detect-GJf8O2wT.js", "785c921939c4249fdfbe0ce92f214f54494b93b78628ad57671b3724c2c9cf36"],
  ["assets/format-BF4VSr4S.js", "08251bf5f3286f24fa68b96e469c538ca9d0552a3eada4f45173796c38d0a687"],
  [
    "assets/icon-32-Cil8P8kB.png",
    "1167f7d8ca3516116a199daa7d91c5ccd4e611dda320e4643964df16d65908af",
  ],
  [
    "assets/index.html-XjjvDkko.js",
    "9fb38722ba7d7ed8e0d78376b85241f5efb32240cd876fa19235f30855da7a59",
  ],
  [
    "assets/index.ts-BbWVF1-a.js",
    "445d9283f9cc0ab5c0a71d6c3a2d490b76ef98a81f690322ca39c0e329f42bf0",
  ],
  [
    "assets/index.ts-DTcWtSwh.js",
    "8ffc2951f8aabcc36a244ea1d5e22002b81945e1baa9ccd68bd0da58e464c243",
  ],
  [
    "assets/index.ts-loader-BWnrBa67.js",
    "67b431071413419e08721f0918a38b107db3f200b98f62a2d8ff6a37c1bfb811",
  ],
  ["assets/index-wA3AHzJ-.css", "95530ea809c8e174f7d0b47b736d33363a78a74487b409fc51afcead7bee2804"],
  ["assets/log-B-C8fiGH.js", "68e1f267b4a7202bcdfeace44f7f3fbcb599b23b0df047700475011fcf202e62"],
  ["icons/icon-128.png", "7cd25938d541034600c622f9c580cb0e2eadb772c941182bfb4ba6c7274bcf2c"],
  ["icons/icon-16.png", "7b2586fad0850426f6fbfd6ecb8a4c3c7f37140b0d7cd7576b90307117acb170"],
  ["icons/icon-32.png", "1167f7d8ca3516116a199daa7d91c5ccd4e611dda320e4643964df16d65908af"],
  ["icons/icon-48.png", "f904fad73e4c8bdd14dbf540fa65dd0a8ea560cdb99c39a0e09da047b83fb233"],
]);

/** Chunks whose network destinations are checked by host instead (see the loop below). */
function approvedNetworkSinkFile(relative) {
  return (
    /^assets\/ente-auth-worker-entry(?:-[\w-]+)?\.js$/u.test(relative) ||
    /^assets\/main\.ts-[\w-]+\.js$/u.test(relative)
  );
}

/** The hosts of every absolute http(s)/ws(s) URL in a bundle. */
function networkHosts(source) {
  const hosts = new Set();
  for (const match of source.matchAll(/(?:https?|wss?):\/\/([A-Za-z\d._-]+)/giu)) {
    const host = match[1]?.toLowerCase();
    if (host !== undefined && host !== "") hosts.add(host);
  }
  return hosts;
}

/** Where a shipped bundle may talk to: the hosts the extension pages' CSP connect-src names. */
const allowedConnectHosts = new Set([
  "api.ente.io",
  "api.pwnedpasswords.com",
  "quack.duckduckgo.com",
]);

function localJavaScriptDependencies(source, importer) {
  const dependencies = new Set();
  let program;
  try {
    program = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  } catch {
    return dependencies;
  }
  const addReference = (value, runtimeUrl = false) => {
    if (typeof value !== "string" || executableRemoteUrl.test(value.trim())) return;
    const clean = value.split(/[?#]/u, 1)[0];
    const resolved = runtimeUrl
      ? path.posix.normalize(clean.replace(/^\//u, ""))
      : path.posix.normalize(path.posix.join(path.posix.dirname(importer), clean));
    if (resolved.endsWith(".js") && !resolved.startsWith("../")) dependencies.add(resolved);
  };
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (
      (node.type === "ImportDeclaration" ||
        node.type === "ExportNamedDeclaration" ||
        node.type === "ExportAllDeclaration") &&
      node.source?.type === "Literal"
    ) {
      addReference(node.source.value);
    } else if (node.type === "ImportExpression" && node.source?.type === "Literal") {
      addReference(node.source.value);
    } else if (
      node.type === "CallExpression" &&
      node.callee?.type === "MemberExpression" &&
      node.callee.computed === false &&
      node.callee.property?.type === "Identifier" &&
      node.callee.property.name === "getURL" &&
      node.callee.object?.type === "MemberExpression" &&
      node.callee.object.computed === false &&
      node.callee.object.object?.type === "Identifier" &&
      node.callee.object.object.name === "chrome" &&
      node.callee.object.property?.type === "Identifier" &&
      node.callee.object.property.name === "runtime" &&
      node.arguments?.length === 1 &&
      node.arguments[0]?.type === "Literal"
    ) {
      addReference(node.arguments[0].value, true);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  };
  visit(program);
  return dependencies;
}

async function contentDependencyClosure(dist, contentEntry) {
  const dependencies = new Set();
  const pending = [contentEntry];
  const examined = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    if (examined.has(current)) continue;
    examined.add(current);
    let source;
    try {
      source = await readFile(path.join(dist, current), "utf8");
    } catch {
      continue;
    }
    for (const dependency of localJavaScriptDependencies(source, current)) {
      if (dependency === contentEntry || dependencies.has(dependency)) continue;
      dependencies.add(dependency);
      pending.push(dependency);
    }
  }
  return dependencies;
}

async function requireRealDirectory(directory, label) {
  const metadata = await lstat(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`${label} must be a real non-symlink directory: ${directory}`);
  }
}

async function buildEntriesRecursively(directory, root = directory) {
  if (directory === root) await requireRealDirectory(directory, "Build root");
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  const violations = [];
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
      add(violations, root, candidate, "nonregular-build-entry");
    } else if (metadata.isDirectory()) {
      const nested = await buildEntriesRecursively(candidate, root);
      files.push(...nested.files);
      violations.push(...nested.violations);
    } else {
      files.push(candidate);
    }
  }
  return { files, violations };
}

async function filesRecursively(directory) {
  return (await buildEntriesRecursively(directory)).files;
}

function add(violations, root, file, rule) {
  violations.push({ file: path.relative(root, file).split(path.sep).join("/"), rule });
}

function htmlReferences(source) {
  const references = [];
  const visit = (node) => {
    const attributes = new Map(
      (node.attrs ?? []).map(({ name, value }) => [name.toLowerCase(), value]),
    );
    if (node.tagName === "script" && attributes.has("src")) references.push(attributes.get("src"));
    if (node.tagName === "link" && attributes.has("href")) references.push(attributes.get("href"));
    node.childNodes?.forEach(visit);
  };
  visit(parseHtml(source));
  return references.filter((value) => typeof value === "string");
}

function manifestReferences(manifest) {
  const references = [];
  const addValue = (value) => {
    if (typeof value === "string") references.push(value);
    if (Array.isArray(value)) value.forEach(addValue);
  };
  addValue(manifest.action?.default_popup);
  addValue(manifest.options_page);
  addValue(manifest.background?.service_worker);
  for (const entry of manifest.content_scripts ?? []) {
    addValue(entry.js);
    addValue(entry.css);
  }
  for (const entry of manifest.web_accessible_resources ?? []) addValue(entry.resources);
  for (const icons of [manifest.icons, manifest.action?.default_icon]) {
    if (icons && typeof icons === "object") Object.values(icons).forEach(addValue);
  }
  return references;
}

async function environmentValues(root) {
  const values = new Set();
  for (const file of await filesRecursively(root)) {
    const relative = path.relative(root, file);
    if (
      relative.split(path.sep).includes("node_modules") ||
      !environmentFile.test(path.basename(file))
    )
      continue;
    const source = await readFile(file, "utf8");
    for (const line of source.split(/\r?\n/u)) {
      const match = /^\s*(?:export\s+)?[A-Za-z_][A-Za-z\d_]*\s*=\s*(.*)\s*$/u.exec(line);
      const value = match?.[1]?.trim().replace(/^(?:"(.*)"|'(.*)')$/u, "$1$2");
      if (value && value.length >= 4) values.add(value);
    }
  }
  return values;
}

async function legacyActualPaths(root, violations) {
  const paths = ["manifest.json", "service-worker-loader.js", "src/popup/index.html"];
  const walk = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      const metadata = await lstat(candidate);
      const relative = path.relative(root, candidate).split(path.sep).join("/");
      paths.push(relative);
      if (metadata.isSymbolicLink()) {
        add(violations, root, candidate, "legacy-artifact-symlink");
      } else if (metadata.isDirectory()) {
        await walk(candidate);
      } else if (!metadata.isFile()) {
        add(violations, root, candidate, "legacy-artifact-not-regular");
      }
    }
  };
  for (const directory of ["assets", "icons"]) await walk(path.join(root, directory));
  return new Set(paths);
}

export async function verifyLegacyArtifact(root, expected = legacyHashes) {
  const violations = [];
  const resolvedRoot = path.resolve(root);
  const ancestorPaths = ["", "assets", "icons", "src", "src/popup"];
  let ancestorsValid = true;
  for (const name of ancestorPaths) {
    const candidate = path.join(resolvedRoot, name);
    let metadata;
    try {
      metadata = await lstat(candidate);
    } catch {
      add(violations, resolvedRoot, candidate, "legacy-artifact-ancestor-missing");
      ancestorsValid = false;
      continue;
    }
    if (metadata.isSymbolicLink()) {
      add(violations, resolvedRoot, candidate, "legacy-artifact-ancestor-symlink");
      ancestorsValid = false;
    } else if (!metadata.isDirectory()) {
      add(violations, resolvedRoot, candidate, "legacy-artifact-ancestor-not-directory");
      ancestorsValid = false;
    }
  }
  if (!ancestorsValid)
    return violations.sort((a, b) => `${a.file}:${a.rule}`.localeCompare(`${b.file}:${b.rule}`));
  const expectedPaths = new Set(expected.keys());
  const actualPaths = await legacyActualPaths(resolvedRoot, violations);
  for (const name of actualPaths) {
    if (!expectedPaths.has(name))
      add(violations, root, path.join(root, name), "legacy-artifact-unexpected");
  }
  for (const [name, expectedHash] of expected) {
    const file = path.join(root, name);
    let metadata;
    try {
      metadata = await lstat(file);
    } catch {
      add(violations, root, file, "legacy-artifact-missing");
      continue;
    }
    if (metadata.isSymbolicLink()) {
      add(violations, root, file, "legacy-artifact-symlink");
      continue;
    }
    if (!metadata.isFile()) {
      add(violations, root, file, "legacy-artifact-not-regular");
      continue;
    }
    const actualHash = createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
    if (actualHash !== expectedHash) add(violations, root, file, "legacy-artifact-checksum");
  }
  return violations.sort((a, b) => `${a.file}:${a.rule}`.localeCompare(`${b.file}:${b.rule}`));
}

export async function scanBuild(directory, options = {}) {
  const root = path.resolve(options.projectRoot ?? path.dirname(path.resolve(directory)));
  const dist = path.resolve(directory);
  const outputEntries = await buildEntriesRecursively(dist);
  const violations = [...outputEntries.violations];
  const files = outputEntries.files;
  const relativeFiles = new Set(
    files.map((file) => path.relative(dist, file).split(path.sep).join("/")),
  );
  const envValues = await environmentValues(root);

  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(dist, "manifest.json"), "utf8"));
  } catch {
    add(violations, dist, path.join(dist, "manifest.json"), "manifest-missing-or-invalid");
  }

  const sodiumContainingFiles = [];
  let approvedSodiumContainingFile;
  for (const file of files) {
    const relative = path.relative(dist, file).split(path.sep).join("/");
    if (
      file.endsWith(".map") ||
      sourceMapReference.test(await readFile(file, "utf8").catch(() => ""))
    ) {
      add(violations, dist, file, "source-map");
    }
    if (
      environmentFile.test(path.basename(file)) ||
      legacyName.test(relative) ||
      testArtifactPath.test(relative)
    ) {
      add(
        violations,
        dist,
        file,
        environmentFile.test(path.basename(file))
          ? "environment-file"
          : legacyName.test(relative)
            ? "legacy-artifact-name"
            : "test-artifact",
      );
    }
    if (cryptoTestArtifact.test(relative)) add(violations, dist, file, "crypto-test-artifact");
    if (!textExtensions.has(path.extname(file).toLowerCase())) continue;
    const source = await readFile(file, "utf8");
    if (source.includes("AGFzbQE")) sodiumContainingFiles.push({ file, source });
    if (cryptoTestArtifact.test(source)) add(violations, dist, file, "crypto-test-artifact");
    if ([".js", ".mjs"].includes(path.extname(file).toLowerCase()) && !source.includes("AGFzbQE")) {
      if (forbiddenConsoleMethod.test(source) || rawConsoleReference.test(source))
        add(violations, dist, file, "console-transport");
      else if (!vendorLoggingChunk.test(relative) && forbiddenConsoleReport.test(source))
        add(violations, dist, file, "console-transport");
    }
    if (legacyName.test(source)) add(violations, dist, file, "legacy-artifact-reference");
    if (testHarnessText.test(source)) add(violations, dist, file, "test-harness-reference");
    if (environmentFilenameText.test(source)) add(violations, dist, file, "environment-filename");
    for (const value of envValues)
      if (source.includes(value)) add(violations, dist, file, "environment-value");
    if (
      path.extname(file) === ".css" &&
      /(?:@import\s+|url\(\s*["']?)(?:https?:)?\/\//iu.test(source)
    )
      add(violations, dist, file, "remote-style-resource");
    if (path.extname(file).toLowerCase() === ".html") {
      for (const reference of htmlReferences(source)) {
        if (executableRemoteUrl.test(reference.trim())) continue;
        const referencePath = reference.split(/[?#]/u, 1)[0];
        const resolved = referencePath.startsWith("/")
          ? path.posix.normalize(referencePath.slice(1))
          : path.posix.normalize(path.posix.join(path.posix.dirname(relative), referencePath));
        if (!relativeFiles.has(resolved)) add(violations, dist, file, "missing-local-reference");
      }
    }
  }

  if (root === projectRoot)
    try {
      const approved = JSON.parse(
        await readFile(path.join(root, "tests/fixtures/ente/sodium-wasm-approved.json"), "utf8"),
      );
      const installedSodiumSource = await readFile(
        path.join(
          root,
          "node_modules/.pnpm/libsodium-sumo@0.8.0/node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs",
        ),
        "utf8",
      );
      verifyApprovedSodiumIdentity(installedSodiumSource, approved, "installed");
      const approvedPackaged = [];
      for (const candidate of sodiumContainingFiles) {
        try {
          verifyApprovedSodiumIdentity(candidate.source, approved, "packaged");
          approvedPackaged.push(candidate);
        } catch {
          // Shared chunks may retain only a short payload marker; they are not containing modules.
        }
      }
      if (approvedPackaged.length !== 1) {
        add(violations, dist, dist, "libsodium-containing-module-count");
      } else {
        approvedSodiumContainingFile = approvedPackaged[0].file;
      }
    } catch {
      add(violations, dist, sodiumContainingFiles[0]?.file ?? dist, "libsodium-wasm-identity");
    }

  if (manifest) {
    const manifestFile = path.join(dist, "manifest.json");
    for (const key of Object.keys(manifest)) {
      if (executableManifestFields.has(key)) {
        add(violations, dist, manifestFile, "unapproved-manifest-executable-field");
      } else if (!allowedManifestKeys.has(key)) {
        add(violations, dist, manifestFile, "unapproved-manifest-key");
      }
    }
    const checkNestedKeys = (value, allowed) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) add(violations, dist, manifestFile, "unapproved-manifest-key");
      }
    };
    checkNestedKeys(manifest.action, nestedManifestKeys.action);
    checkNestedKeys(manifest.background, nestedManifestKeys.background);
    checkNestedKeys(manifest.content_security_policy, nestedManifestKeys.content_security_policy);
    if (Array.isArray(manifest.content_scripts)) {
      for (const entry of manifest.content_scripts)
        checkNestedKeys(entry, nestedManifestKeys.content_script);
    }

    // Two entries are expected: the isolated-world content script and the passkey page
    // script, which runs in the page's main world and is held to an exact shape below.
    const allContentScripts = Array.isArray(manifest.content_scripts)
      ? manifest.content_scripts
      : [];
    const isPasskeyPageEntry = (entry) =>
      entry !== null &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      Object.keys(entry).sort().join(",") === "all_frames,js,matches,run_at,world" &&
      Array.isArray(entry.matches) &&
      entry.matches.length === 1 &&
      entry.matches[0] === "<all_urls>" &&
      Array.isArray(entry.js) &&
      entry.js.length === 1 &&
      entry.js[0] === "assets/passkey-page.js" &&
      entry.run_at === "document_start" &&
      entry.all_frames === true &&
      entry.world === "MAIN";
    const passkeyEntries = allContentScripts.filter(isPasskeyPageEntry);
    if (
      passkeyEntries.length > 1 ||
      allContentScripts.some((entry) => entry?.world !== undefined && !isPasskeyPageEntry(entry))
    )
      add(violations, dist, manifestFile, "generated-content-contract");
    const contentScripts = allContentScripts.filter((entry) => !isPasskeyPageEntry(entry));
    const contentEntry =
      Array.isArray(contentScripts) && contentScripts.length === 1 ? contentScripts[0] : null;
    const contentJs =
      contentEntry && Array.isArray(contentEntry.js) && contentEntry.js.length === 1
        ? contentEntry.js[0]
        : null;
    const exactContentEntry =
      contentEntry !== null &&
      typeof contentEntry === "object" &&
      !Array.isArray(contentEntry) &&
      Object.keys(contentEntry).sort().join(",") === "all_frames,js,matches,run_at" &&
      Array.isArray(contentEntry.matches) &&
      contentEntry.matches.length === 1 &&
      contentEntry.matches[0] === "<all_urls>" &&
      Array.isArray(contentEntry.js) &&
      contentEntry.js.length === 1 &&
      new Set(contentEntry.js).size === contentEntry.js.length &&
      typeof contentJs === "string" &&
      contentJs.trim().length > 0 &&
      !executableRemoteUrl.test(contentJs.trim()) &&
      contentEntry.run_at === "document_idle" &&
      contentEntry.all_frames === true;
    if (!exactContentEntry) {
      add(violations, dist, manifestFile, "generated-content-contract");
    }
    const sourceContentFile = path.join(root, "apps", "extension", "src", "content", "main.tsx");
    try {
      const sourceMetadata = await lstat(sourceContentFile);
      const source = await readFile(sourceContentFile, "utf8");
      if (
        !sourceMetadata.isFile() ||
        sourceMetadata.isSymbolicLink() ||
        !source.includes("createOtpFillController") ||
        !source.includes("createChromePlatform") ||
        /fetch\s*\(|XMLHttpRequest|WebSocket|clipboard|mediaDevices|console\./u.test(source)
      ) {
        add(violations, root, sourceContentFile, "active-content-source-contract");
      }
    } catch {
      // A standalone artifact scan may not have a source tree; output policy is audited separately.
    }
    const wars = manifest.web_accessible_resources;
    const war = Array.isArray(wars) && wars.length === 1 ? wars[0] : null;
    const expectedWarResources =
      typeof contentJs === "string" ? await contentDependencyClosure(dist, contentJs) : new Set();
    const warResources = Array.isArray(war?.resources) ? war.resources : [];
    const exactWar =
      typeof contentJs === "string" &&
      war !== null &&
      typeof war === "object" &&
      !Array.isArray(war) &&
      Object.keys(war).sort().join(",") === "matches,resources,use_dynamic_url" &&
      warResources.length > 0 &&
      new Set(warResources).size === warResources.length &&
      warResources.every(
        (resource) =>
          typeof resource === "string" &&
          /^assets\/[\w.-]+\.js$/u.test(resource) &&
          resource !== contentJs &&
          expectedWarResources.has(resource),
      ) &&
      warResources.length === expectedWarResources.size &&
      Array.isArray(war.matches) &&
      war.matches.length === 1 &&
      war.matches[0] === "<all_urls>" &&
      war.use_dynamic_url === false;
    if (!exactWar) add(violations, dist, manifestFile, "generated-war-contract");
    if (Array.isArray(wars)) {
      for (const entry of wars) checkNestedKeys(entry, nestedManifestKeys.web_accessible_resource);
    }

    // `import()` is disallowed in a ServiceWorkerGlobalScope by the HTML specification, so a
    // lazily loaded module in the background never loads at all: the feature behind it simply
    // reports itself unavailable. Everything the worker reaches must be statically imported.
    const workerEntry = manifest.background?.service_worker;
    if (typeof workerEntry === "string") {
      const graph = new Set([workerEntry, ...(await contentDependencyClosure(dist, workerEntry))]);
      for (const relative of graph) {
        const source = await readFile(path.join(dist, relative), "utf8").catch(() => "");
        if (/(?:^|[^.\w$])import\s*\(/u.test(source))
          add(violations, dist, path.join(dist, relative), "service-worker-dynamic-import");
      }
    }

    const executableReferences = [];
    const addExecutable = (value, type = "javascript") => {
      if (typeof value !== "string" || executableRemoteUrl.test(value.trim())) return;
      const reference = value.split(/[?#]/u, 1)[0];
      executableReferences.push({ file: path.resolve(dist, reference), type });
    };
    addExecutable(manifest.background?.service_worker);
    if (Array.isArray(manifest.content_scripts)) {
      for (const entry of manifest.content_scripts) {
        if (Array.isArray(entry?.js)) entry.js.forEach(addExecutable);
      }
    }
    addExecutable(manifest.action?.default_popup, "html");
    addExecutable(manifest.options_page, "html");
    // The background and the Ente worker build their request URLs at run time, so the
    // policy rule cannot read a destination out of them. Every absolute URL they do carry is
    // checked against the hosts the CSP allows instead, so a new destination is reported.
    for (const file of await filesRecursively(dist)) {
      const relative = path.relative(dist, file).split(path.sep).join("/");
      if (!approvedNetworkSinkFile(relative)) continue;
      const source = await readFile(file, "utf8");
      for (const host of networkHosts(source))
        if (!allowedConnectHosts.has(host))
          add(violations, dist, file, `network-destination-host:${host}`);
    }
    for (const violation of await findExecutablePolicyViolations(dist, executableReferences)) {
      const approvedNetworkSink =
        violation.rule === "network-destination" && approvedNetworkSinkFile(violation.file);
      if (
        approvedNetworkSink ||
        (approvedSodiumContainingFile &&
          path.resolve(dist, violation.file) === path.resolve(approvedSodiumContainingFile) &&
          violation.rule === "network-destination")
      )
        continue;
      violations.push(violation);
    }

    const sourceContract = {
      manifest_version: 3,
      minimum_chrome_version: "111",
      permissions: [
        "storage",
        "unlimitedStorage",
        "alarms",
        "idle",
        "activeTab",
        "contextMenus",
        "favicon",
      ],
      host_permissions: ["https://api.ente.io/*", "https://quack.duckduckgo.com/*"],
      content_security_policy: {
        extension_pages:
          "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' https://api.ente.io https://api.pwnedpasswords.com https://quack.duckduckgo.com; img-src 'self' data:; media-src 'self'; font-src 'self'; style-src 'self'",
      },
    };
    for (const [key, expected] of Object.entries(sourceContract)) {
      if (JSON.stringify(manifest[key]) !== JSON.stringify(expected))
        add(violations, dist, path.join(dist, "manifest.json"), "manifest-source-contract");
    }
    for (const forbidden of ["optional_host_permissions", "externally_connectable"]) {
      if (forbidden in manifest)
        add(violations, dist, path.join(dist, "manifest.json"), "manifest-source-contract");
    }
    for (const reference of manifestReferences({
      ...manifest,
      content_scripts: Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [],
      web_accessible_resources: Array.isArray(manifest.web_accessible_resources)
        ? manifest.web_accessible_resources
        : [],
    })) {
      if (executableRemoteUrl.test(reference.trim())) {
        add(
          violations,
          dist,
          path.join(dist, "manifest.json"),
          "remote-manifest-executable-reference",
        );
      } else if (!relativeFiles.has(reference.split(/[?#]/u, 1)[0])) {
        add(violations, dist, path.join(dist, "manifest.json"), "missing-local-reference");
      }
    }
    if (Array.isArray(manifest.web_accessible_resources))
      for (const entry of manifest.web_accessible_resources) {
        if (!Array.isArray(entry?.resources)) continue;
        for (const resource of entry.resources) {
          const expectedContentResource =
            exactWar && typeof resource === "string" && /^assets\/[\w.-]+\.js$/u.test(resource);
          if (
            !expectedContentResource ||
            testArtifactPath.test(resource) ||
            /picker/iu.test(resource)
          ) {
            add(
              violations,
              dist,
              path.join(dist, "manifest.json"),
              "unexpected-web-accessible-resource",
            );
          }
        }
      }
  }

  if (root === projectRoot) violations.push(...(await verifyLegacyArtifact(root)));
  return violations.sort((a, b) => `${a.file}:${a.rule}`.localeCompare(`${b.file}:${b.rule}`));
}

async function main() {
  const directory = path.resolve(process.argv[2] ?? path.join(projectRoot, "dist"));
  try {
    await access(directory);
    const violations = await scanBuild(directory, { projectRoot });
    if (violations.length > 0) {
      for (const violation of violations) console.error(`${violation.file}: ${violation.rule}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Build scan passed: ${directory}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await main();
