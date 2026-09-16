import { FakeExtensionPlatform } from "@shardpass/testing";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/platform/chrome-platform", () => ({
  createChromePlatform: () => new FakeExtensionPlatform("pin-unlock-test-id"),
}));

import { installBackground } from "../../src/background/main";

const extensionId = "pin-unlock-test-id";
const vaultSender = {
  extensionId,
  senderUrl: `chrome-extension://${extensionId}/vault/index.html`,
  documentId: "page:vault",
};
const keyEncryptionKey = Buffer.from(
  Uint8Array.from({ length: 32 }, (_, index) => index + 1),
).toString("base64");
const pinKey = Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => 200 - index)).toString(
  "base64",
);
const kdf = {
  algorithm: "argon2id" as const,
  salt: Buffer.alloc(16, 9).toString("base64"),
  memoryKiB: 65_536,
  iterations: 2,
  parallelism: 1,
};

describe("unlocking with a PIN through the background", () => {
  it("opens the vault and tells every surface it is open", async () => {
    const platform = new FakeExtensionPlatform(extensionId);
    const dispose = installBackground(platform);
    try {
      const setupChallenge = (await platform.dispatchMessage(
        { version: 1, kind: "vault.getKdfChallenge", purpose: "setup" },
        vaultSender,
      )) as { challengeId: string };
      await platform.dispatchMessage(
        {
          version: 1,
          kind: "vault.setup",
          challengeId: setupChallenge.challengeId,
          keyEncryptionKey,
        },
        vaultSender,
      );
      await platform.dispatchMessage(
        { version: 1, kind: "vault.setPin", pinKey, kdf },
        vaultSender,
      );
      await platform.dispatchMessage({ version: 1, kind: "vault.lock" }, vaultSender);
      expect(
        await platform.dispatchMessage({ version: 1, kind: "vault.getState" }, vaultSender),
      ).toMatchObject({ state: "locked", pinAvailable: true });

      const pinChallenge = (await platform.dispatchMessage(
        { version: 1, kind: "vault.getPinChallenge" },
        vaultSender,
      )) as { challengeId: string };
      expect(
        await platform.dispatchMessage(
          {
            version: 1,
            kind: "vault.unlockWithPin",
            challengeId: pinChallenge.challengeId,
            pinKey,
          },
          vaultSender,
        ),
      ).toMatchObject({ kind: "vault.ok", state: "unlocked" });

      // What every surface reads. This is what "unlocking with the PIN does nothing" was:
      // the vault opened and the state everyone reads still said locked.
      expect(
        await platform.dispatchMessage({ version: 1, kind: "vault.getState" }, vaultSender),
      ).toMatchObject({ state: "unlocked" });
    } finally {
      dispose();
    }
  });
});
