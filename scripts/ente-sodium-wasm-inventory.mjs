import { createHash } from "node:crypto";

const installedPayloadPattern = /base64Decode\("([A-Za-z0-9+/]+={0,2})"\)/gu;
const packagedPayloadPattern = /[A-Za-z_$][\w$]*\("(AGFzbQE[A-Za-z0-9+/]*={0,2})"\)/gu;
const canonicalPaddedBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const sortDescriptors = (values) =>
  values
    .map((value) => ({ ...value }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

export function extractEmbeddedSodiumWasm(source, kind = "auto") {
  if (typeof source !== "string") throw new Error("Invalid libsodium containing module");
  const installedMatches = [...source.matchAll(installedPayloadPattern)];
  const matches =
    kind === "installed" || (kind === "auto" && source.includes("base64Decode"))
      ? installedMatches
      : [...source.matchAll(packagedPayloadPattern)];
  if (matches.length !== 1 || !matches[0]?.[1])
    throw new Error("Expected exactly one embedded libsodium WASM payload");
  const payload = matches[0][1];
  if (payload.length % 4 !== 0 || !canonicalPaddedBase64.test(payload))
    throw new Error("Non-canonical libsodium WASM payload");
  const bytes = Buffer.from(payload, "base64");
  if (bytes.toString("base64") !== payload) throw new Error("Non-canonical libsodium WASM payload");
  return { payloadCount: matches.length, payload, bytes: Uint8Array.from(bytes) };
}

export function inventorySodiumWasm(bytes) {
  const owned = Uint8Array.from(bytes);
  const magicHex = Buffer.from(owned.subarray(0, 4)).toString("hex");
  if (magicHex !== "0061736d") throw new Error("Decoded libsodium payload is not WASM");
  const module = new WebAssembly.Module(owned);
  return {
    magicHex,
    wasmSha256: createHash("sha256").update(owned).digest("hex"),
    imports: sortDescriptors(WebAssembly.Module.imports(module)),
    exports: sortDescriptors(WebAssembly.Module.exports(module)),
  };
}

export function inspectSodiumContainingModule(source, kind = "auto") {
  const extracted = extractEmbeddedSodiumWasm(source, kind);
  const inventory = inventorySodiumWasm(extracted.bytes);
  return {
    containingModuleSha256: createHash("sha256").update(source).digest("hex"),
    payloadCount: extracted.payloadCount,
    ...inventory,
    importsSha256: createHash("sha256").update(JSON.stringify(inventory.imports)).digest("hex"),
    exportsSha256: createHash("sha256").update(JSON.stringify(inventory.exports)).digest("hex"),
  };
}

export function verifyApprovedSodiumIdentity(source, approved, containingModuleKind) {
  const identity = inspectSodiumContainingModule(source, containingModuleKind);
  const containingHashKey =
    containingModuleKind === "packaged"
      ? "packagedContainingModuleSha256"
      : "containingModuleSha256";
  const checks = [
    [identity.containingModuleSha256, approved[containingHashKey]],
    [identity.payloadCount, approved.embeddedPayloadCount],
    [identity.magicHex, approved.wasmMagicHex],
    [identity.wasmSha256, approved.decodedWasmSha256],
    [identity.imports.length, approved.importsCount],
    [identity.importsSha256, approved.importsSha256],
    [identity.exports.length, approved.exportsCount],
    [identity.exportsSha256, approved.exportsSha256],
  ];
  if (checks.some(([actual, expected]) => actual !== expected))
    throw new Error("Unapproved libsodium WASM identity");
  return identity;
}
