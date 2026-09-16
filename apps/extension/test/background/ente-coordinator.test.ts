import { describe, expect, it, vi } from "vitest";

import { EnteProtocolError, type EnteOtpProjection } from "../../src/background/ente/protocol";
import {
  createEnteOperationalCycle,
  type EnteCycleRepository,
  type EnteCycleSnapshot,
} from "../../src/background/ente/operational-cycle";
import type { RemoteOtpState } from "../../src/background/ente/read-engine";
import type { EnteOtpSyncState } from "../../src/background/ente/sync-state";

const localId = "00000000-0000-4000-8000-000000000001";
const remoteId = "00000000-0000-4000-8000-000000000002";
const operationId = "00000000-0000-4000-8000-000000000003";
const digest = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const projection: EnteOtpProjection = {
  version: 1,
  kind: "otp",
  otpType: "totp",
  issuer: "Example",
  label: "alice",
  secretBase32: "JBSWY3DPEHPK3PXP",
  algorithm: "SHA1",
  digits: 6,
  period: 30,
};
const state = (overrides: Partial<EnteOtpSyncState> = {}): EnteOtpSyncState => ({
  version: 1,
  protocolPin: "c69dcf66704ad7ec1f95e32920455be429a566ef",
  origin: "https://api.ente.io",
  accountFingerprint: digest,
  snapshotAccountFingerprint: null,
  initialSnapshotEstablished: false,
  credentialEnvelope: "credential",
  authKeyEnvelope: "key-envelope",
  mappings: [],
  bases: [],
  cursor: 0,
  pending: [],
  uncertain: null,
  conflicts: [],
  scheduler: { connected: true, lastAttemptAt: null, lastSuccessAt: null },
  needsReauth: false,
  ...overrides,
});
const snapshot = (syncState = state()): EnteCycleSnapshot => ({
  sessionEpoch: 1,
  state: syncState,
  items: [],
});
function repository(initial: EnteCycleSnapshot) {
  let current = initial;
  const commit = vi.fn(
    (expectedEpoch: number, mutation: Parameters<EnteCycleRepository["commit"]>[1]) => {
      if (expectedEpoch !== current.sessionEpoch) return Promise.resolve("root-changed" as const);
      current = {
        sessionEpoch: current.sessionEpoch + 1,
        state: mutation.state,
        items: mutation.items,
      };
      return Promise.resolve("activated" as const);
    },
  );
  return { read: vi.fn(() => Promise.resolve(current)), commit, current: () => current };
}
const crypto = {
  openCredential: vi.fn(() => Promise.resolve("token")),
  openAuthKey: vi.fn(() => Promise.resolve(new Uint8Array(32).fill(7))),
  decryptEntity: vi.fn(() => projection),
  openProjection: vi.fn(() => Promise.resolve(projection)),
  sealProjection: vi.fn(() => Promise.resolve("sealed")),
  digestProjection: vi.fn(() => Promise.resolve(digest)),
  encryptEntity: vi.fn(() => ({ encryptedData: "AQ==", header: "Ag==" })),
};

