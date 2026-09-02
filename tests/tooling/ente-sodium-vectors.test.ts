import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import sodium from "../../apps/extension/node_modules/libsodium-wrappers-sumo/dist/modules-sumo-esm/libsodium-wrappers.mjs";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const fixturePath = path.resolve(root, "tests/fixtures/ente/sodium-wire-vectors.json");
const hex = (value: Uint8Array) => Buffer.from(value).toString("hex");
const bytes = (value: string) => Uint8Array.from(Buffer.from(value, "hex"));

describe("byte-exact pinned sodium wire evidence", () => {
  it("replays every secretbox, sealed-box and secretstream byte", async () => {
    await sodium.ready;
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as {
      generatorSha256: string;
      loaderSha256: string;
      browserHarnessSha256: string;
      outputScannerSha256: string;
      sumoModuleSha256: string;
      decodedWasmSha256: string;
      wasmImports: WebAssembly.ModuleImportDescriptor[];
      wasmExports: WebAssembly.ModuleExportDescriptor[];
      vectors: Array<{
        operation: string;
        inputHex: string;
        deterministicRandomHex: string;
        expectedWireHex?: string;
        expectedWire?: { headerHex: string; ciphertextHex: string; tag: number };
      }>;
    };
    expect(fixture.generatorSha256).toBe(
      createHash("sha256")
        .update(await readFile(path.resolve(root, "scripts/generate-ente-sodium-vectors.mjs")))
        .digest("hex"),
    );
    expect(fixture.loaderSha256).toBe(
      createHash("sha256")
        .update(
          await readFile(
            path.resolve(
              root,
              "apps/extension/node_modules/libsodium-wrappers-sumo/dist/modules-sumo-esm/libsodium-wrappers.mjs",
            ),
          ),
        )
        .digest("hex"),
    );
    expect(fixture.browserHarnessSha256).toBe(
      createHash("sha256")
        .update(await readFile(path.resolve(root, "tests/browser/ente-sodium-csp.spec.ts")))
        .digest("hex"),
    );
    expect(fixture.outputScannerSha256).toBe(
      createHash("sha256")
        .update(await readFile(path.resolve(root, "scripts/scan-build.mjs")))
        .digest("hex"),
    );
    const sumoSource = await readFile(
      path.resolve(
        root,
        "node_modules/.pnpm/libsodium-sumo@0.8.0/node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs",
      ),
      "utf8",
    );
    expect(fixture.sumoModuleSha256).toBe(createHash("sha256").update(sumoSource).digest("hex"));
    const payloadMatches = [...sumoSource.matchAll(/base64Decode\("([A-Za-z0-9+/]+={0,2})"\)/gu)];
    expect(payloadMatches).toHaveLength(1);
    const wasmBytes = Buffer.from(payloadMatches[0]?.[1] ?? "", "base64");
    expect(wasmBytes.subarray(0, 4)).toEqual(Buffer.from("0061736d", "hex"));
    expect(fixture.decodedWasmSha256).toBe(createHash("sha256").update(wasmBytes).digest("hex"));
    const wasmModule = new WebAssembly.Module(wasmBytes);
    const sort = <T>(values: T[]): T[] =>
      values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    expect(fixture.wasmImports).toEqual(sort(WebAssembly.Module.imports(wasmModule)));
    expect(fixture.wasmExports).toEqual(sort(WebAssembly.Module.exports(wasmModule)));
    const key = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    for (const vector of fixture.vectors) {
      const message = bytes(vector.inputHex);
      if (vector.operation === "secretbox")
        expect(
          hex(sodium.crypto_secretbox_easy(message, bytes(vector.deterministicRandomHex), key)),
        ).toBe(vector.expectedWireHex);
      if (vector.operation === "sealed-box") {
        const recipient = sodium.crypto_box_seed_keypair(
          Uint8Array.from({ length: 32 }, (_, index) => index + 9),
        );
        const ephemeral = sodium.crypto_box_seed_keypair(bytes(vector.deterministicRandomHex));
        const nonce = sodium.crypto_generichash(
          sodium.crypto_box_NONCEBYTES,
          new Uint8Array([...ephemeral.publicKey, ...recipient.publicKey]),
          null,
        );
        expect(
          hex(
            new Uint8Array([
              ...ephemeral.publicKey,
              ...sodium.crypto_box_easy(message, nonce, recipient.publicKey, ephemeral.privateKey),
            ]),
          ),
        ).toBe(vector.expectedWireHex);
      }
      if (vector.operation === "secretstream-final") {
        const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(
          bytes(vector.deterministicRandomHex),
          key,
        );
        expect(
          hex(
            sodium.crypto_secretstream_xchacha20poly1305_push(
              state,
              message,
              null,
              sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL,
            ),
          ),
        ).toBe(vector.expectedWire?.ciphertextHex);
        expect(vector.expectedWire?.headerHex).toBe(vector.deterministicRandomHex);
        expect(vector.expectedWire?.tag).toBe(
          sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL,
        );
      }
    }
  });

  it("regenerates twice in temporary directories with byte-identical output", async () => {
    const first = await mkdtemp(path.join(tmpdir(), "shardpass-sodium-a-"));
    const second = await mkdtemp(path.join(tmpdir(), "shardpass-sodium-b-"));
    try {
      const run = (directory: string) =>
        promisify(execFile)(
          process.execPath,
          [
            path.resolve(root, "scripts/generate-ente-sodium-vectors.mjs"),
            path.join(directory, "vectors.json"),
          ],
          { cwd: root },
        );
      await run(first);
      await run(second);
      const [a, b, committed] = await Promise.all([
        readFile(path.join(first, "vectors.json")),
        readFile(path.join(second, "vectors.json")),
        readFile(fixturePath),
      ]);
      expect(a).toEqual(b);
      expect(a).toEqual(committed);
    } finally {
      await Promise.all([
        rm(first, { recursive: true, force: true }),
        rm(second, { recursive: true, force: true }),
      ]);
    }
  });
});
