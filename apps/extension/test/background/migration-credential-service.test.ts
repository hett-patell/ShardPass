import { FakeStoragePort } from "@shardpass/testing/fake-storage-port";
import { describe, expect, it, vi } from "vitest";

import type {
  MigrationCapability,
  SenderBinding,
} from "../../src/background/vault/session-service";
import {
  MigrationCredentialError,
  MigrationCredentialService,
} from "../../src/background/vault/migration-credential-service";

const sender: SenderBinding = {
  extensionId: "extension-id",
  contextKind: "vault",
  senderUrl: "chrome-extension://extension-id/vault/index.html",
  documentId: "vault-document-a",
  tabId: 4,
  frameId: 0,
};
const otherDocument = { ...sender, documentId: "vault-document-b" };
const keyBytes = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const canonicalKey = Buffer.from(keyBytes).toString("base64");
const salt = Buffer.from(Uint8Array.from({ length: 16 }, (_, index) => index)).toString("base64");

function envelope(ciphertext = "AQIDBAUGBwgJCgsMDQ4PEA==") {
  return {
    version: 1,
    salt,
    iv: "AAECAwQFBgcICQoL",
    ciphertext,
    iterations: 600_000,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
}

type Deferred = Readonly<{
  entered: Promise<void>;
  resume(): void;
}>;
function deferred(): Deferred {
  let markEntered!: () => void;
  let resume!: () => void;
  const entered = new Promise<void>((resolve) => (markEntered = resolve));
  const blocked = new Promise<void>((resolve) => (resume = resolve));
  return { entered, resume: () => resume(), blocked, markEntered } as Deferred & {
    blocked: Promise<void>;
    markEntered(): void;
  };
}

function fixture(randomValues?: string[]) {
  let now = 1_000;
  let identity = 0;
  let active = true;
  const local = new FakeStoragePort({
    vault: envelope(),
    settings: { autoLockMinutes: 7, lockOnScreenLock: false },
  });
  const originalGet = local.get.bind(local);
  type InternalDeferred = Deferred & { blocked: Promise<void>; markEntered(): void };
  const readGates: Array<InternalDeferred | null> = [];
  local.get = async (keys) => {
    const gate = readGates.shift();
    if (gate != null) {
      gate.markEntered();
      await gate.blocked;
    }
    return originalGet(keys);
  };
  const capabilityGates: Array<InternalDeferred | null> = [];
  const lockCallbacks = new Set<() => void>();
  const capabilities = new WeakSet<MigrationCapability>();
  const session = {
    beginMigration: vi.fn(() => {
      if (!active) throw new Error("locked");
      const capability = Object.freeze({ epoch: 3, activeGenerationId: "generation-a" });
      capabilities.add(capability);
      return Promise.resolve(capability);
    }),
    assertMigrationCapability: vi.fn(async (capability: MigrationCapability) => {
      const gate = capabilityGates.shift();
      if (gate != null) {
        gate.markEntered();
        await gate.blocked;
      }
      if (!active || !capabilities.has(capability)) throw new Error("locked");
    }),
    assertMigrationCapabilityCurrent: vi.fn((capability: MigrationCapability) => {
      if (!active || !capabilities.has(capability)) throw new Error("locked");
    }),
    onLockOrDispose: vi.fn((callback: () => void) => {
      lockCallbacks.add(callback);
      return () => lockCallbacks.delete(callback);
    }),
  };
  const values =
    randomValues ?? Array.from({ length: 200 }, () => (++identity).toString(16).padStart(32, "0"));
  const service = new MigrationCredentialService(local, session, {
    now: () => now,
    nextOpaqueId: () => values.shift() ?? (++identity).toString(16).padStart(32, "0"),
  });
  return {
    local,
    session,
    service,
    advance: (milliseconds: number) => (now += milliseconds),
    pauseCapability: (after = 0) => {
      const gate = deferred() as InternalDeferred;
      capabilityGates.push(...Array<null>(after).fill(null), gate);
      return gate;
    },
    pauseRead: (after = 0) => {
      const gate = deferred() as InternalDeferred;
      readGates.push(...Array<null>(after).fill(null), gate);
      return gate;
    },
    lock: () => {
      active = false;
      for (const callback of lockCallbacks) callback();
    },
    replaceCapability: () => {
      active = false;
    },
  };
}

async function token(values: ReturnType<typeof fixture>, boundSender = sender) {
  const challenge = await values.service.getCredentialChallenge(boundSender);
  return values.service.authorizeCredential(challenge.challengeId, canonicalKey, boundSender);
}

describe("MigrationCredentialService", () => {
  it("issues a short exact-document challenge from strict legacy header metadata only", async () => {
    const values = fixture();
    const challenge = await values.service.getCredentialChallenge(sender);
    expect(challenge).toEqual({
      challengeId: "00000000000000000000000000000001",
      kdf: {
        algorithm: "PBKDF2-HMAC-SHA-256",
        salt,
        iterations: 600_000,
        outputBytes: 32,
      },
      expiresAt: 31_000,
    });
    expect(values.session.beginMigration).toHaveBeenCalledTimes(1);
    expect(await values.local.get(["vault"])).toEqual({ vault: envelope() });
    const retained = values.service as unknown as {
      challenges: Map<string, unknown>;
      credentials: Map<string, unknown>;
    };
    expect(JSON.stringify([...retained.challenges.values()])).not.toContain("ciphertext");
    expect(retained.credentials.size).toBe(0);
  });

  it("rejects forged context labels before inspecting the legacy source", async () => {
    const values = fixture();
    for (const forged of [
      { ...sender, contextKind: "popup" as const },
      { ...sender, senderUrl: "chrome-extension://extension-id/popup/index.html" },
      { ...sender, senderUrl: "chrome-extension://other-id/vault/index.html" },
    ])
      await expect(values.service.getCredentialChallenge(forged)).rejects.toEqual(
        new MigrationCredentialError("CREDENTIAL_UNAVAILABLE"),
      );
    expect(values.session.beginMigration).not.toHaveBeenCalled();
  });

  it("consumes challenges on success, sender mismatch, expiry boundary, and malformed key attempts", async () => {
    for (const attempt of [
      { sender: otherDocument, key: canonicalKey },
      { sender, key: "not-base64" },
      { sender, key: Buffer.alloc(31).toString("base64") },
      { sender, key: `${canonicalKey.slice(0, -2)}f=` },
    ]) {
      const values = fixture();
      const challenge = await values.service.getCredentialChallenge(sender);
      await expect(
        values.service.authorizeCredential(challenge.challengeId, attempt.key, attempt.sender),
      ).rejects.toEqual(new MigrationCredentialError("CHALLENGE_INVALID"));
      await expect(
        values.service.authorizeCredential(challenge.challengeId, canonicalKey, sender),
      ).rejects.toEqual(new MigrationCredentialError("CHALLENGE_INVALID"));
    }
    const expired = fixture();
    const challenge = await expired.service.getCredentialChallenge(sender);
    expired.advance(30_000);
    await expect(
      expired.service.authorizeCredential(challenge.challengeId, canonicalKey, sender),
    ).rejects.toEqual(new MigrationCredentialError("CHALLENGE_INVALID"));
  });

  it("returns one-use tokens and destructively clears on success, mismatch, expiry, and callback failure", async () => {
    const success = fixture();
    const authorized = await token(success);
    let transient: Uint8Array | undefined;
    await expect(
      success.service.withCredential(authorized.credentialToken, sender, (key) => {
        transient = key;
        expect(key).toEqual(keyBytes);
        return "used";
      }),
    ).resolves.toBe("used");
    expect(transient).toEqual(new Uint8Array(32));
    await expect(
      success.service.withCredential(authorized.credentialToken, sender, () => undefined),
    ).rejects.toEqual(new MigrationCredentialError("CREDENTIAL_INVALID"));

    for (const mode of ["mismatch", "expiry", "throw"] as const) {
      const values = fixture();
      const issued = await token(values);
      if (mode === "expiry") values.advance(30_000);
      await expect(
        values.service.withCredential(
          issued.credentialToken,
          mode === "mismatch" ? otherDocument : sender,
          (key) => {
            if (mode === "throw") throw new Error("synthetic callback failure");
            return key.byteLength;
          },
        ),
      ).rejects.toThrow();
      await expect(
        values.service.withCredential(issued.credentialToken, sender, () => undefined),
      ).rejects.toEqual(new MigrationCredentialError("CREDENTIAL_INVALID"));
    }
  });

  it("does not issue a challenge after lock cleanup while source reading is paused", async () => {
    const values = fixture();
    const gate = values.pauseRead();
    const issuance = values.service.getCredentialChallenge(sender);
    await gate.entered;
    values.lock();
    gate.resume();
    await expect(issuance).rejects.toEqual(new MigrationCredentialError("CREDENTIAL_UNAVAILABLE"));
    const internal = values.service as unknown as {
      challenges: Map<string, unknown>;
      pendingIssuances: number;
    };
    expect(internal.challenges.size).toBe(0);
    expect(internal.pendingIssuances).toBe(0);
  });

  it.each([
    "lock-capability",
    "dispose-capability",
    "lock-source",
    "dispose-source",
    "root-final-capability",
    "source-final-capability",
  ] as const)(
    "cancels authorization and clears its decoded key while blocked at %s",
    async (mode) => {
      const values = fixture();
      const challenge = await values.service.getCredentialChallenge(sender);
      const gate = mode.endsWith("final-capability")
        ? values.pauseCapability(1)
        : mode.endsWith("capability")
          ? values.pauseCapability()
          : values.pauseRead();
      const authorization = values.service.authorizeCredential(
        challenge.challengeId,
        canonicalKey,
        sender,
      );
      await gate.entered;
      const internal = values.service as unknown as {
        inFlight: Set<{ key: Uint8Array; cancelled: boolean }>;
        credentials: Map<string, unknown>;
      };
      const operation = [...internal.inFlight][0]!;
      expect(operation.key).toEqual(keyBytes);
      if (mode.startsWith("dispose")) values.service.dispose();
      else if (mode.startsWith("root")) values.replaceCapability();
      else if (mode.startsWith("source"))
        await values.local.set({ vault: envelope("AgMEBQYHCAkKCwwNDg8QEQ==") });
      else values.lock();
      if (mode.startsWith("lock") || mode.startsWith("dispose")) {
        expect(operation.cancelled).toBe(true);
        expect(operation.key).toEqual(new Uint8Array(32));
      }
      gate.resume();
      await expect(authorization).rejects.toEqual(
        new MigrationCredentialError("CHALLENGE_INVALID"),
      );
      expect(internal.credentials.size).toBe(0);
      expect(internal.inFlight.size).toBe(0);
    },
  );

  it.each([
    "lock-first-capability",
    "dispose-first-capability",
    "lock-source",
    "dispose-source",
    "root-first-capability",
    "root-source",
    "root-final-capability",
    "root-final-source",
    "expiry-first-capability",
    "expiry-source",
    "expiry-final-capability",
    "expiry-final-source",
  ] as const)("never releases a key when consumption is invalidated at %s", async (mode) => {
    const values = fixture();
    const issued = await token(values);
    const gate = mode.endsWith("first-capability")
      ? values.pauseCapability()
      : mode.endsWith("final-source")
        ? values.pauseRead(1)
        : mode.endsWith("source")
          ? values.pauseRead()
          : values.pauseCapability(1);
    const callback = vi.fn();
    const consumption = values.service.withCredential(issued.credentialToken, sender, callback);
    await gate.entered;
    const internal = values.service as unknown as {
      inFlight: Set<{ key: Uint8Array; cancelled: boolean }>;
    };
    const operation = [...internal.inFlight][0]!;
    if (mode.startsWith("lock")) values.lock();
    if (mode.startsWith("dispose")) values.service.dispose();
    if (mode.startsWith("root")) values.replaceCapability();
    if (mode.startsWith("expiry")) values.advance(30_000);
    if (mode.startsWith("lock") || mode.startsWith("dispose")) {
      expect(operation.cancelled).toBe(true);
      expect(operation.key).toEqual(new Uint8Array(32));
    }
    gate.resume();
    await expect(consumption).rejects.toEqual(new MigrationCredentialError("CREDENTIAL_INVALID"));
    expect(callback).not.toHaveBeenCalled();
    expect(internal.inFlight.size).toBe(0);
    expect(operation.key).toEqual(new Uint8Array(32));
  });

  it("passes the validated immutable source snapshot with the transient key and rejects later replacement", async () => {
    const values = fixture();
    const issued = await token(values);
    let captured: unknown;
    await values.service.withCredential(issued.credentialToken, sender, (key, source) => {
      expect(key).toEqual(keyBytes);
      captured = source;
      expect(Object.isFrozen(source)).toBe(true);
      return undefined;
    });
    expect(captured).toEqual({
      envelope: envelope(),
      settings: { autoLockMinutes: 7, lockOnScreenLock: false },
    });

    const changed = fixture();
    const changedToken = await token(changed);
    const gate = changed.pauseCapability(1);
    const callback = vi.fn();
    const consumption = changed.service.withCredential(
      changedToken.credentialToken,
      sender,
      callback,
    );
    await gate.entered;
    await changed.local.set({ vault: envelope("AgMEBQYHCAkKCwwNDg8QEQ==") });
    gate.resume();
    await expect(consumption).rejects.toEqual(new MigrationCredentialError("CREDENTIAL_INVALID"));
    expect(callback).not.toHaveBeenCalled();

    const settingsChanged = fixture();
    const settingsToken = await token(settingsChanged);
    const settingsGate = settingsChanged.pauseCapability(1);
    const settingsCallback = vi.fn();
    const settingsConsumption = settingsChanged.service.withCredential(
      settingsToken.credentialToken,
      sender,
      settingsCallback,
    );
    await settingsGate.entered;
    await settingsChanged.local.set({
      settings: { autoLockMinutes: 8, lockOnScreenLock: false },
    });
    settingsGate.resume();
    await expect(settingsConsumption).rejects.toEqual(
      new MigrationCredentialError("CREDENTIAL_INVALID"),
    );
    expect(settingsCallback).not.toHaveBeenCalled();
  });

  it("invalidates authorization when source or active capability changes", async () => {
    const sourceChanged = fixture();
    const sourceChallenge = await sourceChanged.service.getCredentialChallenge(sender);
    await sourceChanged.local.set({ vault: envelope("AgMEBQYHCAkKCwwNDg8QEQ==") });
    await expect(
      sourceChanged.service.authorizeCredential(sourceChallenge.challengeId, canonicalKey, sender),
    ).rejects.toEqual(new MigrationCredentialError("CHALLENGE_INVALID"));

    const rootChanged = fixture();
    const issued = await token(rootChanged);
    rootChanged.replaceCapability();
    await expect(
      rootChanged.service.withCredential(issued.credentialToken, sender, () => undefined),
    ).rejects.toEqual(new MigrationCredentialError("CREDENTIAL_INVALID"));
  });

  it("clears all owned key bytes on lock and dispose without letting cleanup failures escape", async () => {
    const values = fixture();
    const first = await token(values);
    values.lock();
    await expect(
      values.service.withCredential(first.credentialToken, sender, () => undefined),
    ).rejects.toEqual(new MigrationCredentialError("CREDENTIAL_INVALID"));

    const unlocked = fixture();
    const second = await token(unlocked);
    expect(() => unlocked.service.dispose()).not.toThrow();
    expect(() => unlocked.service.dispose()).not.toThrow();
    await expect(
      unlocked.service.withCredential(second.credentialToken, sender, () => undefined),
    ).rejects.toEqual(new MigrationCredentialError("CREDENTIAL_INVALID"));
  });

  it("captures proxy sender fields once and a new worker instance cannot consume an old token", async () => {
    const values = fixture();
    const reads = new Map<string, number>();
    const proxy = new Proxy(sender, {
      get(target, property, receiver) {
        if (typeof property === "string") reads.set(property, (reads.get(property) ?? 0) + 1);
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const challenge = await values.service.getCredentialChallenge(proxy);
    expect([...reads.values()].every((count) => count === 1)).toBe(true);
    const authorized = await values.service.authorizeCredential(
      challenge.challengeId,
      canonicalKey,
      sender,
    );
    const restarted = fixture();
    await expect(
      restarted.service.withCredential(authorized.credentialToken, sender, () => undefined),
    ).rejects.toEqual(new MigrationCredentialError("CREDENTIAL_INVALID"));
  });

  it("bounds outstanding state, replaces per-sender entries destructively, and prunes before capacity", async () => {
    const values = fixture();
    const firstChallenge = await values.service.getCredentialChallenge(sender);
    const replacementChallenge = await values.service.getCredentialChallenge(sender);
    const internal = values.service as unknown as {
      challenges: Map<string, unknown>;
      credentials: Map<string, { key: Uint8Array }>;
      inFlight: Set<unknown>;
    };
    expect(internal.challenges.size).toBe(1);
    await expect(
      values.service.authorizeCredential(firstChallenge.challengeId, canonicalKey, sender),
    ).rejects.toEqual(new MigrationCredentialError("CHALLENGE_INVALID"));
    const firstToken = await values.service.authorizeCredential(
      replacementChallenge.challengeId,
      canonicalKey,
      sender,
    );
    const firstOwnedKey = internal.credentials.get(firstToken.credentialToken)!.key;
    const nextChallenge = await values.service.getCredentialChallenge(sender);
    await values.service.authorizeCredential(nextChallenge.challengeId, canonicalKey, sender);
    expect(internal.credentials.size).toBe(1);
    expect(firstOwnedKey).toEqual(new Uint8Array(32));

    const capped = fixture();
    for (let index = 0; index < 32; index++)
      await capped.service.getCredentialChallenge({
        ...sender,
        documentId: `vault-document-${index}`,
      });
    await expect(
      capped.service.getCredentialChallenge({ ...sender, documentId: "vault-document-over-cap" }),
    ).rejects.toEqual(new MigrationCredentialError("CREDENTIAL_UNAVAILABLE"));
    const cappedInternal = capped.service as unknown as {
      challenges: Map<string, unknown>;
      credentials: Map<string, unknown>;
      inFlight: Set<unknown>;
    };
    expect(
      cappedInternal.challenges.size +
        cappedInternal.credentials.size +
        cappedInternal.inFlight.size,
    ).toBe(32);
    capped.advance(30_000);
    await expect(
      capped.service.getCredentialChallenge({
        ...sender,
        documentId: "vault-document-after-prune",
      }),
    ).resolves.toBeDefined();
    expect(cappedInternal.challenges.size).toBe(1);
  });

  it("reserves global capacity across concurrent challenge issuance and keeps only the latest per sender", async () => {
    const values = fixture();
    const gates = Array.from({ length: 32 }, () => values.pauseRead());
    const requests = Array.from({ length: 33 }, (_, index) =>
      values.service.getCredentialChallenge({
        ...sender,
        documentId: `parallel-document-${index}`,
      }),
    );
    await Promise.all(gates.map((gate) => gate.entered));
    gates.forEach((gate) => gate.resume());
    const settled = await Promise.allSettled(requests);
    expect(settled.filter((entry) => entry.status === "fulfilled")).toHaveLength(32);
    expect(settled.filter((entry) => entry.status === "rejected")).toHaveLength(1);
    const capacityInternal = values.service as unknown as {
      challenges: Map<string, unknown>;
      credentials: Map<string, unknown>;
      inFlight: Set<unknown>;
      pendingIssuances: number;
    };
    expect(
      capacityInternal.challenges.size +
        capacityInternal.credentials.size +
        capacityInternal.inFlight.size +
        capacityInternal.pendingIssuances,
    ).toBe(32);

    const sameSender = fixture();
    const firstGate = sameSender.pauseRead();
    const secondGate = sameSender.pauseRead();
    const first = sameSender.service.getCredentialChallenge(sender);
    const second = sameSender.service.getCredentialChallenge(sender);
    await Promise.all([firstGate.entered, secondGate.entered]);
    firstGate.resume();
    secondGate.resume();
    const sameSettled = await Promise.all([first, second]);
    const internal = sameSender.service as unknown as { challenges: Map<string, unknown> };
    expect(internal.challenges.size).toBe(1);
    const live = sameSettled.find((challenge) => internal.challenges.has(challenge.challengeId))!;
    const replaced = sameSettled.find((challenge) => challenge !== live)!;
    await expect(
      sameSender.service.authorizeCredential(replaced.challengeId, canonicalKey, sender),
    ).rejects.toEqual(new MigrationCredentialError("CHALLENGE_INVALID"));
    await expect(
      sameSender.service.authorizeCredential(live.challengeId, canonicalKey, sender),
    ).resolves.toBeDefined();
  });

  it("bounds random collision retries and never overwrites a live authorization", async () => {
    const collision = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const values = fixture(Array(40).fill(collision));
    await values.service.getCredentialChallenge(sender);
    await expect(values.service.getCredentialChallenge(otherDocument)).rejects.toEqual(
      new MigrationCredentialError("CREDENTIAL_UNAVAILABLE"),
    );
  });
});
