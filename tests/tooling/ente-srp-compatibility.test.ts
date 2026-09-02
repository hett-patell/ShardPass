import nodeAssert from "node:assert";
import { Buffer as NodeBuffer } from "node:buffer";
import { createHash as createNodeHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import assertCompatibility from "../../apps/extension/src/background/ente/srp-compat/assert";
import { Buffer as CompatibleBuffer } from "../../apps/extension/src/background/ente/srp-compat/buffer";
import * as cryptoCompatibility from "../../apps/extension/src/background/ente/srp-compat/crypto";

const { createHash: createCompatibleHash } = cryptoCompatibility;

const asHex = (value: Uint8Array): string => NodeBuffer.from(value).toString("hex");

describe("narrow Ente SRP Node compatibility", () => {
  it("matches Node SHA-256 for every package-used update/digest shape", () => {
    const cases = [
      [CompatibleBuffer.from(":"), CompatibleBuffer.from([0, 1, 127, 128, 255])],
      [CompatibleBuffer.alloc(0)],
      [CompatibleBuffer.from("00ff10", "hex")],
      [CompatibleBuffer.alloc(512, 0), CompatibleBuffer.from([0, 0, 0, 1])],
    ];
    for (const chunks of cases) {
      const compatible = createCompatibleHash("sha256");
      const node = createNodeHash("sha256");
      for (const chunk of chunks) {
        expect(compatible.update(chunk)).toBe(compatible);
        node.update(chunk);
      }
      expect(asHex(compatible.digest())).toBe(node.digest("hex"));
    }
    expect(() => createCompatibleHash("sha512")).toThrow("Unsupported hash algorithm");
    expect("randomBytes" in cryptoCompatibility).toBe(false);
  });

  it("matches Node Buffer for the complete reachable SRP subset", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    const compatible = CompatibleBuffer.from(bytes);
    const node = NodeBuffer.from(bytes);
    expect(CompatibleBuffer.isBuffer(compatible)).toBe(NodeBuffer.isBuffer(node));
    expect(compatible.length).toBe(node.length);
    expect(compatible[4]).toBe(node[4]);
    compatible[1] = 42;
    node[1] = 42;
    expect(compatible.toString("hex")).toBe(node.toString("hex"));

    const compatibleTarget = CompatibleBuffer.alloc(10);
    const nodeTarget = NodeBuffer.alloc(10);
    compatibleTarget.fill(7, 0, 2);
    nodeTarget.fill(7, 0, 2);
    compatible.copy(compatibleTarget, 2);
    node.copy(nodeTarget, 2);
    expect(compatibleTarget.toString("hex")).toBe(nodeTarget.toString("hex"));
    expect(compatibleTarget.slice(1, 8).toString("hex")).toBe(
      nodeTarget.slice(1, 8).toString("hex"),
    );
    expect(CompatibleBuffer.concat([CompatibleBuffer.from(":"), compatible]).toString("hex")).toBe(
      NodeBuffer.concat([NodeBuffer.from(":"), node]).toString("hex"),
    );
  });

  it("matches Node assert.strictEqual pass/fail semantics", () => {
    expect(() => assertCompatibility.strictEqual(512, 512)).not.toThrow();
    expect(() => nodeAssert.strictEqual(1, "1")).toThrow();
    expect(() => assertCompatibility.strictEqual<unknown>(1, "1")).toThrow();
    expect(Object.keys(assertCompatibility)).toEqual(["strictEqual"]);
  });
});
