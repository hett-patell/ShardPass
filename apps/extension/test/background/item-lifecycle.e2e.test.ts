import { FakeExtensionPlatform } from "@shardpass/testing";
import { describe, expect, it, vi } from "vitest";
vi.mock("../../src/platform/chrome-platform", () => ({
  createChromePlatform: () => new FakeExtensionPlatform("item-lifecycle"),
}));
import { installBackground } from "../../src/background/main";

const extensionId = "item-lifecycle";
const kek = Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => i + 1)).toString("base64");
const vaultSender = {
  extensionId,
  senderUrl: `chrome-extension://${extensionId}/vault/index.html`,
  documentId: "d",
};
const login = (id: string, name: string) => ({
  id,
  schemaVersion: 2,
  revision: 1,
  createdAt: "2026-08-10T12:00:00.000Z",
  updatedAt: "2026-08-10T12:00:00.000Z",
  favorite: false,
  tags: [],
  kind: "login",
  name,
  username: "u",
  password: "p",
  urls: ["https://x.test"],
  notes: "",
});
async function setup() {
  const platform = new FakeExtensionPlatform(extensionId);
  const dispose = installBackground(platform);
  const ch = (await platform.dispatchMessage(
    { version: 1, kind: "vault.getKdfChallenge", purpose: "setup" },
    vaultSender,
  )) as { challengeId: string };
  await platform.dispatchMessage(
    { version: 1, kind: "vault.setup", challengeId: ch.challengeId, keyEncryptionKey: kek },
    vaultSender,
  );
  return { platform, dispose };
}

// Drives the real background (installBackground on a fake platform) rather than a
// service fake: these paths cross the router, session, storage and publisher together,
// and a regression in any one of them would otherwise only show up in the browser.
describe("item lifecycle through the installed background", () => {
  it("deletes after an update (item.create path)", async () => {
    const { platform, dispose } = await setup();
    const a = login("018f47a6-7d11-7c2f-8bd9-a1d37f147a01", "188");
    await platform.dispatchMessage({ version: 1, kind: "item.create", item: a }, vaultSender);
    const u = (await platform.dispatchMessage(
      {
        version: 1,
        kind: "item.update",
        itemId: a.id,
        expectedRevision: 1,
        fields: { notes: "edited" },
      },
      vaultSender,
    )) as { kind?: unknown; autoLockMinutes?: unknown };
    expect(u.kind).toBe("item.mutationResult");
    const d = (await platform.dispatchMessage(
      { version: 1, kind: "item.delete", itemId: a.id },
      vaultSender,
    )) as { kind?: unknown; autoLockMinutes?: unknown };
    dispose();
    expect(d.kind).toBe("item.deleteResult");
  });

  it("deletes after an update (createMany path)", async () => {
    const { platform, dispose } = await setup();
    const b = login("018f47a6-7d11-7c2f-8bd9-a1d37f147a02", "batch");
    await platform.dispatchMessage(
      { version: 1, kind: "item.createMany", items: [b] },
      vaultSender,
    );
    const u = (await platform.dispatchMessage(
      {
        version: 1,
        kind: "item.update",
        itemId: b.id,
        expectedRevision: 1,
        fields: { notes: "edited" },
      },
      vaultSender,
    )) as { kind?: unknown; autoLockMinutes?: unknown };
    expect(u.kind).toBe("item.mutationResult");
    const d = (await platform.dispatchMessage(
      { version: 1, kind: "item.delete", itemId: b.id },
      vaultSender,
    )) as { kind?: unknown; autoLockMinutes?: unknown };
    dispose();
    expect(d.kind).toBe("item.deleteResult");
  });

  it("lock settings update is reflected in state and alarm", async () => {
    const { platform, dispose } = await setup();
    const r = (await platform.dispatchMessage(
      {
        version: 1,
        kind: "vault.updateLockSettings",
        autoLockMinutes: 30,
        lockOnScreenLock: false,
      },
      vaultSender,
    )) as { kind?: unknown; autoLockMinutes?: unknown };
    expect(r.kind).toBe("vault.ok");
    const s = (await platform.dispatchMessage(
      { version: 1, kind: "vault.getState" },
      vaultSender,
    )) as { kind?: unknown; autoLockMinutes?: unknown };
    dispose();
    expect(s.autoLockMinutes).toBe(30);
  });
});
