import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  extractEmbeddedSodiumWasm,
  inventorySodiumWasm,
  verifyApprovedSodiumIdentity,
} from "../../scripts/ente-sodium-wasm-inventory.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const approvedPath = path.resolve(root, "tests/fixtures/ente/sodium-wasm-approved.json");
const modulePath = path.resolve(
  root,
  "node_modules/.pnpm/libsodium-sumo@0.8.0/node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs",
);

describe("deterministic libsodium WASM extraction inventory", () => {
  it("extracts exactly one reviewed installed payload and inventory", async () => {
    const source = await readFile(modulePath, "utf8");
    const extracted = extractEmbeddedSodiumWasm(source);
    expect(extracted.payloadCount).toBe(1);
    const inventory = inventorySodiumWasm(extracted.bytes);
    expect(inventory.magicHex).toBe("0061736d");
    expect(inventory.imports).toEqual(
      [...inventory.imports].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    );
    expect(inventory.exports).toEqual(
      [...inventory.exports].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    );
    const approved = JSON.parse(await readFile(approvedPath, "utf8")) as Record<string, unknown>;
    expect(() => verifyApprovedSodiumIdentity(source, approved, "installed")).not.toThrow();
  });

  it("fails closed when loader, payload, or import inventory is mutated", async () => {
    const source = await readFile(modulePath, "utf8");
    expect(() =>
      extractEmbeddedSodiumWasm(source.replace("base64Decode(", "decode64("), "installed"),
    ).toThrow();
    expect(() => extractEmbeddedSodiumWasm(`${source}\nbase64Decode("AGFzbQEAAAA=")`)).toThrow();
    const { bytes } = extractEmbeddedSodiumWasm(source);
    const mutatedPayload = Uint8Array.from(bytes);
    mutatedPayload.set([mutatedPayload[0]! ^ 1], 0);
    expect(() => inventorySodiumWasm(mutatedPayload)).toThrow();
    const mutatedInventory = Uint8Array.from(bytes);
    const offset = mutatedInventory.findIndex(
      (value, index) =>
        value === 1 &&
        mutatedInventory[index + 1] === 0x61 &&
        mutatedInventory[index + 2] === 1 &&
        mutatedInventory[index + 3] === 0x61,
    );
    expect(offset).toBeGreaterThan(0);
    mutatedInventory.set([0x62], offset + 1);
    expect(inventorySodiumWasm(mutatedInventory).imports).not.toEqual(
      inventorySodiumWasm(bytes).imports,
    );
  });
});