describe("operational Ente coordinator cycle", () => {
  it("pulls an existing Auth key, merges a full snapshot, and activates exactly one generation", async () => {
    const repo = repository(snapshot());
    const client = {
      getAuthenticatorKey: vi.fn(() => Promise.resolve({ encryptedKey: "AQ==", header: "Ag==" })),
      getEntityDiff: vi.fn(() =>
        Promise.resolve({
          diff: [
            {
              id: remoteId,
              encryptedData: "AQ==",
              header: "Ag==",
              isDeleted: false as const,
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          timestamp: 1,
        }),
      ),
      createEntity: vi.fn(),
      updateEntity: vi.fn(),
      deleteEntity: vi.fn(),
    };
    const cycle = createEnteOperationalCycle({
      repository: repo,
      client,
      crypto,
      now: () => 10,
      nextId: () => localId,
    });

    await cycle("manual", new AbortController().signal);

    expect(client.getAuthenticatorKey).toHaveBeenCalledTimes(1);
    expect(client.getEntityDiff).toHaveBeenCalledWith(
      "token",
      0,
      expect.any(AbortSignal),
      expect.objectContaining({ limitBytes: 64 * 1024 * 1024 }),
    );
    expect(repo.commit).toHaveBeenCalledTimes(1);
    expect(repo.current().items).toEqual([{ localId, projection }]);
    expect(repo.current().state.mappings).toEqual([{ localId, remoteId }]);
    expect(repo.current().state.cursor).toBe(1);
  });

  it("skips an entity it cannot read and still syncs the rest, touching nothing remote", async () => {
    const unreadableId = "7c9e6679-7425-40de-944b-e07fc1f90ae9";
    const repo = repository(snapshot());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const decryptEntity = vi.fn((entity: RemoteOtpState): EnteOtpProjection | null => {
      if (entity.header === "Ag==") return projection;
      throw new EnteProtocolError("ENTE_INVALID", "otpauth URI without a secret");
    });
    const client = {
      getAuthenticatorKey: vi.fn(() => Promise.resolve({ encryptedKey: "AQ==", header: "Ag==" })),
      getEntityDiff: vi.fn(() =>
        Promise.resolve({
          diff: [
            {
              id: remoteId,
              encryptedData: "AQ==",
              header: "Ag==",
              isDeleted: false as const,
              createdAt: 1,
              updatedAt: 1,
            },
            {
              id: unreadableId,
              encryptedData: "AQ==",
              header: "Aw==",
              isDeleted: false as const,
              createdAt: 2,
              updatedAt: 2,
            },
          ],
          timestamp: 2,
        }),
      ),
      createEntity: vi.fn(),
      updateEntity: vi.fn(),
      deleteEntity: vi.fn(),
    };
    try {
      const cycle = createEnteOperationalCycle({
        repository: repo,
        client,
        crypto: { ...crypto, decryptEntity },
        now: () => 10,
        nextId: () => localId,
      });
      await cycle("manual", new AbortController().signal);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(unreadableId));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("otpauth URI without a secret"));
    } finally {
      warn.mockRestore();
    }

    expect(repo.current().items).toEqual([{ localId, projection }]);
    expect(repo.current().state.mappings).toEqual([{ localId, remoteId }]);
    expect(repo.current().state.cursor).toBe(2);
    expect(client.createEntity).not.toHaveBeenCalled();
    expect(client.updateEntity).not.toHaveBeenCalled();
    expect(client.deleteEntity).not.toHaveBeenCalled();
  });

  it("records an expired Ente session met on the read path, so the panel asks to sign in again", async () => {
    const repo = repository(snapshot());
    const client = {
      getAuthenticatorKey: vi.fn(() =>
        Promise.reject(new EnteProtocolError("ENTE_REAUTH_REQUIRED")),
      ),
      getEntityDiff: vi.fn(),
      createEntity: vi.fn(),
      updateEntity: vi.fn(),
      deleteEntity: vi.fn(),
    };
    const cycle = createEnteOperationalCycle({
      repository: repo,
      client,
      crypto,
      now: () => 4_242,
      nextId: () => localId,
    });
    await expect(cycle("alarm", new AbortController().signal)).rejects.toMatchObject({
      code: "ENTE_REAUTH_REQUIRED",
    });
    expect(repo.commit).toHaveBeenCalledTimes(1);
    expect(repo.current().state).toMatchObject({
      needsReauth: true,
      scheduler: { lastAttemptAt: 4_242 },
    });
    // Already recorded: a second failing cycle does not rewrite the vault again.
    await expect(cycle("alarm", new AbortController().signal)).rejects.toMatchObject({
      code: "ENTE_REAUTH_REQUIRED",
    });
    expect(repo.commit).toHaveBeenCalledTimes(1);
  });

  it("fails closed with ENTE_AUTH_KEY_MISSING and never POSTs when the key is absent", async () => {
    const repo = repository(snapshot());
    const client = {
      getAuthenticatorKey: vi.fn(() =>
        Promise.reject(new EnteProtocolError("ENTE_AUTH_KEY_MISSING")),
      ),
      getEntityDiff: vi.fn(),
      createEntity: vi.fn(),
      updateEntity: vi.fn(),
      deleteEntity: vi.fn(),
    };
    const cycle = createEnteOperationalCycle({
      repository: repo,
      client,
      crypto,
      now: () => 10,
      nextId: () => localId,
    });
    await expect(cycle("manual", new AbortController().signal)).rejects.toMatchObject({
      code: "ENTE_AUTH_KEY_MISSING",
    });
    expect(client.createEntity).not.toHaveBeenCalled();
    expect(repo.commit).not.toHaveBeenCalled();
  });

  it("persists an attempted create before dispatch and does not blindly retry uncertainty", async () => {
    const repo = repository(
      snapshot(
        state({
          pending: [{ operationId, kind: "create", localId, desired: "sealed", attempts: 0 }],
        }),
      ),
    );
    const events: string[] = [];
    repo.commit.mockImplementation((_epoch, mutation) => {
      events.push("commit");
      const current = repo.current();
      Object.assign(current as object, {
        sessionEpoch: current.sessionEpoch + 1,
        state: mutation.state,
        items: mutation.items,
      });
      return Promise.resolve("activated");
    });
    const client = {
      getAuthenticatorKey: vi.fn(() => Promise.resolve({ encryptedKey: "AQ==", header: "Ag==" })),
      getEntityDiff: vi.fn(() => Promise.resolve({ diff: [], timestamp: 0 })),
      createEntity: vi.fn(() => {
        events.push("network");
        return Promise.reject(new TypeError("offline"));
      }),
      updateEntity: vi.fn(),
      deleteEntity: vi.fn(),
    };
    const cycle = createEnteOperationalCycle({
      repository: repo,
      client,
      crypto,
      now: () => 10,
      nextId: () => remoteId,
    });
    await expect(cycle("manual", new AbortController().signal)).rejects.toMatchObject({
      code: "ENTE_CREATE_UNCERTAIN",
    });
    expect(events.indexOf("commit")).toBeLessThan(events.indexOf("network"));
    expect(repo.current().state.uncertain).toMatchObject({ kind: "create", attempts: 1 });

    await expect(cycle("manual", new AbortController().signal)).rejects.toMatchObject({
      code: "ENTE_CREATE_UNCERTAIN",
    });
    expect(client.createEntity).toHaveBeenCalledTimes(1);
    expect(client.getEntityDiff).toHaveBeenLastCalledWith(
      "token",
      0,
      expect.any(AbortSignal),
      expect.objectContaining({ limitBytes: 64 * 1024 * 1024 }),
    );
  });

  it("recomputes from a fresh snapshot after an external root change", async () => {
    const repo = repository(snapshot());
    repo.commit.mockResolvedValueOnce("root-changed").mockResolvedValueOnce("activated");
    const client = {
      getAuthenticatorKey: vi.fn(() => Promise.resolve({ encryptedKey: "AQ==", header: "Ag==" })),
      getEntityDiff: vi.fn(() => Promise.resolve({ diff: [], timestamp: 0 })),
      createEntity: vi.fn(),
      updateEntity: vi.fn(),
      deleteEntity: vi.fn(),
    };
    const cycle = createEnteOperationalCycle({
      repository: repo,
      client,
      crypto,
      now: () => 10,
      nextId: () => localId,
    });
    await cycle("manual", new AbortController().signal);
    expect(repo.read).toHaveBeenCalledTimes(3);
    expect(repo.commit).toHaveBeenCalledTimes(2);
  });
});
