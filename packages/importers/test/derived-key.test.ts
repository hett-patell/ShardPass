import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  LegacyMigrationError,
  decryptLegacyVault,
  decryptLegacyVaultWithDerivedKey,
  deriveLegacyVaultKey,
} from "../src/legacy-v1";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
async function fixture() {
  return JSON.parse(
    await readFile(path.join(root, "tests/fixtures/legacy/vault-standard.json"), "utf8"),
  ) as { vault: unknown; testOnlyPassword: string };
}

describe("legacy derived-key boundary", () => {
  it("derives exactly 32 mutable bytes and decrypts equivalently", async () => {
    const value = await fixture();
    const key = await deriveLegacyVaultKey(value.vault, value.testOnlyPassword);
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.byteLength).toBe(32);
    await expect(decryptLegacyVaultWithDerivedKey(value.vault, key)).resolves.toEqual(
      await decryptLegacyVault(value.vault, value.testOnlyPassword),
    );
  });

  it("rejects non-32-byte keys and preserves authentication equivalence", async () => {
    const value = await fixture();
    for (const key of [new Uint8Array(31), new Uint8Array(33), new Uint8Array(32)])
      await expect(decryptLegacyVaultWithDerivedKey(value.vault, key)).rejects.toEqual(
        new LegacyMigrationError("AUTHENTICATION_FAILED"),
      );
  });
});
