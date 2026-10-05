import { DEFAULT_ARGON2ID_PARAMETERS, createDeterministicRandomSource } from "@shardpass/crypto";
import { FakeStoragePort } from "@shardpass/testing/fake-storage-port";
import { describe, expect, it } from "vitest";

import { SessionService } from "../../src/background/vault/session-service";

const kek = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const newKek = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
const recoveryKey = Uint8Array.from({ length: 32 }, (_, index) => (index * 7 + 3) % 256);
const wrongRecoveryKey = new Uint8Array(32).fill(5);
const vaultBinding = {
  extensionId: "extension-id",
  contextKind: "vault" as const,
  senderUrl: "chrome-extension://extension-id/vault/index.html",
  documentId: "vault-document-1",
};
const recoveryKdf = { ...DEFAULT_ARGON2ID_PARAMETERS, salt: "BBBBBBBBBBBBBBBBBBBBBA==" };
const RECOVERY_KEY = "shardpass:v1:recovery";

function fixture() {
  let id = 0;
  const local = new FakeStoragePort();
  const session = new FakeStoragePort();
  const random = createDeterministicRandomSource(
    Uint8Array.from({ length: 4096 }, (_, index) => index % 251),
  );
  const service = new SessionService({
    local,
    session,
    random,
    now: () => 1_000,
    isoNow: () => new Date(1_000).toISOString(),
    nextId: () => `00000000-0000-4000-8000-${(++id).toString().padStart(12, "0")}`,
  });
  return { local, service };
}

async function setup(service: SessionService) {
  const challenge = await service.createChallenge("setup", vaultBinding);
  await service.setup(challenge.challengeId, kek.slice(), vaultBinding);
}

async function unlockWith(service: SessionService, key: Uint8Array) {
  const challenge = await service.createChallenge("unlock", vaultBinding);
  return service.unlock(challenge.challengeId, key.slice(), vaultBinding);
}

async function recover(service: SessionService, key: Uint8Array) {
  const challenge = await service.createRecoveryChallenge(vaultBinding);
  expect(challenge.kdf).toEqual(recoveryKdf);
  return service.unlockWithRecovery(challenge.challengeId, key.slice(), vaultBinding);
}

async function reset(service: SessionService, key: Uint8Array) {
  const next = await service.createChallenge("change-new", vaultBinding);
  return service.resetPassword(next.challengeId, key.slice(), vaultBinding);
}

describe("SessionService recovery code", () => {
  it("opens a vault whose master password is forgotten, and sets a new one without the old", async () => {
    const { service } = fixture();
    await setup(service);
    await service.setRecovery(recoveryKey.slice(), recoveryKdf);
    await service.lock();
    expect(await service.getState()).toMatchObject({ state: "locked", recoveryAvailable: true });

    await recover(service, recoveryKey);
    expect(await service.getState()).toMatchObject({ state: "unlocked", recovering: true });

    await expect(reset(service, newKek)).resolves.toMatchObject({ committed: true });
    expect((await service.getState()).recovering).toBeUndefined();

    // The new password opens the vault; the old one no longer does.
    await service.lock();
    await expect(unlockWith(service, kek)).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    await unlockWith(service, newKek);
    expect((await service.getState()).state).toBe("unlocked");

    // The code wraps the same data key, so it still works after the password changed.
    await service.lock();
    await recover(service, recoveryKey);
    expect((await service.getState()).state).toBe("unlocked");
  });

  it("refuses a wrong code as a failed credential, and keeps the code", async () => {
    const { service, local } = fixture();
    await setup(service);
    await service.setRecovery(recoveryKey.slice(), recoveryKdf);
    await service.lock();
    await expect(recover(service, wrongRecoveryKey)).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    expect((await service.getState()).state).toBe("locked");
    expect((await local.get([RECOVERY_KEY]))[RECOVERY_KEY]).toBeDefined();
  });

  it("allows a reset only in a session the recovery code opened, and only until it locks", async () => {
    const { service } = fixture();
    await setup(service);
    await service.setRecovery(recoveryKey.slice(), recoveryKdf);
    // Unlocked with the master password: a reset without it is refused.
    await expect(reset(service, newKek)).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });

    await service.lock();
    await recover(service, recoveryKey);
    await service.lock();
    await unlockWith(service, kek);
    await expect(reset(service, newKek)).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("is replaced by a new code and removed on request, never while locked", async () => {
    const { service } = fixture();
    await setup(service);
    await service.setRecovery(recoveryKey.slice(), recoveryKdf);
    const replacement = Uint8Array.from({ length: 32 }, (_, index) => 100 + index);
    await service.setRecovery(replacement.slice(), recoveryKdf);
    await service.lock();
    await expect(recover(service, recoveryKey)).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    await recover(service, replacement);
    await service.removeRecovery();
    expect((await service.getState()).recoveryAvailable).toBe(false);
    await service.lock();
    await expect(service.removeRecovery()).rejects.toMatchObject({ code: "VAULT_LOCKED" });
    await expect(service.createRecoveryChallenge(vaultBinding)).rejects.toMatchObject({
      code: "RECOVERY_UNAVAILABLE",
    });
  });
});
