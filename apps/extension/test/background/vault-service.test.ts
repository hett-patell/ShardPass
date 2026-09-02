import { createDeterministicRandomSource } from "@shardpass/crypto";
import { FakeStoragePort } from "@shardpass/testing/fake-storage-port";
import { describe, expect, it } from "vitest";

import { SessionService } from "../../src/background/vault/session-service";
import { VaultService } from "../../src/background/vault/vault-service";

const key = "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=";
const sender = {
  extensionId: "extension-id",
  contextKind: "popup" as const,
  senderUrl: "chrome-extension://extension-id/popup/index.html",
  documentId: "document-id",
};

function fixture() {
  let id = 0;
  const local = new FakeStoragePort();
  const session = new FakeStoragePort();
  const service = new SessionService({
    local,
    session,
    random: createDeterministicRandomSource(
      Uint8Array.from({ length: 2048 }, (_, index) => index % 251),
    ),
    now: () => 1_000,
    isoNow: () => new Date(1_000).toISOString(),
    nextId: () => `00000000-0000-4000-8000-${(++id).toString().padStart(12, "0")}`,
  });
  const settings: {
    current: { autoLockMinutes: 0 | 5 | 15 | 30 | 60; lockOnScreenLock: boolean };
    load(): Promise<{ autoLockMinutes: 0 | 5 | 15 | 30 | 60; lockOnScreenLock: boolean }>;
    applyMigrated(value: {
      autoLockMinutes: 0 | 5 | 15 | 30 | 60;
      lockOnScreenLock: boolean;
    }): Promise<{ autoLockMinutes: 0 | 5 | 15 | 30 | 60; lockOnScreenLock: boolean }>;
    notePrivilegedActivity(): Promise<void>;
    cancelAutoLock(): Promise<void>;
  } = {
    current: { autoLockMinutes: 15, lockOnScreenLock: true },
    load() {
      return Promise.resolve({ ...this.current });
    },
    applyMigrated(value: { autoLockMinutes: 0 | 5 | 15 | 30 | 60; lockOnScreenLock: boolean }) {
      this.current = value;
      return Promise.resolve(value);
    },
    notePrivilegedActivity: () => Promise.resolve(),
    cancelAutoLock: () => Promise.resolve(),
  };
  return { vault: new VaultService(service, settings), sessions: service, settings };
}

describe("VaultService", () => {
  it("dispatches strict requests and returns no secret material", async () => {
    const { vault: service } = fixture();
    await expect(service.getStateSnapshot()).resolves.toEqual({
      version: 1,
      kind: "vault.state",
      state: "unconfigured",
      autoLockMinutes: 15,
      lockOnScreenLock: true,
      retryAfterMs: 0,
    });
    const challenge = await service.handle(
      {
        version: 1,
        kind: "vault.getKdfChallenge",
        purpose: "setup",
      },
      sender,
    );
    expect(challenge).toMatchObject({ version: 1, kind: "vault.kdfChallenge", purpose: "setup" });
    if (challenge.kind !== "vault.kdfChallenge") throw new Error("expected challenge");
    await expect(
      service.handle(
        {
          version: 1,
          kind: "vault.setup",
          challengeId: challenge.challengeId,
          keyEncryptionKey: key,
        },
        sender,
      ),
    ).resolves.toEqual({
      version: 1,
      kind: "vault.ok",
      committed: true,
      state: "unlocked",
    });
  });

  it("commits unlocked settings through authenticated metadata before projecting runtime state", async () => {
    const { vault, sessions, settings } = fixture();
    const challenge = await vault.handle(
      { version: 1, kind: "vault.getKdfChallenge", purpose: "setup" },
      sender,
    );
    if (challenge.kind !== "vault.kdfChallenge") throw new Error("expected challenge");
    await vault.handle(
      {
        version: 1,
        kind: "vault.setup",
        challengeId: challenge.challengeId,
        keyEncryptionKey: key,
      },
      sender,
    );

    await expect(
      vault.handle(
        {
          version: 1,
          kind: "vault.updateLockSettings",
          autoLockMinutes: 30,
          lockOnScreenLock: false,
        },
        sender,
      ),
    ).resolves.toMatchObject({ kind: "vault.ok", committed: true, state: "unlocked" });
    expect(settings.current).toEqual({ autoLockMinutes: 30, lockOnScreenLock: false });
    const authority = await sessions.captureBackupSession();
    await expect(sessions.readPortableBackupSnapshot(authority)).resolves.toMatchObject({
      settings: { autoLockMinutes: 30, lockOnScreenLock: false },
    });
  });

  it("returns stable secret-free failures", async () => {
    const { vault: service } = fixture();
    await expect(
      service.handle(
        {
          version: 1,
          kind: "vault.unlock",
          challengeId: "0123456789abcdef0123456789abcdef",
          keyEncryptionKey: key,
        },
        sender,
      ),
    ).rejects.toMatchObject({ code: "CHALLENGE_INVALID" });
  });
});
