import { describe, expect, it, vi } from "vitest";

import { RepromptGrants } from "../../src/background/vault/reprompt-grants";
import type { SessionService } from "../../src/background/vault/session-service";
import { VaultService } from "../../src/background/vault/vault-service";

const sender = {
  extensionId: "expected-extension-id",
  contextKind: "vault" as const,
  senderUrl: "chrome-extension://expected-extension-id/vault/index.html",
  documentId: "vault-document",
};
const itemId = "10000000-0000-4000-8000-000000000001";

describe("vault.confirmReprompt", () => {
  it("verifies the password with the session, then grants the item for a while", async () => {
    let now = 1_000;
    const grants = new RepromptGrants(() => now);
    const verifyReprompt = vi.fn(() => Promise.resolve());
    const noted = vi.fn(() => Promise.resolve());
    const vault = new VaultService(
      { verifyReprompt } as unknown as SessionService,
      {
        load: () => Promise.resolve({ autoLockMinutes: 15, lockOnScreenLock: true }),
        applyMigrated: (value) => Promise.resolve(value),
        notePrivilegedActivity: noted,
        cancelAutoLock: () => Promise.resolve(),
      },
      grants,
    );
    expect(grants.granted(itemId)).toBe(false);
    await expect(
      vault.handle(
        {
          version: 1,
          kind: "vault.confirmReprompt",
          challengeId: "0123456789abcdef0123456789abcdef",
          keyEncryptionKey: "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=",
          itemId,
        },
        sender,
      ),
    ).resolves.toEqual({ version: 1, kind: "vault.ok", state: "unlocked" });
    expect(verifyReprompt).toHaveBeenCalledWith(
      "0123456789abcdef0123456789abcdef",
      expect.any(Uint8Array),
      sender,
    );
    expect(noted).toHaveBeenCalledTimes(1);
    expect(grants.granted(itemId)).toBe(true);
    now += 5 * 60_000;
    expect(grants.granted(itemId)).toBe(false);
  });

  it("grants nothing when the session refuses the password", async () => {
    const grants = new RepromptGrants(() => 0);
    const vault = new VaultService(
      {
        verifyReprompt: () => Promise.reject(new Error("INVALID_CREDENTIALS")),
      } as unknown as SessionService,
      {
        load: () => Promise.resolve({ autoLockMinutes: 15, lockOnScreenLock: true }),
        applyMigrated: (value) => Promise.resolve(value),
        notePrivilegedActivity: () => Promise.resolve(),
        cancelAutoLock: () => Promise.resolve(),
      },
      grants,
    );
    await expect(
      vault.handle(
        {
          version: 1,
          kind: "vault.confirmReprompt",
          challengeId: "0123456789abcdef0123456789abcdef",
          keyEncryptionKey: "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=",
          itemId,
        },
        sender,
      ),
    ).rejects.toThrow();
    expect(grants.granted(itemId)).toBe(false);
  });
});
