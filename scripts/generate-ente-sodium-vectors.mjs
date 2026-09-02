import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sodium from "../apps/extension/node_modules/libsodium-wrappers-sumo/dist/modules-sumo-esm/libsodium-wrappers.mjs";
import { inspectSodiumContainingModule } from "./ente-sodium-wasm-inventory.mjs";

await sodium.ready;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(
  process.argv[2] ?? resolve(root, "tests/fixtures/ente/sodium-wire-vectors.json"),
);
const sumoModulePath = resolve(
  root,
  "node_modules/.pnpm/libsodium-sumo@0.8.0/node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs",
);
const sumoModuleSource = await readFile(sumoModulePath, "utf8");
const wasmIdentity = inspectSodiumContainingModule(sumoModuleSource);
const hex = (v) => Buffer.from(v).toString("hex");
const bytes = (length, start) => Uint8Array.from({ length }, (_, i) => (start + i) & 255);
const key = bytes(32, 1);
const message = bytes(31, 70);
const nonce = bytes(24, 33);
const recipient = sodium.crypto_box_seed_keypair(bytes(32, 9));
const ephemeral = sodium.crypto_box_seed_keypair(bytes(32, 99));
const sealNonce = sodium.crypto_generichash(
  sodium.crypto_box_NONCEBYTES,
  new Uint8Array([...ephemeral.publicKey, ...recipient.publicKey]),
  null,
);
const sealed = new Uint8Array([
  ...ephemeral.publicKey,
  ...sodium.crypto_box_easy(message, sealNonce, recipient.publicKey, ephemeral.privateKey),
]);
const header = bytes(24, 5);
// init_pull establishes exactly the same secretstream state as init_push for a supplied header.
const streamState = sodium.crypto_secretstream_xchacha20poly1305_init_pull(header, key);
const streamCiphertext = sodium.crypto_secretstream_xchacha20poly1305_push(
  streamState,
  message,
  null,
  sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL,
);
const generatorSource = await readFile(fileURLToPath(import.meta.url));
const value = {
  protocolPin: "c69dcf66704ad7ec1f95e32920455be429a566ef",
  wrapperVersion: "0.8.4",
  wasmVersion: "0.8.0",
  provenance: "synthetic test-only vectors generated from exact pinned npm libsodium artifacts",
  generatorSha256: createHash("sha256").update(generatorSource).digest("hex"),
  loaderSha256: createHash("sha256")
    .update(
      await readFile(
        resolve(
          root,
          "apps/extension/node_modules/libsodium-wrappers-sumo/dist/modules-sumo-esm/libsodium-wrappers.mjs",
        ),
      ),
    )
    .digest("hex"),
  browserHarnessSha256: createHash("sha256")
    .update(await readFile(resolve(root, "tests/browser/ente-sodium-csp.spec.ts")))
    .digest("hex"),
  outputScannerSha256: createHash("sha256")
    .update(await readFile(resolve(root, "scripts/scan-build.mjs")))
    .digest("hex"),
  sumoModuleSha256: wasmIdentity.containingModuleSha256,
  decodedWasmSha256: wasmIdentity.wasmSha256,
  wasmImports: wasmIdentity.imports,
  wasmExports: wasmIdentity.exports,
  vectors: [
    {
      operation: "secretbox",
      inputHex: hex(message),
      deterministicRandomHex: hex(nonce),
      expectedWireHex: hex(sodium.crypto_secretbox_easy(message, nonce, key)),
    },
    {
      operation: "sealed-box",
      inputHex: hex(message),
      deterministicRandomHex: hex(bytes(32, 99)),
      expectedWireHex: hex(sealed),
    },
    {
      operation: "secretstream-final",
      inputHex: hex(message),
      deterministicRandomHex: hex(header),
      expectedWire: {
        headerHex: hex(header),
        ciphertextHex: hex(streamCiphertext),
        tag: sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL,
      },
    },
  ],
};
await writeFile(output, `${JSON.stringify(value, null, 2)}\n`);
