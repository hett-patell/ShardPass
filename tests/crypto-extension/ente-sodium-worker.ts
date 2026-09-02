const APPROVED_WASM_SHA256 = "b15a381270ba8869e3a6b91d45e5a6439370c769e25ceef78aee9439f791d18f";
const APPROVED_IMPORTS_SHA256 = "a5b5390f62925cc37c84edcd2117ddea27bc88b41c3f1cd143473be2744fe64d";
const APPROVED_EXPORTS_SHA256 = "65af216ac8a046ac32237abc6c7eaa56af9be1ce03918b449e622515d573a0a6";

const hex = (value: ArrayBuffer): string =>
  Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
const digest = async (value: BufferSource | string): Promise<string> =>
  hex(
    await crypto.subtle.digest(
      "SHA-256",
      typeof value === "string" ? new TextEncoder().encode(value) : value,
    ),
  );
const sorted = <T extends object>(values: T[]): T[] =>
  values.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

const originalInstantiate = WebAssembly.instantiate;
let observedIdentity:
  Promise<Readonly<{ wasm: string; imports: string; exports: string }>> | undefined;
WebAssembly.instantiate = (async (
  source: BufferSource | WebAssembly.Module,
  imports?: WebAssembly.Imports,
) => {
  if (!(source instanceof WebAssembly.Module)) {
    const bytes = Uint8Array.from(new Uint8Array(source as ArrayBuffer));
    const module = new WebAssembly.Module(bytes);
    observedIdentity = Promise.all([
      digest(bytes),
      digest(JSON.stringify(sorted(WebAssembly.Module.imports(module)))),
      digest(JSON.stringify(sorted(WebAssembly.Module.exports(module)))),
    ]).then(([wasm, imported, exported]) => ({ wasm, imports: imported, exports: exported }));
  }
  return originalInstantiate(source as BufferSource, imports);
}) as typeof WebAssembly.instantiate;

void import("../../apps/extension/node_modules/libsodium-wrappers-sumo").then(
  async ({ default: sodium }) => {
    await sodium.ready;
    const identity = await observedIdentity;
    if (
      !identity ||
      identity.wasm !== APPROVED_WASM_SHA256 ||
      identity.imports !== APPROVED_IMPORTS_SHA256 ||
      identity.exports !== APPROVED_EXPORTS_SHA256
    )
      throw new Error("Ente sodium runtime identity rejected");
    const hash = sodium.crypto_generichash(
      32,
      new TextEncoder().encode("shardpass-ente-csp"),
      null,
    );
    if (hash.length !== 32) throw new Error("Ente sodium CSP harness failed");
    self.postMessage({ kind: "ente-sodium-ready", identity });
  },
);
