import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  findExecutablePolicyViolations,
  verifyInertContentEntry,
  verifyInertContentSource,
} from "../../tools/security/executable-policy";

const temporaryDirectories: string[] = [];

async function temporaryArtifact(name: string, content: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "shardpass-csp-"));
  temporaryDirectories.push(directory);
  await mkdir(dirname(join(directory, name)), { recursive: true });
  await writeFile(join(directory, name), content);
  return directory;
}

async function temporaryProjectArtifact(
  name: string,
  content: string,
): Promise<{
  dist: string;
  project: string;
}> {
  const project = await mkdtemp(join(tmpdir(), "shardpass-project-"));
  temporaryDirectories.push(project);
  const dist = join(project, "dist");
  await mkdir(dirname(join(dist, name)), { recursive: true });
  await writeFile(join(dist, name), content);
  return { dist, project };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("inert production content contract", () => {
  it.each([
    ["empty source", ""],
    ["comments", "// inert\n/* still inert */"],
    ["empty module marker", "// inert\nexport {};"],
  ])("accepts %s", (_label, source) => {
    expect(verifyInertContentSource(source)).toEqual([]);
  });

  it("does not misclassify the checked-in active controller bootstrap as inert", async () => {
    const source = await readFile(
      new URL("../../apps/extension/src/content/main.tsx", import.meta.url),
      "utf8",
    );
    expect(verifyInertContentSource(source)).not.toEqual([]);
  });

  it.each([
    ["source import", 'import "./helper";'],
    ["source declaration", "const ready = true;"],
    ["source statement", "document.body.dataset.ready = 'yes';"],
    ["source runtime reference", "chrome;"],
    ["source nonempty export", "export const ready = true;"],
  ])("rejects %s", (_label, source) => {
    expect(verifyInertContentSource(source)).toEqual(["non-inert-content-source"]);
  });

  it.each([
    ["current empty IIFE", "(function(){\n})()"],
    ["arrow empty IIFE", "(()=>{})();"],
    ["strict empty IIFE", '(function(){"use strict";})()'],
  ])("accepts %s", (_label, source) => {
    expect(verifyInertContentEntry(source)).toEqual([]);
  });

  it.each([
    ["DOM mutation", "document.body.textContent = 'changed';"],
    ["event listener", "addEventListener('click', () => {});"],
    ["runtime message", "chrome.runtime.sendMessage({ ready: true });"],
    ["storage access", "chrome.storage.local.get('value');"],
    ["declaration", "const ready = true;"],
    ["assignment", "globalThis.ready = true;"],
    ["nonempty IIFE", "(()=>{ document.body.remove(); })();"],
    ["imported helper", 'import "./helper.js";'],
    ["unknown directive", '(function(){"not strict";})()'],
  ])("rejects %s", (_label, source) => {
    expect(verifyInertContentEntry(source)).toEqual(["non-inert-content-entry"]);
  });
});

describe("production executable policy scanner", () => {
  it("allows the exact pinned protobuf registry shape only in the build-identified Google worker", async () => {
    const source =
      'const key = Symbol.for("@bufbuild/protobuf/text-encoding"); if (globalThis[key] == null) globalThis[key] = Object.freeze({ encodeUtf8() {} }); const value = globalThis[key];';
    const allowed = await temporaryArtifact("assets/google-worker.js", source);
    await writeFile(
      join(allowed, ".shardpass-executable-audit.json"),
      JSON.stringify({ version: 1, googleMigrationWorker: "assets/google-worker.js" }),
    );
    expect(await findExecutablePolicyViolations(allowed)).toEqual([]);

    const unrelated = await temporaryArtifact("assets/vault.js", source);
    await writeFile(
      join(unrelated, ".shardpass-executable-audit.json"),
      JSON.stringify({ version: 1, googleMigrationWorker: "assets/google-worker.js" }),
    );
    expect(await findExecutablePolicyViolations(unrelated)).toContainEqual(
      expect.objectContaining({
        file: "assets/vault.js",
        rule: "computed-global-dynamic-code-access",
      }),
    );
  });

  it("rejects altered count, symbols, aliases, invocation, and destructuring in the audited worker", async () => {
    const cases = [
      'const key = Symbol.for("@bufbuild/protobuf/text-encoding"); globalThis[key] = value;',
      'const key = Symbol.for("@bufbuild/protobuf/text-encoding"); globalThis[key]; globalThis[key]; globalThis[key]; globalThis[key];',
      'const key = Symbol.for("@bufbuild/protobuf/other"); globalThis[key] = value;',
      "const key = Symbol.for(name); globalThis[key] = value;",
      'const key = Symbol.for("@bufbuild/protobuf/text-encoding"); const alias = key; globalThis[alias]();',
      'const first = Symbol.for("@bufbuild/protobuf/text-encoding"); let second; second = first; globalThis[second]();',
      'const key = Symbol.for("@bufbuild/protobuf/text-encoding"); const { [key]: value } = globalThis;',
    ];
    for (const source of cases) {
      const directory = await temporaryArtifact("assets/google-worker.js", source);
      await writeFile(
        join(directory, ".shardpass-executable-audit.json"),
        JSON.stringify({ version: 1, googleMigrationWorker: "assets/google-worker.js" }),
      );
      expect(await findExecutablePolicyViolations(directory)).toContainEqual(
        expect.objectContaining({ rule: "computed-global-dynamic-code-access" }),
      );
    }
  });

  it("rejects a symlink supplied as the executable-policy root", async () => {
    const target = await temporaryArtifact("safe.js", "export {};");
    const holder = await mkdtemp(join(tmpdir(), "shardpass-executable-root-link-"));
    temporaryDirectories.push(holder);
    const linkedRoot = join(holder, "dist-link");
    await symlink(target, linkedRoot, "dir");

    await expect(findExecutablePolicyViolations(linkedRoot)).rejects.toThrow(
      /executable policy root.*non-symlink directory/iu,
    );
  });

  it("rejects executable traversal symlinks without following them", async () => {
    const directory = await temporaryArtifact("safe.js", "export {};");
    const outside = await temporaryArtifact("outside.js", 'Function("return true")()');
    await symlink(join(outside, "outside.js"), join(directory, "linked.js"));
    await symlink(outside, join(directory, "linked-directory"), "dir");

    const violations = await findExecutablePolicyViolations(directory);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: "linked.js", rule: "nonregular-executable-entry" }),
        expect.objectContaining({ file: "linked-directory", rule: "nonregular-executable-entry" }),
      ]),
    );
    expect(
      violations.some(
        ({ file, rule }) => file.includes("outside.js") && rule === "function-reference",
      ),
    ).toBe(false);
  });

  it.each([
    ["direct eval", 'eval("code")'],
    ["eval used as a value", "const values = [eval]"],
    ["optional eval call", 'eval?.("code")'],
    ["eval alias", 'const e = eval; e("code")'],
    ["eval alias chain", 'const e = eval; const run = e; run?.("code")'],
    ["globalThis eval", 'globalThis.eval("code")'],
    ["computed globalThis eval", 'globalThis["eval"]("code")'],
    ["computed nonliteral globalThis access", "globalThis[propertyName]"],
    ["destructured globalThis eval", 'const { eval: execute } = globalThis; execute("code")'],
    ["direct Function call", 'Function("return 1")'],
    ["Function used as a value", "export default Function"],
    ["direct Function constructor", 'new Function("return 1")'],
    ["optional Function call", 'Function?.("return 1")'],
    ["Function alias chain", 'const F = Function; const Factory = F; new Factory("return 1")'],
    ["globalThis Function", 'globalThis.Function("return 1")'],
    ["computed globalThis Function", 'new globalThis["Function"]("return 1")'],
    ["destructured global Function", 'const { Function: F } = globalThis; F("return 1")'],
    ["globalThis alias", 'const root = globalThis; root.Function("return 1")'],
    ["computed nonliteral globalThis alias access", "const root = globalThis; root[propertyName]"],
    [
      "globalThis alias chain",
      'const root = globalThis; const windowLike = root; windowLike.eval("x")',
    ],
    ["nested outer alias", 'const F = Function; { const local = F; new local("return 1"); }'],
    ["assignment from global", 'let F; F = Function; F("return 1")'],
    ["assignment alias chain", 'let F = Function; let G; G = F; new G("return 1")'],
    ["destructuring assignment", 'let F; ({ Function: F } = globalThis); F("return 1")'],
    ["ambiguous alias update", 'let F = Function; F++; F("return 1")'],
    ["alias reassigned ambiguously", 'let F = Function; F = maybeFactory; F("return 1")'],
    [
      "globalThis alias reassigned ambiguously",
      "let root = globalThis; root = safeObject; root.Function()",
    ],
    [
      "block exit restores global",
      '{ const Function = LocalFactory; new Function(); } Function("return 1")',
    ],
    [
      "nested shadow preserves outer alias",
      'const F = Function; { const F = safeFactory; F(); } new F("return 1")',
    ],
    [
      "conditional false reset cannot clear source",
      "let F = Function; if (false) F = safeFactory; F()",
    ],
    [
      "either conditional branch preserves dangerous source",
      "let F; if (condition) F = Function; else F = safeFactory; F()",
    ],
    ["loop body source", "let F = safeFactory; while (condition) F = Function; F()"],
    ["try source", "let F = safeFactory; try { F = Function; } catch {} F()"],
    ["catch source", "let F = safeFactory; try {} catch { F = Function; } F()"],
    ["finally source", "let F = safeFactory; try {} finally { F = Function; } F()"],
    [
      "uncalled nested function cannot clear outer source",
      "let F = Function; function neverCalled() { F = safeFactory; } F()",
    ],
    [
      "dangerous source in uncalled nested function",
      "let F = safeFactory; function neverCalled() { F = Function; }",
    ],
    ["repeated updates stay rejected", "let F = Function; F++; F++; F()"],
    [
      "later safe assignment cannot clear a Function source",
      "function safeFactory() {} let F = Function; F = safeFactory; F()",
    ],
    [
      "later safe assignment cannot clear a globalThis alias",
      "const safeObject = {}; let root = globalThis; root = safeObject; root.Function()",
    ],
    [
      "consumer function before later initializer dot access",
      "let root; function consume() { root.Function(); } function initialize() { root = globalThis; }",
    ],
    [
      "consumer function before later initializer computed access",
      'let root; function consume() { root["eval"](); } function initialize() { root = globalThis; }',
    ],
    [
      "alias chain across functions and textual order",
      "let root, middle, leaf; function consume() { leaf.Function(); } function connect() { leaf = middle; middle = root; } function initialize() { root = globalThis; }",
    ],
    [
      "computed destructuring declaration from globalThis",
      "const { [propertyName]: value } = globalThis",
    ],
    [
      "computed destructuring assignment from globalThis",
      "let value; ({ [propertyName]: value } = globalThis)",
    ],
    [
      "computed destructuring declaration from globalThis alias",
      "const root = globalThis; const { [propertyName]: value } = root",
    ],
    [
      "computed destructuring assignment from later globalThis alias",
      "let root, value; ({ [propertyName]: value } = root); function initialize() { root = globalThis; }",
    ],
  ])("rejects %s", async (_label, content) => {
    const directory = await temporaryArtifact("bad.js", content);
    await expect(findExecutablePolicyViolations(directory)).resolves.not.toEqual([]);
  });

  it.each([
    ["remote fetch", 'fetch("https://example.test/data")'],
    ["computed fetch", "fetch(destination)"],
    [
      "XMLHttpRequest open",
      'const request = new XMLHttpRequest(); request.open("GET", destination)',
    ],
    [
      "XMLHttpRequest alias open",
      'const request = new XMLHttpRequest(); const alias = request; alias.open("GET", "//example.test")',
    ],
    ["remote WebSocket", 'new WebSocket("wss://example.test/socket")'],
    ["computed EventSource", "new EventSource(destination)"],
    ["computed sendBeacon", "navigator.sendBeacon(destination, payload)"],
    [
      "remote Image constructor",
      'const image = new Image(); image.src = "https://example.test/pixel"',
    ],
    [
      "computed image alias",
      'const image = document.createElement("img"); const alias = image; alias.src = destination',
    ],
    [
      "remote image setAttribute",
      'const image = document.createElement("img"); image.setAttribute("src", "//example.test/pixel")',
    ],
    [
      "computed video source",
      'const video = document.createElement("video"); video.src = destination',
    ],
    [
      "remote audio alias",
      'const audio = document.createElement("audio"); const alias = audio; alias.setAttribute("src", "https://example.test/a.mp3")',
    ],
  ])("rejects network sink: %s", async (_label, content) => {
    const directory = await temporaryArtifact("bad.js", content);
    const violations = await findExecutablePolicyViolations(directory);
    expect(violations).toContainEqual(expect.objectContaining({ rule: "network-destination" }));
  });

  it.each([
    ["direct fetch alias", 'const request = fetch; request("https://example.test/data")'],
    [
      "multi-hop WebSocket declaration aliases",
      'const first = WebSocket; const second = first; new second("wss://example.test/socket")',
    ],
    [
      "EventSource assignment alias",
      'let stream; stream = EventSource; new stream("//example.test/events")',
    ],
    [
      "sendBeacon member alias",
      'const beacon = navigator.sendBeacon; beacon("https://example.test/collect", payload)',
    ],
    [
      "sendBeacon computed member alias",
      'const beacon = navigator["sendBeacon"]; beacon(destination, payload)',
    ],
    [
      "alias consumer before initializer",
      "let request; function consume() { request(destination); } function initialize() { request = fetch; }",
    ],
    [
      "alias chain across functions and textual order",
      'let first, second, third; function consume() { third("https://example.test/data"); } function connect() { third = second; second = first; } function initialize() { first = fetch; }',
    ],
    [
      "fetch provenance retained after reassignment",
      'let request = fetch; request = safeLocalFunction; request("https://example.test/data")',
    ],
    [
      "constructor provenance retained after reassignment",
      "let Socket = WebSocket; Socket = LocalSocket; new Socket(destination)",
    ],
  ])("rejects network sink alias: %s", async (_label, content) => {
    const directory = await temporaryArtifact("bad.js", content);
    const violations = await findExecutablePolicyViolations(directory);
    expect(violations).toContainEqual(expect.objectContaining({ rule: "network-destination" }));
  });

  it.each([
    ["comments and whitespace in import", 'import /* boundary */ "../../assets/legacy.js"'],
    ["export-from traversal", 'export { value }\nfrom "../../src/popup/../popup/index.html"'],
    ["static dynamic remote import", 'import("https://bad.test/code.js")'],
    ["protocol-relative dynamic import", 'import("//bad.test/code.js")'],
    ["computed dynamic import", 'const path = "./chunk.js"; import(path)'],
    ["template-computed dynamic import", "import(`./${name}.js`)"],
    ["arbitrary JavaScript escape", 'import "../../outside.js"'],
    ["arbitrary MJS escape", 'export * from "../../../outside.mjs"'],
    ["non-code escape", 'import data from "../../outside.json" with { type: "json" }'],
    ["mixed-dot escape", 'import "./inside/../../../outside.js"'],
    ["absolute POSIX path", 'import "/tmp/outside.js"'],
    ["absolute Windows path", 'import "C:\\\\outside\\\\module.js"'],
    ["Windows UNC path", 'import "\\\\\\\\server\\\\share\\\\module.js"'],
    ["Windows rooted backslash path", 'import "\\\\outside\\\\module.js"'],
    ["Windows extended device path", 'import "\\\\\\\\?\\\\C:\\\\outside\\\\module.js"'],
    ["dynamic local escape", 'import("../../outside.js")'],
  ])("rejects %s", async (_label, content) => {
    const directory = await temporaryArtifact("nested/bad.mjs", content);
    await expect(findExecutablePolicyViolations(directory)).resolves.not.toEqual([]);
  });

  it("uses legacy-source-import only for actual preserved targets", async () => {
    const { dist } = await temporaryProjectArtifact(
      "nested/bad.mjs",
      [
        'import "../../assets/legacy.js";',
        'import "../../service-worker-loader.js";',
        'import "../../src/popup/index.html";',
      ].join("\n"),
    );

    await expect(findExecutablePolicyViolations(dist)).resolves.toEqual([
      { file: "nested/bad.mjs", rule: "legacy-source-import" },
    ]);
  });

  it("does not classify unrelated matching suffixes as legacy", async () => {
    const { dist } = await temporaryProjectArtifact(
      "nested/bad.mjs",
      'import "../../../unrelated/assets/legacy.js"',
    );

    await expect(findExecutablePolicyViolations(dist)).resolves.toEqual([
      { file: "nested/bad.mjs", rule: "module-import-outside-dist" },
    ]);
  });

  it("classifies absolute actual legacy targets exactly", async () => {
    const { dist, project } = await temporaryProjectArtifact("bad.mjs", "export {};");
    await writeFile(
      join(dist, "bad.mjs"),
      [
        `import ${JSON.stringify(join(project, "assets/legacy.js"))};`,
        `import ${JSON.stringify(join(project, "service-worker-loader.js"))};`,
        `import ${JSON.stringify(join(project, "src/popup/index.html"))};`,
      ].join("\n"),
    );

    await expect(findExecutablePolicyViolations(dist)).resolves.toEqual([
      { file: "bad.mjs", rule: "legacy-source-import" },
    ]);
  });

  it.each([
    ["inline classic script", "<script>run()</script>"],
    ["inline module script", '<script type="module">run()</script>'],
    ["application ecmascript inline", '<script type="application/ecmascript">run()</script>'],
    ["text ecmascript inline", '<script type="text/ecmascript; charset=UTF-8">run()</script>'],
    [
      "legacy JS MIME inline",
      '<script type="Application/X-JavaScript ; charset=utf-8">run()</script>',
    ],
    ["unknown MIME inline fails closed", '<script type="application/custom-script">run()</script>'],
    ["remote script", '<script src="https://bad.test/code.js"></script>'],
    [
      "remote legacy MIME script",
      '<script type="text/jscript" src="https://bad.test/code.js"></script>',
    ],
    [
      "remote unknown MIME fails closed",
      '<script type="application/custom" src="//bad.test/code.js"></script>',
    ],
    ["protocol-relative script", '<script src="//bad.test/code.js"></script>'],
    ["remote module preload", '<link rel="modulepreload" href="https://bad.test/code.js">'],
    ["remote script preload", '<link rel="preload" as="script" href="//bad.test/code.js">'],
    ["remote style preload", '<link rel="preload" as="style" href="https://bad.test/x.css">'],
    ["remote stylesheet", '<link rel="stylesheet" href="https://bad.test/x.css">'],
    [
      "unsafe eval CSP",
      '<meta http-equiv="Content-Security-Policy" content="script-src \'unsafe-eval\'">',
    ],
    [
      "unsafe wasm CSP",
      '<meta http-equiv="Content-Security-Policy" content="script-src \'wasm-unsafe-eval\'">',
    ],
  ])("structurally rejects %s", async (_label, content) => {
    const directory = await temporaryArtifact("bad.html", content);
    await expect(findExecutablePolicyViolations(directory)).resolves.not.toEqual([]);
  });

  it.each([
    ["remote importScripts", 'importScripts("https://bad.test/worker")'],
    ["computed importScripts", "importScripts(workerUrl)"],
    ["remote Worker", 'new Worker("//bad.test/worker")'],
    ["computed Worker", "new Worker(workerUrl)"],
    ["remote SharedWorker", 'new SharedWorker("https://bad.test/shared")'],
    ["computed SharedWorker", "new SharedWorker(workerUrl)"],
    [
      "remote service worker registration",
      'navigator.serviceWorker.register("https://bad.test/sw")',
    ],
    ["computed service worker registration", "navigator.serviceWorker.register(workerUrl)"],
    [
      "remote script src assignment",
      'const script = document.createElement("script"); script.src = "https://bad.test/x"; document.head.append(script)',
    ],
    [
      "computed script src assignment",
      'const script = document.createElement("script"); script.src = scriptUrl; document.head.append(script)',
    ],
    [
      "remote script setAttribute",
      'const script = document.createElement("script"); script.setAttribute("src", "//bad.test/x"); document.head.append(script)',
    ],
    [
      "computed script setAttribute",
      'const script = document.createElement("script"); script.setAttribute("src", scriptUrl); document.head.append(script)',
    ],
    [
      "script alias",
      'const script = document.createElement("script"); const alias = script; alias.src = "https://bad.test/x"',
    ],
    [
      "script multi-hop alias",
      'const script = document.createElement("script"); const first = script; const second = first; second.src = scriptUrl',
    ],
    [
      "assignment-created script binding",
      'let script; script = document.createElement("script"); script.src = "//bad.test/x"',
    ],
    [
      "assignment alias chain",
      'let script, alias; script = document.createElement("script"); alias = script; alias.setAttribute("src", scriptUrl)',
    ],
    [
      "consumer before initializer",
      'let script; function consume() { script.src = "https://bad.test/x"; } function initialize() { script = document.createElement("script"); }',
    ],
    [
      "provenance retained after reassignment",
      'let script = document.createElement("script"); script = safeElement; script.src = scriptUrl',
    ],
  ])("rejects executable URL sink: %s", async (_label, content) => {
    const directory = await temporaryArtifact("bad.js", content);
    const violations = await findExecutablePolicyViolations(directory);
    expect(
      violations.some(({ rule }) =>
        /^(?:remote-executable-resource|computed-executable-url)$/u.test(rule),
      ),
    ).toBe(true);
  });

  it.each([
    ["member names", "parser.eval(); api.Function(); new api.Function()"],
    ["shadowed local Function", "function safe(Function) { return new Function(); }"],
    ["nested block shadow", "{ const Function = LocalFactory; new Function(); }"],
    ["declaration-order shadow", "Function('safe'); function Function() {}"],
    ["imported Function", 'import Function from "./factory.js"; Function()', ["factory.js"]],
    ["class shadow", "{ class Function {} new Function(); }"],
    ["catch shadow", "try {} catch (Function) { Function(); }"],
    ["for lexical shadow", "for (const Function of factories) { new Function(); }"],
    [
      "static safe computed global destructuring",
      'const { ["location"]: locationValue } = globalThis',
    ],
    [
      "computed destructuring from local declaration",
      "const local = {}; const { [propertyName]: value } = local",
    ],
    [
      "computed destructuring from local assignment",
      "const local = {}; let value; ({ [propertyName]: value } = local)",
    ],
    ["harmless prose", 'const text = "Function evaluation is prohibited"; export { text }'],
    [
      "static local import",
      'import value from "./local.js"; import("./chunk.js")',
      ["local.js", "chunk.js"],
    ],
    [
      "local packaged executable sinks",
      'importScripts("./worker"); new Worker("./worker"); new SharedWorker("./shared"); navigator.serviceWorker.register("./sw")',
      ["worker", "shared", "sw"],
    ],
    [
      "Vite local module Worker URL",
      'new Worker(new URL("./worker.js", import.meta.url), { type: "module" })',
      ["worker.js"],
    ],
    [
      "local packaged script element",
      'const script = document.createElement("script"); script.src = "./chunk"; document.head.append(script)',
      ["chunk"],
    ],
    [
      "shadowed executable globals",
      "function safe(importScripts, Worker, SharedWorker, navigator) { importScripts(url); new Worker(url); new SharedWorker(url); navigator.serviceWorker.register(url); }",
    ],
    [
      "local script-shaped object",
      'const document = { createElement() { return {}; }, head: { append() {} } }; const script = document.createElement("script"); script.src = value',
    ],
    [
      "shadowed document alias chain",
      'function safe(document) { const script = document.createElement("script"); const alias = script; alias.src = value; }',
    ],
    [
      "ordinary element alias",
      'const div = document.createElement("div"); const alias = div; alias.src = value',
    ],
    ["local relative fetch", 'fetch("./chunk.js")'],
    ["local absolute fetch", 'fetch("/assets/chunk.js")'],
    ["local relative fetch alias", 'const request = fetch; request("./chunk.js")'],
    [
      "local absolute constructor alias",
      'const Socket = WebSocket; const LocalSocket = Socket; new LocalSocket("/socket")',
    ],
    ["local sendBeacon alias", 'const beacon = navigator.sendBeacon; beacon("./collect", payload)'],
    [
      "local WebSocket-shaped constructor",
      "function safe(WebSocket) { new WebSocket(destination); }",
    ],
    ["shadowed fetch", "function safe(fetch) { fetch(destination); }"],
    [
      "shadowed fetch alias",
      "function safe(fetch) { const request = fetch; request(destination); }",
    ],
    [
      "imported fetch alias",
      'import { fetch as localFetch } from "safe-library"; const request = localFetch; request(destination)',
    ],
    [
      "shadowed constructor aliases",
      "function safe(WebSocket, EventSource) { const Socket = WebSocket; const Stream = EventSource; new Socket(destination); new Stream(destination); }",
    ],
    [
      "shadowed navigator member alias",
      "function safe(navigator) { const beacon = navigator.sendBeacon; beacon(destination); }",
    ],
    [
      "unrelated function alias",
      "const first = safeLocalFunction; const second = first; second(destination)",
    ],
    [
      "shadowed XMLHttpRequest",
      'function safe(XMLHttpRequest) { const request = new XMLHttpRequest(); request.open("GET", destination); }',
    ],
    ["shadowed navigator", "function safe(navigator) { navigator.sendBeacon(destination); }"],
    [
      "shadowed Image",
      "function safe(Image) { const image = new Image(); image.src = destination; }",
    ],
    [
      "shadowed document media",
      'function safe(document) { const video = document.createElement("video"); video.src = destination; }',
    ],
  ])("allows benign JavaScript: %s", async (_label, content, referencedFiles = []) => {
    const directory = await temporaryArtifact("safe.js", content);
    await Promise.all(
      referencedFiles.map((name) => writeFile(join(directory, name), "export {};")),
    );
    await expect(findExecutablePolicyViolations(directory)).resolves.toEqual([]);
  });

  it.each([
    ["remote image", '<img src="https://example.test/image.png">'],
    ["protocol-relative audio", '<audio src="//example.test/audio.mp3"></audio>'],
    ["remote video source", '<video><source src="https://example.test/video.mp4"></video>'],
    ["remote track", '<video><track src="//example.test/captions.vtt"></video>'],
    ["remote icon link", '<link rel="icon" href="https://example.test/icon.png">'],
    ["remote preload image", '<link rel="preload" as="image" href="//example.test/image.png">'],
  ])("rejects remote HTML resource: %s", async (_label, content) => {
    const directory = await temporaryArtifact("bad.html", content);
    const violations = await findExecutablePolicyViolations(directory);
    expect(violations).toContainEqual(expect.objectContaining({ rule: "remote-resource-url" }));
  });

  it.each([
    ["local external scripts", '<script type="module" src="./local.js"></script>', ["local.js"]],
    ["safe JSON metadata", '<script type="application/json">{"label":"safe"}</script>'],
    [
      "safe JSON case and parameters",
      '<script type=" Application/JSON ; charset=UTF-8 ">{"label":"safe"}</script>',
    ],
    ["safe local stylesheet", '<link rel="stylesheet" href="./local.css">'],
    ["safe local media", '<img src="./image.png"><audio src="/audio.mp3"></audio>'],
    ["safe data image", '<img src="data:image/png;base64,AA==">'],
    [
      "safe non-executable metadata",
      '<meta name="description" content="Function evaluation policy">',
    ],
  ])("allows benign HTML: %s", async (_label, content, referencedFiles = []) => {
    const directory = await temporaryArtifact("safe.html", content);
    await Promise.all(
      referencedFiles.map((name) => writeFile(join(directory, name), "export {};")),
    );
    await expect(findExecutablePolicyViolations(directory)).resolves.toEqual([]);
  });
});
