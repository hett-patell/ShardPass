import { DEFAULT_ARGON2ID_PARAMETERS, createDeterministicRandomSource } from "@shardpass/crypto";
import { FakeStoragePort } from "@shardpass/testing/fake-storage-port";
import { describe, expect, it } from "vitest";

import { SessionService } from "../../src/background/vault/session-service";

const kek = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const pinKey = Uint8Array.from({ length: 32 }, (_, index) => 200 - index);
const wrongPinKey = new Uint8Array(32).fill(9);
const popupBinding = {
  extensionId: "extension-id",
  contextKind: "popup" as const,
  senderUrl: "chrome-extension://extension-id/popup/index.html",
  documentId: "popup-document-1",
};
const otherBinding = { ...popupBinding, documentId: "popup-document-2" };
const PIN_KEY = "shardpass:v1:pin";
const pinKdf = { ...DEFAULT_ARGON2ID_PARAMETERS, salt: "AAAAAAAAAAAAAAAAAAAAAA==" };

function fixture() {
  const milliseconds = 1_000;
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
    now: () => milliseconds,
    isoNow: () => new Date(milliseconds).toISOString(),
    nextId: () => `00000000-0000-4000-8000-${(++id).toString().padStart(12, "0")}`,
  });
  return { local, service };
}

async function setup(service: SessionService) {
  const challenge = await service.createChallenge("setup", popupBinding);
  await service.setup(challenge.challengeId, kek.slice(), popupBinding);
}

async function unlockWithPin(service: SessionService, key: Uint8Array, binding = popupBinding) {
  const challenge = await service.createPinChallenge(popupBinding);
  return service.unlockWithPin(challenge.challengeId, key.slice(), binding);
}

describe("SessionService PIN and the rest of the session", () => {
  it("drops the PIN when the master password changes", async () => {
    const { service, local } = fixture();
    await setup(service);
    await service.setPin(pinKey.slice(), pinKdf);
    expect((await service.getState()).pinAvailable).toBe(true);
    const current = await service.createChallenge("change-current", popupBinding);
    const next = await service.createChallenge("change-new", popupBinding);
    const newKek = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
    await service.changePassword(
      current.challengeId,
      kek.slice(),
      next.challengeId,
      newKek.slice(),
      popupBinding,
    );
    expect((await local.get([PIN_KEY]))[PIN_KEY]).toBeUndefined();
    expect((await service.getState()).pinAvailable).toBe(false);
  });

  it("refuses to seal or open a secret once a lock has begun, before the key is gone", async () => {
    const { service } = fixture();
    await setup(service);
    const sealed = await service.sealSecret("test", new Uint8Array([1, 2, 3]));
    const locking = service.lock();
    await expect(service.sealSecret("test", new Uint8Array([4]))).rejects.toMatchObject({
      code: "VAULT_LOCKED",
    });
    await expect(service.openSecret("test", sealed)).rejects.toMatchObject({
      code: "VAULT_LOCKED",
    });
    await locking;
  });
});

describe("SessionService PIN unlock", () => {
  it("reports no PIN until one is set, and only while the vault is open", async () => {
    const { service } = fixture();
    await setup(service);
    expect((await service.getState()).pinAvailable).toBe(false);
    await expect(service.createPinChallenge(popupBinding)).rejects.toMatchObject({
      code: "PIN_UNAVAILABLE",
    });
    await service.lock();
    await expect(service.setPin(pinKey.slice(), pinKdf)).rejects.toMatchObject({
      code: "VAULT_LOCKED",
    });
  });

  it("wraps the data key under the PIN key and unlocks with it after a lock", async () => {
    const { service, local } = fixture();
    await setup(service);
    await service.setPin(pinKey.slice(), pinKdf);
    expect((await service.getState()).pinAvailable).toBe(true);
    const stored = (await local.get([PIN_KEY]))[PIN_KEY] as {
      wrapped: { kdf: { salt: string } };
      failures: number;
    };
    expect(stored.wrapped.kdf.salt).toBe(pinKdf.salt);
    expect(stored.failures).toBe(0);
    expect(JSON.stringify(stored)).not.toContain(Buffer.from(pinKey).toString("base64"));

    await service.lock();
    expect((await service.getState()).state).toBe("locked");
    const challenge = await service.createPinChallenge(popupBinding);
    expect(challenge.kdf).toEqual(pinKdf);
    await service.unlockWithPin(challenge.challengeId, pinKey.slice(), popupBinding);
    expect((await service.getState()).state).toBe("unlocked");
  });

  it("binds the PIN challenge to its sender and consumes it once", async () => {
    const { service } = fixture();
    await setup(service);
    await service.setPin(pinKey.slice(), pinKdf);
    await service.lock();
    await expect(unlockWithPin(service, pinKey, otherBinding)).rejects.toMatchObject({
      code: "CHALLENGE_INVALID",
    });
    const challenge = await service.createPinChallenge(popupBinding);
    await service.unlockWithPin(challenge.challengeId, pinKey.slice(), popupBinding);
    await service.lock();
    await expect(
      service.unlockWithPin(challenge.challengeId, pinKey.slice(), popupBinding),
    ).rejects.toMatchObject({ code: "CHALLENGE_INVALID" });
  });

  it("counts wrong PINs, removes the PIN on the fifth, and resets the count on success", async () => {
    const { service, local } = fixture();
    await setup(service);
    await service.setPin(pinKey.slice(), pinKdf);
    await service.lock();
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expect(unlockWithPin(service, wrongPinKey)).rejects.toMatchObject({
        code: "PIN_INVALID",
      });
      expect(((await local.get([PIN_KEY]))[PIN_KEY] as { failures: number }).failures).toBe(
        attempt,
      );
    }
    await unlockWithPin(service, pinKey);
    expect(((await local.get([PIN_KEY]))[PIN_KEY] as { failures: number }).failures).toBe(0);
    await service.lock();
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expect(unlockWithPin(service, wrongPinKey)).rejects.toMatchObject({
        code: "PIN_INVALID",
      });
    }
    await expect(unlockWithPin(service, wrongPinKey)).rejects.toMatchObject({
      code: "PIN_REMOVED",
    });
    expect((await local.get([PIN_KEY]))[PIN_KEY]).toBeUndefined();
    expect((await service.getState()).pinAvailable).toBe(false);
    await expect(service.createPinChallenge(popupBinding)).rejects.toMatchObject({
      code: "PIN_UNAVAILABLE",
    });
    expect((await service.getState()).state).toBe("locked");
  });

  it("removes the PIN on request and ignores a malformed record", async () => {
    const { service, local } = fixture();
    await setup(service);
    await service.setPin(pinKey.slice(), pinKdf);
    await service.removePin();
    expect((await service.getState()).pinAvailable).toBe(false);
    await local.set({ [PIN_KEY]: { version: 1, wrapped: "nonsense", failures: 0 } });
    expect((await service.getState()).pinAvailable).toBe(false);
  });
});
