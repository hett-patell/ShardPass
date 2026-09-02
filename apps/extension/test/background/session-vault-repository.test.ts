import {
  createDeterministicRandomSource,
  unwrapVaultDataKeyWithKeyEncryptionKey,
} from "@shardpass/crypto";
import type { LoginItem, OtpItem } from "@shardpass/domain";
import {
  ACTIVE_ROOT_KEY,
  GenerationStore,
  VaultRootSchema,
  type StorageValue,
  type VaultRoot,
} from "@shardpass/storage";
import { FakeStoragePort } from "@shardpass/testing/fake-storage-port";
import { describe, expect, expectTypeOf, it } from "vitest";

import { SessionService } from "../../src/background/vault/session-service";
import type { SessionVaultRepository } from "../../src/background/vault/session-vault-repository";

const kek = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const binding = {
  extensionId: "extension-id",
  contextKind: "popup" as const,
  senderUrl: "chrome-extension://extension-id/popup/index.html",
  documentId: "popup-document-1",
};

function otpCandidate(): OtpItem {
  return {
    id: "018f47a6-7d11-7c2f-8bd9-a1d37f147a20",
    schemaVersion: 2,
    revision: 1,
    createdAt: "2026-08-10T12:00:00.000Z",
    updatedAt: "2026-08-10T12:00:00.000Z",
    favorite: false,
    tags: [],
    kind: "otp",
    issuer: "Synthetic",
    label: "account",
    secret: "JBSWY3DPEHPK3PXP",
    otpType: "totp",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    note: "",
  };
}

function loginCandidate(overrides: Partial<LoginItem> = {}): LoginItem {
  return {
    id: "018f47a6-7d11-7c2f-8bd9-a1d37f147b30",
    schemaVersion: 2,
    revision: 1,
    createdAt: "2026-08-10T12:00:00.000Z",
    updatedAt: "2026-08-10T12:00:00.000Z",
    favorite: false,
    tags: [],
    kind: "login",
    name: "Example",
    username: "alice",
    password: "s3cret",
    urls: ["https://example.test"],
    notes: "",
    ...overrides,
  };
}

function fixture(local = new FakeStoragePort()) {
  let id = 0;
  const session = new SessionService({
    local,
    session: new FakeStoragePort(),
    random: createDeterministicRandomSource(
      Uint8Array.from({ length: 8192 }, (_, index) => index % 251),
    ),
    now: () => 1_000,
    isoNow: () => "2026-08-10T12:00:00.000Z",
    nextId: () => `00000000-0000-4000-8000-${(++id).toString().padStart(12, "0")}`,
  });
  return { local, session, bridge: session.vaultRepository };
}

async function setup(session: SessionService): Promise<void> {
  const challenge = await session.createChallenge("setup", binding);
  await session.setup(challenge.challengeId, kek.slice(), binding);
}

async function activeRoot(local: FakeStoragePort): Promise<VaultRoot | null> {
  const value = (await local.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY];
  return value === undefined ? null : VaultRootSchema.parse(value);
}

async function expectActiveAuthentication(
  local: FakeStoragePort,
  expected: "authenticated" | "corrupt" | "deleted",
): Promise<void> {
  const root = await activeRoot(local);
  if (expected === "deleted") {
    expect(root).toBeNull();
    return;
  }
  expect(root).not.toBeNull();
  const dek = await unwrapVaultDataKeyWithKeyEncryptionKey(kek.slice(), root!.wrappedKey);
  const read = new GenerationStore(local).readActive({ dek });
  if (expected === "authenticated") await expect(read).resolves.toMatchObject({ root });
  else await expect(read).rejects.toMatchObject({ code: "STORAGE_CORRUPT" });
  dek.fill(0);
}

