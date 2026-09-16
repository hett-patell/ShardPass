import { FakeExtensionPlatform } from "@shardpass/testing";
import { describe, expect, it, vi } from "vitest";
vi.mock("../../src/platform/chrome-platform", () => ({
  createChromePlatform: () => new FakeExtensionPlatform("growth"),
}));
import { installBackground } from "../../src/background/main";

const extensionId = "growth";
const kek = Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => i + 1)).toString("base64");
const vaultSender = {
  extensionId,
  senderUrl: `chrome-extension://${extensionId}/vault/index.html`,
  documentId: "d",
};
const login = (n: number) => ({
  id: `018f47a6-7d11-7c2f-8bd9-${n.toString(16).padStart(12, "0")}`,
  schemaVersion: 2,
  revision: 1,
  createdAt: "2026-08-10T12:00:00.000Z",
  updatedAt: "2026-08-10T12:00:00.000Z",
  favorite: false,
  tags: ["work"],
  kind: "login",
  name: `Site ${n}`,
  username: `user${n}@example.test`,
  password: "correct horse battery staple " + n,
  urls: [`https://site${n}.example.test/login`],
  notes: "imported from KeePass\n\nKeePass group: Web / Banking",
});
async function boot() {
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
async function measure(platform: FakeExtensionPlatform) {
  const snap = await (
    platform.localStorage as { snapshot(): Promise<Record<string, unknown>> }
  ).snapshot();
  const entries = Object.entries(snap);
  const bytes = entries.reduce((sum, [, value]) => sum + JSON.stringify(value).length, 0);
  const generations = new Set(
    entries.map(([key]) => /^shardpass:v1:g:([0-9a-f-]{36})/u.exec(key)?.[1]).filter(Boolean),
  );
  return { keys: entries.length, bytes, generations: generations.size };
}

// Before superseded generations were swept on activation, 80 one-at-a-time creates left
// ~5 MB across ~6,700 keys (every commit stranded a whole generation), and a real vault
// crossed the 10 MB storage.local quota -- after which every write failed while reads
// still worked. Storage must stay at "active + previous" no matter how items arrive.
describe("storage stays bounded", () => {
  it("retains at most two generations after many sequential commits", async () => {
    const N = 80;
    const { platform, dispose } = await boot();
    for (let i = 0; i < N; i++)
      await platform.dispatchMessage(
        { version: 1, kind: "item.create", item: login(i) },
        vaultSender,
      );
    const after = await measure(platform);
    dispose();
    expect(after.generations).toBeLessThanOrEqual(2);
    expect(after.bytes).toBeLessThan(600 * 1024);
  }, 120_000);

  it("a batch commit and sequential commits converge on the same footprint", async () => {
    const N = 40;
    const a = await boot();
    for (let i = 0; i < N; i++)
      await a.platform.dispatchMessage(
        { version: 1, kind: "item.create", item: login(i) },
        vaultSender,
      );
    const sequential = await measure(a.platform);
    a.dispose();

    const b = await boot();
    await b.platform.dispatchMessage(
      { version: 1, kind: "item.createMany", items: Array.from({ length: N }, (_, i) => login(i)) },
      vaultSender,
    );
    const batched = await measure(b.platform);
    b.dispose();
    // Same items, same retained generations: within a small constant of each other.
    expect(sequential.generations).toBeLessThanOrEqual(2);
    expect(Math.abs(sequential.bytes - batched.bytes)).toBeLessThan(80 * 1024);
  }, 120_000);
});
