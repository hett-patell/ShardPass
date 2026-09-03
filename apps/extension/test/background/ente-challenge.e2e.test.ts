import { FakeExtensionPlatform } from "@shardpass/testing";
import { describe, expect, it, vi } from "vitest";
vi.mock("../../src/platform/chrome-platform", () => ({
  createChromePlatform: () => new FakeExtensionPlatform("ente-ch"),
}));
import { installBackground } from "../../src/background/main";
import { createProductionEnteRuntimeDependencies } from "../../src/background/ente/production-runtime";

const extensionId = "ente-ch";
const kek = Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => i + 1)).toString("base64");
const vaultSender = { extensionId, senderUrl: `chrome-extension://${extensionId}/vault/index.html`, documentId: "page:chrome-extension://ente-ch/vault/index.html" };

// Drives the real background with the production Ente runtime (libsodium, handoff keys)
// rather than a stub, since the browser failure being chased sits between these pieces.
describe("ente.authChallenge with the production runtime", () => {
  it("returns a capability and a 32-byte handoff key", async () => {
    const platform = new FakeExtensionPlatform(extensionId);
    const runtime = createProductionEnteRuntimeDependencies();
    const dispose = installBackground(platform, runtime);
    const ch = (await platform.dispatchMessage({ version: 1, kind: "vault.getKdfChallenge", purpose: "setup" }, vaultSender)) as { challengeId: string };
    await platform.dispatchMessage({ version: 1, kind: "vault.setup", challengeId: ch.challengeId, keyEncryptionKey: kek }, vaultSender);
    const status = (await platform.dispatchMessage({ version: 1, kind: "ente.status" }, vaultSender)) as {
      kind: string; connected: boolean;
    };
    expect(status).toMatchObject({ kind: "ente.state", connected: false });
    // The page's sign-in flow needs both of these from the challenge; a missing one is the
    // silent failure the panel used to report as "not reported".
    const challenge = (await platform.dispatchMessage({ version: 1, kind: "ente.authChallenge" }, vaultSender)) as {
      kind: string; capability?: string; authHandoffPublicKey?: number[];
    };
    expect(challenge.kind).toBe("ente.state");
    expect(challenge.capability).toMatch(/^[a-f0-9]{64}$/u);
    expect(challenge.authHandoffPublicKey).toHaveLength(32);
    dispose();
  }, 60_000);
});