describe("SessionVaultRepository", () => {
  it("exposes one stable domain bridge and no generic repository callback API", () => {
    const { bridge, session } = fixture();

    expect(session.vaultRepository).toBe(bridge);
    expect(session.vaultRepository).toBe(session.vaultRepository);
    expect(Object.isFrozen(session.vaultRepository)).toBe(true);
    expectTypeOf(session.vaultRepository).toEqualTypeOf<SessionVaultRepository>();
    const runtimeKeys = new Set([
      ...Reflect.ownKeys(session),
      ...Reflect.ownKeys(Object.getPrototypeOf(session) as object),
    ]);
    expect([...runtimeKeys].some((key) => String(key).includes("runRepositoryOperation"))).toBe(
      false,
    );
    expect("runRepositoryRead" in session).toBe(false);
    expect("runRepositoryMutation" in session).toBe(false);
    // @ts-expect-error context-bearing generic execution must not be public
    void session.runRepositoryRead;
    // @ts-expect-error context-bearing generic execution must not be public
    void session.runRepositoryMutation;
    expect(Object.keys(bridge).sort()).toEqual([
      "cancelHotpReservation",
      "commitHotpReservation",
      "create",
      "createItem",
      "get",
      "getItem",
      "importOtpBatch",
      "importPortableOtpItems",
      "importPortableState",
      "listAllItems",
      "listItems",
      "listMetadata",
      "migrateLegacySchema",
      "previewPortableImport",
      "previewPortableOtpItems",
      "readGenerationMetadata",
      "readOtpItemsAndMetadata",
      "readPortableState",
      "removeOtpMetadataIfEpoch",
      "replaceOtpItemsAndMetadata",
      "replaceOtpItemsAndMetadataIfEpoch",
      "savePendingHotpReservation",
      "tombstone",
      "update",
      "updateItem",
    ]);
  });

  it("exposes portable state and import operations without context or repository escape", async () => {
    const { bridge, session } = fixture();
    await setup(session);
    const created = await bridge.create(otpCandidate());

    const state = await bridge.readPortableState();
    expect(state.items).toEqual([created]);
    expect(state.journal).toHaveLength(1);
    expect(state.tombstones).toEqual([]);
    const preview = await bridge.previewPortableOtpItems([created]);
    expect(preview.statuses).toEqual(["duplicate"]);
    await expect(bridge.importPortableOtpItems([created], preview.statuses)).resolves.toMatchObject(
      {
        imported: 0,
        duplicate: 1,
        previewChanged: false,
      },
    );
  });

  it("returns one fresh frozen OTP-only authenticated snapshot", async () => {
    const { bridge, session } = fixture();
    await setup(session);
    const created = await bridge.create(otpCandidate());

    const first = await bridge.listItems();
    const second = await bridge.listItems();

    expect(first).toEqual([created]);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expect(first[0]!.tags).not.toBe(second[0]!.tags);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0])).toBe(true);
    expect(Object.isFrozen(first[0]!.tags)).toBe(true);
  });

  it("keeps otp.list working once a non-OTP item exists, and exposes it only through the generic bridge", async () => {
    const { bridge, session } = fixture();
    await setup(session);
    const otp = await bridge.create(otpCandidate());
    const login = (await bridge.createItem(loginCandidate())) as LoginItem;

    // The OTP-only view must not throw once a non-OTP item is present: it silently
    // excludes it rather than asserting, which used to break every OTP.list call as
    // soon as any other item kind existed in the same vault.
    await expect(bridge.listItems()).resolves.toEqual([otp]);
    await expect(bridge.get(login.id)).resolves.toBeNull();

    const all = await bridge.listAllItems();
    expect([...all].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [otp, login].sort((a, b) => a.id.localeCompare(b.id)),
    );
    await expect(bridge.getItem(login.id)).resolves.toEqual(login);
    await expect(bridge.getItem(otp.id)).resolves.toEqual(otp);

    const updated = (await bridge.updateItem(
      { ...login, username: "renamed" },
      login.revision,
    )) as LoginItem;
    expect(updated).toMatchObject({ id: login.id, revision: 2, username: "renamed" });
    await expect(bridge.getItem(login.id)).resolves.toEqual(updated);
  });

  it("fails closed when explicit lock wins during an OTP snapshot", async () => {
    const { bridge, local, session } = fixture();
    await setup(session);
    await bridge.create(otpCandidate());
    const originalGet = local.get.bind(local);
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let pause = true;
    local.get = async (keys) => {
      if (pause && keys.includes(ACTIVE_ROOT_KEY)) {
        pause = false;
        entered();
        await gate;
      }
      return originalGet(keys);
    };

    const operation = bridge.listItems();
    await started;
    const locking = session.lock();
    release();

    await expect(operation).rejects.toMatchObject({ code: "VAULT_LOCKED" });
    await expect(locking).resolves.toBeUndefined();
    await expect(session.getState()).resolves.toMatchObject({ state: "locked" });
  });

  it.each(["read", "mutation-before-candidate", "mutation-after-candidate"] as const)(
    "accepts a delayed own-root notification crossing a subsequent %s",
    async (crossing) => {
      const { bridge, local, session } = fixture();
      await setup(session);
      const created = await bridge.create(otpCandidate());
      const ownRoot = await activeRoot(local);
      expect(ownRoot).not.toBeNull();
      let notification: Promise<void> | undefined;
      if (crossing === "read") {
        const originalGet = local.get.bind(local);
        let delivered = false;
        local.get = async (keys) => {
          if (!delivered && keys.includes(ACTIVE_ROOT_KEY)) {
            delivered = true;
            notification = session.handleActiveRootChange(ownRoot);
          }
          return originalGet(keys);
        };
        await expect(bridge.listMetadata()).resolves.toHaveLength(1);
      } else {
        const originalSet = local.set.bind(local);
        let delivered = false;
        local.set = async (entries) => {
          const candidate = entries[ACTIVE_ROOT_KEY];
          if (!delivered && candidate !== undefined) {
            delivered = true;
            if (crossing === "mutation-before-candidate")
              notification = session.handleActiveRootChange(ownRoot);
            await originalSet(entries);
            if (crossing === "mutation-after-candidate")
              notification = session.handleActiveRootChange(ownRoot);
            return;
          }
          await originalSet(entries);
        };
        await expect(
          bridge.update({ ...created, label: crossing }, created.revision),
        ).resolves.toMatchObject({ revision: 2 });
      }
      await expect(notification).resolves.toBeUndefined();
      await expect(session.getState()).resolves.toMatchObject({ state: "unlocked" });
      await expectActiveAuthentication(local, "authenticated");
    },
  );

  it("does not let a forged stale expected-root notification mask a storage mismatch", async () => {
    const { bridge, local, session } = fixture();
    await setup(session);
    await bridge.create(otpCandidate());
    const staleRoot = await activeRoot(local);
    expect(staleRoot).not.toBeNull();
    const replacement = VaultRootSchema.parse({
      ...staleRoot!,
      activeGenerationId: "10000000-0000-4000-8000-000000000099",
    });
    await local.set({ [ACTIVE_ROOT_KEY]: JSON.parse(JSON.stringify(replacement)) as StorageValue });
    const notification = session.handleActiveRootChange(staleRoot);

    await expect(bridge.listMetadata()).rejects.toMatchObject({ code: "VAULT_UNAVAILABLE" });
    await expect(notification).resolves.toBeUndefined();
    await expect(session.getState()).resolves.toMatchObject({ state: "locked" });
    expect(await activeRoot(local)).toEqual(replacement);
  });

  it("does not lock on its own authenticated root notification", async () => {
    const { bridge, local, session } = fixture();
    await setup(session);

    await bridge.create(otpCandidate());
    const activated = (await local.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY];
    await session.handleActiveRootChange(activated);

    await expect(session.getState()).resolves.toMatchObject({ state: "unlocked" });
  });

  it("fails closed when explicit lock wins during a repository read", async () => {
    const { bridge, local, session } = fixture();
    await setup(session);
    await bridge.create(otpCandidate());
    const originalGet = local.get.bind(local);
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let pause = true;
    local.get = async (keys) => {
      if (pause && keys.includes(ACTIVE_ROOT_KEY)) {
        pause = false;
        entered();
        await gate;
      }
      return originalGet(keys);
    };

    const operation = bridge.listMetadata();
    await started;
    const locking = session.lock();
    release();

    await expect(operation).rejects.toMatchObject({ code: "VAULT_LOCKED" });
    await expect(locking).resolves.toBeUndefined();
    await expect(session.getState()).resolves.toMatchObject({ state: "locked" });
  });

  it.each(["before-candidate-write", "after-candidate-write"] as const)(
    "locks when a non-candidate root notification crosses %s",
    async (timing) => {
      const { bridge, local, session } = fixture();
      await setup(session);
      const created = await bridge.create(otpCandidate());
      const originalSet = local.set.bind(local);
      let notification: Promise<void> | undefined;
      local.set = async (entries) => {
        const candidate = entries[ACTIVE_ROOT_KEY] as Record<string, StorageValue> | undefined;
        if (candidate === undefined) return originalSet(entries);
        const external = {
          ...candidate,
          activeGenerationId: "10000000-0000-4000-8000-000000000099",
        };
        if (timing === "before-candidate-write") {
          await originalSet({ [ACTIVE_ROOT_KEY]: external });
          notification = session.handleActiveRootChange(external);
        }
        await originalSet(entries);
        if (timing === "after-candidate-write") {
          await originalSet({ [ACTIVE_ROOT_KEY]: external });
          notification = session.handleActiveRootChange(external);
        }
      };

      const operation = bridge.update({ ...created, label: "changed" }, created.revision);

      await expect(operation).rejects.toMatchObject({ code: "VAULT_LOCKED" });
      await expect(notification).resolves.toBeUndefined();
      await expect(session.getState()).resolves.toMatchObject({ state: "locked" });
      await expectActiveAuthentication(
        local,
        timing === "before-candidate-write" ? "authenticated" : "corrupt",
      );
    },
  );

  it("handles a reentrant candidate notification without deadlock", async () => {
    const { bridge, local, session } = fixture();
    await setup(session);
    const originalSet = local.set.bind(local);
    let notification: Promise<void> | undefined;
    local.set = async (entries) => {
      await originalSet(entries);
      if (entries[ACTIVE_ROOT_KEY] !== undefined)
        notification = session.handleActiveRootChange(entries[ACTIVE_ROOT_KEY]);
    };

    await expect(
      Promise.race([
        bridge.create(otpCandidate()),
        new Promise((_, reject) => setTimeout(() => reject(new Error("operation timed out")), 250)),
      ]),
    ).resolves.toMatchObject({ revision: 1 });
    await expect(notification).resolves.toBeUndefined();
    await expect(session.getState()).resolves.toMatchObject({ state: "unlocked" });
  });

  it("locks on activation failure before the candidate write", async () => {
    const { bridge, local, session } = fixture();
    await setup(session);
    const originalSet = local.set.bind(local);
    local.set = async (entries) => {
      if (entries[ACTIVE_ROOT_KEY] !== undefined)
        throw new Error("synthetic failure before candidate write");
      return originalSet(entries);
    };

    await expect(bridge.create(otpCandidate())).rejects.toMatchObject({ code: "VAULT_LOCKED" });
    await expect(session.getState()).resolves.toMatchObject({ state: "locked" });
    await expectActiveAuthentication(local, "authenticated");
  });

  it("locks without false success on ambiguous failure after the candidate write", async () => {
    const { bridge, local, session } = fixture();
    await setup(session);
    const originalSet = local.set.bind(local);
    local.set = async (entries) => {
      await originalSet(entries);
      if (entries[ACTIVE_ROOT_KEY] !== undefined)
        throw new Error("synthetic failure after candidate write");
    };

    await expect(bridge.create(otpCandidate())).rejects.toMatchObject({ code: "VAULT_LOCKED" });
    await expect(session.getState()).resolves.toMatchObject({ state: "locked" });
    await expectActiveAuthentication(local, "authenticated");
  });

  it("locks when candidate authentication fails after activation", async () => {
    const { bridge, local, session } = fixture();
    await setup(session);
    const originalSet = local.set.bind(local);
    local.set = async (entries) => {
      await originalSet(entries);
      const candidate = entries[ACTIVE_ROOT_KEY] as { activeGenerationId?: string } | undefined;
      if (candidate?.activeGenerationId !== undefined)
        await local.remove([`shardpass:v1:g:${candidate.activeGenerationId}:verified`]);
    };

    await expect(bridge.create(otpCandidate())).rejects.toMatchObject({ code: "VAULT_LOCKED" });
    await expect(session.getState()).resolves.toMatchObject({ state: "locked" });
    await expectActiveAuthentication(local, "corrupt");
  });

  it("locks when a malformed notification crosses an authenticated activation", async () => {
    const { bridge, local, session } = fixture();
    await setup(session);
    const originalSet = local.set.bind(local);
    let notification: Promise<void> | undefined;
    local.set = async (entries) => {
      if (entries[ACTIVE_ROOT_KEY] !== undefined)
        notification = session.handleActiveRootChange({ malformed: true });
      await originalSet(entries);
    };

    await expect(bridge.create(otpCandidate())).rejects.toMatchObject({ code: "VAULT_LOCKED" });
    await expect(notification).resolves.toBeUndefined();
    await expect(session.getState()).resolves.toMatchObject({ state: "locked" });
    await expectActiveAuthentication(local, "authenticated");
  });

  it("locks when an external root wins during a repository mutation", async () => {
    const { bridge, local, session } = fixture();
    await setup(session);
    const created = await bridge.create(otpCandidate());
    const originalSet = local.set.bind(local);
    local.set = async (entries) => {
      const candidate = entries[ACTIVE_ROOT_KEY] as Record<string, StorageValue> | undefined;
      if (candidate === undefined) return originalSet(entries);
      await originalSet({
        [ACTIVE_ROOT_KEY]: {
          ...candidate,
          activeGenerationId: "10000000-0000-4000-8000-000000000099",
        },
      });
    };

    await expect(
      bridge.update({ ...created, label: "changed" }, created.revision),
    ).rejects.toMatchObject({ code: "VAULT_LOCKED" });
    await expect(session.getState()).resolves.toMatchObject({ state: "locked" });
    const persisted = await activeRoot(local);
    expect(persisted?.activeGenerationId).toBe("10000000-0000-4000-8000-000000000099");
    await expectActiveAuthentication(local, "corrupt");
  });

  it("imports a browser candidate that includes its source ordinal", async () => {
    const { bridge, session } = fixture();
    await setup(session);
    await expect(
      bridge.importOtpBatch(
        [
          {
            sourceOrdinal: 1,
            issuer: "Synthetic",
            label: "browser-imported",
            secret: "JBSWY3DPEHPK3PXP",
            otpType: "totp",
            algorithm: "SHA1",
            digits: 6,
            period: 30,
            favorite: false,
            tags: [],
            note: "",
          } as Parameters<typeof bridge.importOtpBatch>[0][number],
        ],
        ["accepted"],
      ),
    ).resolves.toMatchObject({ imported: 1, previewChanged: false });
  });

  it("atomically replaces OTP items, journal observations, and encrypted Ente metadata once", async () => {
    const { bridge, local, session } = fixture();
    await setup(session);
    await bridge.create(otpCandidate());
    const before = await activeRoot(local);
    const writesBefore = local.writes.filter((write) =>
      write.keys.includes(ACTIVE_ROOT_KEY),
    ).length;
    const stateBytes = new TextEncoder().encode('{"secret":"encrypted-generation-only"}');
    const candidate = { ...otpCandidate(), label: "remote-observed" };

    const narrow = bridge as Required<
      Pick<SessionVaultRepository, "readOtpItemsAndMetadata" | "replaceOtpItemsAndMetadataIfEpoch">
    >;
    const snapshot = await narrow.readOtpItemsAndMetadata("ente-otp-state");
    await expect(
      narrow.replaceOtpItemsAndMetadataIfEpoch(snapshot.sessionEpoch, [candidate], {
        name: "ente-otp-state",
        schemaVersion: 1,
        plaintext: stateBytes,
      }),
    ).resolves.toBe("activated");

    const after = await activeRoot(local);
    expect(after?.activeGenerationId).not.toBe(before?.activeGenerationId);
    expect(
      local.writes.filter((write) => write.keys.includes(ACTIVE_ROOT_KEY)).length - writesBefore,
    ).toBe(1);
    const reread = await narrow.readOtpItemsAndMetadata("ente-otp-state");
    expect(reread.items).toHaveLength(1);
    expect(reread.items[0]?.label).toBe("remote-observed");
    expect(new TextDecoder().decode(reread.metadata!)).toBe(
      '{"secret":"encrypted-generation-only"}',
    );
    const persisted = JSON.stringify(await local.snapshot());
    expect(persisted).not.toContain("encrypted-generation-only");
    expect(persisted).not.toContain("remote-observed");
  });

  it("rejects a stale session epoch without staging or activating a partial generation", async () => {
    const { bridge, local, session } = fixture();
    await setup(session);
    const narrow = bridge as Required<
      Pick<SessionVaultRepository, "readOtpItemsAndMetadata" | "replaceOtpItemsAndMetadataIfEpoch">
    >;
    const snapshot = await narrow.readOtpItemsAndMetadata("ente-otp-state");
    await bridge.create(otpCandidate());
    const root = await activeRoot(local);
    const writes = local.writeCount;

    await expect(
      narrow.replaceOtpItemsAndMetadataIfEpoch(snapshot.sessionEpoch, [], {
        name: "ente-otp-state",
        schemaVersion: 1,
        plaintext: new Uint8Array([1]),
      }),
    ).resolves.toBe("root-changed");
    expect(await activeRoot(local)).toEqual(root);
    expect(local.writeCount).toBe(writes);
    await expect(bridge.listItems()).resolves.toHaveLength(1);
  });

  it("imports a normalized batch through the session-owned atomic bridge", async () => {
    const { bridge, local, session } = fixture();
    await setup(session);
    const before = await activeRoot(local);

    const result = await bridge.importOtpBatch(
      [
        {
          issuer: "Synthetic",
          label: "imported",
          secret: "JBSWY3DPEHPK3PXP",
          otpType: "hotp",
          algorithm: "SHA256",
          digits: 8,
          period: 0,
          counter: 0,
          favorite: true,
          tags: ["local"],
          note: "preserved",
        },
      ],
      ["accepted"],
    );

    expect(result).toMatchObject({ imported: 1, duplicate: 0, previewChanged: false });
    expect(result.items[0]).toMatchObject({ counter: 0, favorite: true, tags: ["local"] });
    expect((await activeRoot(local))?.activeGenerationId).not.toBe(before?.activeGenerationId);
  });

  it("owns and clears a deep batch copy after the session mutation finishes", async () => {
    const { bridge, session } = fixture();
    await setup(session);
    const sourceTags = ["local"];
    const source = [
      {
        issuer: "Synthetic",
        label: "owned",
        secret: "JBSWY3DPEHPK3PXP",
        otpType: "totp" as const,
        algorithm: "SHA1" as const,
        digits: 6,
        period: 30,
        favorite: false,
        tags: sourceTags,
        note: "",
      },
    ];
    let owned: readonly { tags: readonly string[] }[] | undefined;
    const result = bridge.importOtpBatch(source, ["accepted"], (candidates) => {
      owned = candidates;
    });
    source.splice(0);
    sourceTags.splice(0);

    await expect(result).resolves.toMatchObject({ imported: 1 });
    expect(owned).not.toBe(source);
    expect(owned?.[0]?.tags).not.toBe(sourceTags);
    expect(owned).toHaveLength(0);
  });

  it("locks when the external active root is deleted", async () => {
    const { bridge, local, session } = fixture();
    await setup(session);
    await bridge.create(otpCandidate());

    await local.remove([ACTIVE_ROOT_KEY]);
    await session.handleActiveRootChange(undefined);

    await expect(bridge.listMetadata()).rejects.toMatchObject({ code: "VAULT_LOCKED" });
    await expect(session.getState()).resolves.toMatchObject({ state: "unconfigured" });
    await expectActiveAuthentication(local, "deleted");
  });
});
