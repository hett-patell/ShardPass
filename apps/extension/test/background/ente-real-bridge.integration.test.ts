import { createDeterministicRandomSource } from "@shardpass/crypto";
import type { OtpItem } from "@shardpass/domain";
import {
  ACTIVE_ROOT_KEY,
  GenerationStore,
  VaultRootSchema,
  canonicalJson,
  type VaultRoot,
} from "@shardpass/storage";
import { FakeStoragePort } from "@shardpass/testing/fake-storage-port";
import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it, vi } from "vitest";

import type { EnteResponseBudget } from "../../src/background/ente/client";
import { EnteSyncCoordinator } from "../../src/background/ente/coordinator";
import { EnteConflictResolver } from "../../src/background/ente/conflict-resolver";
import { EnteConflictCapabilities } from "../../src/background/ente/conflicts";
import {
  createEnteOperationalCycle,
  type EnteCycleCrypto,
} from "../../src/background/ente/operational-cycle";
import type { EnteOtpProjection } from "../../src/background/ente/protocol";
import { createEnteSessionCycleRepository } from "../../src/background/ente/session-cycle-repository";
import type { EnteOtpSyncState, EntePendingOperation } from "../../src/background/ente/sync-state";
import { SessionService } from "../../src/background/vault/session-service";
import type { EnteSessionVaultRepository } from "../../src/background/vault/session-vault-repository";

const ids = {
  local: "00000000-0000-4000-8000-000000000001",
  local2: "00000000-0000-4000-8000-000000000002",
  remote: "00000000-0000-4000-8000-000000000011",
  remote2: "00000000-0000-4000-8000-000000000012",
  operation: "00000000-0000-4000-8000-000000000021",
  conflict: "00000000-0000-4000-8000-000000000031",
};
const binding = {
  extensionId: "extension-id",
  contextKind: "popup" as const,
  senderUrl: "chrome-extension://extension-id/popup/index.html",
  documentId: "popup-document-1",
};
const kek = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function projection(label: string): EnteOtpProjection {
  return {
    version: 1,
    kind: "otp",
    otpType: "totp",
    issuer: "Real bridge",
    label,
    secretBase32: "JBSWY3DPEHPK3PXP",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  };
}
function item(localId: string, value: EnteOtpProjection): OtpItem {
  return {
    id: localId,
    schemaVersion: 1,
    revision: 1,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    favorite: false,
    tags: [...(value.tags ?? [])],
    kind: "otp",
    issuer: value.issuer,
    label: value.label,
    secret: value.secretBase32,
    otpType: value.otpType,
    algorithm: value.algorithm,
    digits: value.otpType === "steam" ? 5 : value.digits,
    period: value.otpType === "hotp" ? 0 : (value.period ?? 30),
    ...(value.otpType === "hotp" ? { counter: value.counter ?? 0 } : {}),
    note: value.notes ?? "",
  };
}
function b64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
function envelope(value: EnteOtpProjection): string {
  return b64(encoder.encode(canonicalJson(value)));
}
function digest(value: EnteOtpProjection): string {
  return b64(sha256(encoder.encode(canonicalJson(value))));
}
const crypto: EnteCycleCrypto = {
  openCredential: () => Promise.resolve("token"),
  openAuthKey: () => Promise.resolve(new Uint8Array(32).fill(7)),
  openProjection: (value) =>
    Promise.resolve(
      JSON.parse(
        decoder.decode(Uint8Array.from(atob(value), (x) => x.charCodeAt(0))),
      ) as EnteOtpProjection,
    ),
  sealProjection: (value) => Promise.resolve(envelope(value)),
  digestProjection: (value) => Promise.resolve(digest(value)),
  decryptEntity: (entity) =>
    JSON.parse(
      decoder.decode(Uint8Array.from(atob(entity.encryptedData!), (x) => x.charCodeAt(0))),
    ) as EnteOtpProjection,
  encryptEntity: (value) => ({ encryptedData: envelope(value), header: "Ag==" }),
};
function state(overrides: Partial<EnteOtpSyncState> = {}): EnteOtpSyncState {
  return {
    version: 1,
    protocolPin: "c69dcf66704ad7ec1f95e32920455be429a566ef",
    origin: "https://api.ente.io",
    accountFingerprint: b64(new Uint8Array(32).fill(1)),
    snapshotAccountFingerprint: null,
    initialSnapshotEstablished: false,
    credentialEnvelope: "credential",
    authKeyEnvelope: "auth-key",
    mappings: [],
    bases: [],
    cursor: 0,
    pending: [],
    uncertain: null,
    conflicts: [],
    scheduler: { connected: true, lastAttemptAt: null, lastSuccessAt: null },
    needsReauth: false,
    ...overrides,
  };
}
type Remote = Readonly<{
  id: string;
  encryptedData: string | null;
  header: string | null;
  isDeleted: boolean;
  createdAt: number;
  updatedAt: number;
}>;
function live(id: string, value: EnteOtpProjection, updatedAt = 1): Remote {
  return {
    id,
    encryptedData: envelope(value),
    header: "Ag==",
    isDeleted: false,
    createdAt: 1,
    updatedAt,
  };
}
function deleted(id: string, updatedAt = 2): Remote {
  return { id, encryptedData: null, header: null, isDeleted: true, createdAt: 1, updatedAt };
}
class FakeEnteClient {
  readonly remote = new Map<string, Remote>();
  readonly calls: string[] = [];
  createResult: "normal" | "throw-before" | "throw-after" = "normal";
  nextRemoteId = ids.remote;
  getAuthenticatorKey = vi.fn(() => Promise.resolve({ encryptedKey: "AQ==", header: "Ag==" }));
  getEntityDiff = vi.fn((_token: string, _since: number, signal: AbortSignal) => {
    if (signal.aborted) return Promise.reject(new Error("aborted"));
    this.calls.push("pull");
    return Promise.resolve({ diff: [...this.remote.values()], timestamp: 100 });
  });
  createEntity = vi.fn((_token: string, body: { encryptedData: string; header: string }) => {
    this.calls.push("create");
    if (this.createResult === "throw-before") return Promise.reject(new TypeError("offline"));
    const entity = {
      id: this.nextRemoteId,
      ...body,
      isDeleted: false as const,
      createdAt: 100,
      updatedAt: 100,
    };
    this.remote.set(entity.id, entity);
    if (this.createResult === "throw-after") return Promise.reject(new TypeError("lost response"));
    return Promise.resolve(entity);
  });
  updateEntity = vi.fn(
    (_token: string, body: { id: string; encryptedData: string; header: string }) => {
      this.calls.push("update");
      this.remote.set(body.id, { ...body, isDeleted: false, createdAt: 1, updatedAt: 100 });
      return Promise.resolve();
    },
  );
  deleteEntity = vi.fn((_token: string, id: string) => {
    this.calls.push("delete");
    this.remote.set(id, deleted(id, 100));
    return Promise.resolve();
  });
}
function fixture(local = new FakeStoragePort()) {
  let sequence = 100;
  const session = new SessionService({
    local,
    session: new FakeStoragePort(),
    random: createDeterministicRandomSource(
      Uint8Array.from({ length: 200_000 }, (_, index) => index % 251),
    ),
    now: () => 1_000,
    isoNow: () => "2026-08-20T00:00:00.000Z",
    nextId: () => `10000000-0000-4000-8000-${(++sequence).toString().padStart(12, "0")}`,
  });
  const bridge = session.vaultRepository as EnteSessionVaultRepository;
  return { local, session, bridge, repository: createEnteSessionCycleRepository(bridge) };
}
async function setup(session: SessionService): Promise<void> {
  const challenge = await session.createChallenge("setup", binding);
  await session.setup(challenge.challengeId, kek.slice(), binding);
}
async function unlock(session: SessionService): Promise<void> {
  const challenge = await session.createChallenge("unlock", binding);
  await session.unlock(challenge.challengeId, kek.slice(), binding);
}
async function seed(
  fixtureValue: ReturnType<typeof fixture>,
  syncState: EnteOtpSyncState,
  items: readonly OtpItem[] = [],
): Promise<void> {
  const bridge = fixtureValue.bridge;
  const current = await bridge.readOtpItemsAndMetadata("ente-otp-state");
  await expect(
    bridge.replaceOtpItemsAndMetadataIfEpoch(current.sessionEpoch, items, {
      name: "ente-otp-state",
      schemaVersion: 1,
      plaintext: encoder.encode(canonicalJson(syncState)),
    }),
  ).resolves.toBe("activated");
}
function cycle(f: ReturnType<typeof fixture>, client: FakeEnteClient) {
  let next = 500;
  return createEnteOperationalCycle({
    repository: f.repository,
    client: client as never,
    crypto,
    now: () => 1_000,
    nextId: () => `20000000-0000-4000-8000-${(++next).toString().padStart(12, "0")}`,
  });
}
async function root(local: FakeStoragePort): Promise<VaultRoot> {
  return VaultRootSchema.parse((await local.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY]);
}
async function assertAuthenticated(local: FakeStoragePort, expectedRoot: VaultRoot): Promise<void> {
  const service = fixture(local).session;
  await unlock(service);
  await expect(
    new GenerationStore(local).readActive({ dek: (service as never as { dek: Uint8Array }).dek }),
  ).resolves.toMatchObject({ root: expectedRoot });
}

describe("Task12 real conflict resolver bridge", () => {
  it("shares one 64 MiB budget across key retrieval and all full pages and fails before commit", async () => {
    const f = fixture();
    await setup(f.session);
    const base = projection("base");
    const local = projection("local");
    const remote = projection("remote");
    await seed(
      f,
      state({
        mappings: [{ localId: ids.local, remoteId: ids.remote }],
        bases: [
          {
            localId: ids.local,
            remoteId: ids.remote,
            digest: digest(base),
            encryptedBase: envelope(base),
          },
        ],
        conflicts: [
          {
            conflictId: ids.conflict,
            localId: ids.local,
            remoteId: ids.remote,
            encryptedBase: envelope(base),
            encryptedLocal: envelope(local),
            encryptedRemote: envelope(remote),
            createdAt: 1,
          },
        ],
      }),
      [item(ids.local, local)],
    );
    const budgets: unknown[] = [];
    const client = {
      getAuthenticatorKey: vi.fn(
        (_token: string, _signal: AbortSignal, budget: EnteResponseBudget) => {
          budgets.push(budget);
          budget.charge(40 * 1024 * 1024);
          return Promise.resolve({ encryptedKey: "AQ==", header: "Ag==" });
        },
      ),
      getEntityDiff: vi.fn(
        (_token: string, sinceTime: number, _signal: AbortSignal, budget: EnteResponseBudget) => {
          expect(sinceTime).toBe(0);
          budgets.push(budget);
          budget.charge(25 * 1024 * 1024);
          return Promise.resolve({ diff: [live(ids.remote, remote)], timestamp: 100 });
        },
      ),
    };
    const resolver = new EnteConflictResolver({
      repository: f.repository,
      client: client as never,
      crypto,
      capabilities: new EnteConflictCapabilities(
        () => 1_000,
        () => "budget-capability",
      ),
      rootDigest: (snapshot) => Promise.resolve(String(snapshot.sessionEpoch)),
      nextId: () => "00000000-0000-4000-8000-000000000099",
    });
    const before = await f.repository.read();
    const [preview] = await resolver.preview(binding);
    await expect(resolver.resolve(preview!.capability, "keep-ente", binding)).rejects.toMatchObject(
      { code: "ENTE_LIMIT_REACHED" },
    );
    expect(budgets).toHaveLength(2);
    expect(budgets[0]).toBe(budgets[1]);
    expect(await f.repository.read()).toEqual(before);
  });

  it.each([
    ["local deletion", null, projection("remote")],
    ["remote deletion", projection("local"), null],
  ] as const)("rejects keep-both for %s", async (_name, local, remote) => {
    const f = fixture();
    await setup(f.session);
    const base = projection("base");
    await seed(
      f,
      state({
        mappings: [{ localId: ids.local, remoteId: ids.remote }],
        bases: [
          {
            localId: ids.local,
            remoteId: ids.remote,
            digest: digest(base),
            encryptedBase: envelope(base),
          },
        ],
        conflicts: [
          {
            conflictId: ids.conflict,
            localId: ids.local,
            remoteId: ids.remote,
            encryptedBase: envelope(base),
            encryptedLocal: local === null ? null : envelope(local),
            encryptedRemote: remote === null ? null : envelope(remote),
            createdAt: 1,
          },
        ],
      }),
      local === null ? [] : [item(ids.local, local)],
    );
    const client = new FakeEnteClient();
    client.remote.set(ids.remote, remote === null ? deleted(ids.remote) : live(ids.remote, remote));
    const resolver = new EnteConflictResolver({
      repository: f.repository,
      client: client as never,
      crypto,
      capabilities: new EnteConflictCapabilities(
        () => 1_000,
        () => "deletion-capability",
      ),
      rootDigest: (snapshot) => Promise.resolve(String(snapshot.sessionEpoch)),
      nextId: () => "00000000-0000-4000-8000-000000000099",
    });
    const before = await f.repository.read();
    const [preview] = await resolver.preview(binding);
    expect(preview?.canKeepBoth).toBe(false);
    await expect(resolver.resolve(preview!.capability, "keep-both", binding)).rejects.toMatchObject(
      { code: "ENTE_CONFLICT" },
    );
    const after = await f.repository.read();
    expect(after).toEqual(before);
    expect(client.createEntity).not.toHaveBeenCalled();
    expect(client.updateEntity).not.toHaveBeenCalled();
    expect(client.deleteEntity).not.toHaveBeenCalled();
  });

  it("keeps L on the existing local identity and moves R's mapping/base to a new identity without queueing", async () => {
    const f = fixture();
    await setup(f.session);
    const base = projection("base");
    const local = projection("local");
    const remote = projection("remote");
    await seed(
      f,
      state({
        mappings: [{ localId: ids.local, remoteId: ids.remote }],
        bases: [
          {
            localId: ids.local,
            remoteId: ids.remote,
            digest: digest(base),
            encryptedBase: envelope(base),
          },
        ],
        conflicts: [
          {
            conflictId: ids.conflict,
            localId: ids.local,
            remoteId: ids.remote,
            encryptedBase: envelope(base),
            encryptedLocal: envelope(local),
            encryptedRemote: envelope(remote),
            createdAt: 1,
          },
        ],
      }),
      [item(ids.local, local)],
    );
    const client = new FakeEnteClient();
    client.remote.set(ids.remote, live(ids.remote, remote));
    let nextCalls = 0;
    const newLocalId = "00000000-0000-4000-8000-000000000099";
    const resolver = new EnteConflictResolver({
      repository: f.repository,
      client: client as never,
      crypto,
      capabilities: new EnteConflictCapabilities(
        () => 1_000,
        () => `cap-${++nextCalls}`,
      ),
      rootDigest: (snapshot) => Promise.resolve(String(snapshot.sessionEpoch)),
      nextId: () => newLocalId,
    });
    const [preview] = await resolver.preview(binding);
    expect(preview?.canKeepBoth).toBe(true);
    await expect(
      resolver.resolve(preview!.capability, "keep-both", binding),
    ).resolves.toMatchObject({
      applied: true,
    });
    const result = await f.repository.read();
    expect(result.items).toEqual([
      { localId: ids.local, projection: local },
      { localId: newLocalId, projection: remote },
    ]);
    expect(result.state.mappings).toEqual([{ localId: newLocalId, remoteId: ids.remote }]);
    expect(result.state.bases).toEqual([
      {
        localId: newLocalId,
        remoteId: ids.remote,
        digest: digest(remote),
        encryptedBase: envelope(remote),
      },
    ]);
    expect(result.state.pending).toEqual([]);
    expect(result.state.conflicts).toEqual([]);
    expect(client.createEntity).not.toHaveBeenCalled();
    expect(client.updateEntity).not.toHaveBeenCalled();
    expect(client.deleteEntity).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "keep-local live retains ID/L/mapping/base and queues one update",
      choice: "keep-local" as const,
      local: projection("L"),
      remote: projection("R"),
      expectedItems: [{ localId: ids.local, projection: projection("L") }],
      expectedMappings: [{ localId: ids.local, remoteId: ids.remote }],
      expectedBaseLabel: "B",
      expectedPending: "update" as const,
    },
    {
      name: "keep-local local deletion retains mapping/base and queues one delete",
      choice: "keep-local" as const,
      local: null,
      remote: projection("R"),
      expectedItems: [],
      expectedMappings: [{ localId: ids.local, remoteId: ids.remote }],
      expectedBaseLabel: "B",
      expectedPending: "delete" as const,
    },
    {
      name: "keep-ente live replaces the same local ID with R and updates mapping/base",
      choice: "keep-ente" as const,
      local: projection("L"),
      remote: projection("R"),
      expectedItems: [{ localId: ids.local, projection: projection("R") }],
      expectedMappings: [{ localId: ids.local, remoteId: ids.remote }],
      expectedBaseLabel: "R",
      expectedPending: null,
    },
    {
      name: "keep-ente remote deletion removes item, mapping, and base without pending work",
      choice: "keep-ente" as const,
      local: projection("L"),
      remote: null,
      expectedItems: [],
      expectedMappings: [],
      expectedBaseLabel: null,
      expectedPending: null,
    },
  ])(
    "applies $name through preview and resolve in exactly one encrypted generation",
    async (testCase) => {
      const f = fixture();
      await setup(f.session);
      const base = projection("B");
      await seed(
        f,
        state({
          mappings: [{ localId: ids.local, remoteId: ids.remote }],
          bases: [
            {
              localId: ids.local,
              remoteId: ids.remote,
              digest: digest(base),
              encryptedBase: envelope(base),
            },
          ],
          pending: [
            {
              operationId: ids.operation,
              kind: "update",
              localId: ids.local,
              remoteId: ids.remote,
              baseDigest: digest(base),
              desired: envelope(projection("superseded pending")),
              attempts: 0,
            },
          ],
          conflicts: [
            {
              conflictId: ids.conflict,
              localId: ids.local,
              remoteId: ids.remote,
              encryptedBase: envelope(base),
              encryptedLocal: testCase.local === null ? null : envelope(testCase.local),
              encryptedRemote: testCase.remote === null ? null : envelope(testCase.remote),
              createdAt: 1,
            },
          ],
        }),
        testCase.local === null ? [] : [item(ids.local, testCase.local)],
      );
      const client = new FakeEnteClient();
      client.remote.set(
        ids.remote,
        testCase.remote === null ? deleted(ids.remote) : live(ids.remote, testCase.remote),
      );
      let issued = 0;
      const resolver = new EnteConflictResolver({
        repository: f.repository,
        client: client as never,
        crypto,
        capabilities: new EnteConflictCapabilities(
          () => 1_000,
          () => `direct-capability-${String(++issued).padStart(32, "0")}`,
        ),
        rootDigest: (snapshot) => Promise.resolve(`root:${snapshot.sessionEpoch}`),
        nextId: () => ids.local2,
      });
      const rootWritesBefore = f.local.writes.filter((write) =>
        write.keys.includes(ACTIVE_ROOT_KEY),
      ).length;
      const [preview] = await resolver.preview(binding);
      expect(preview).toMatchObject({
        canKeepBoth: testCase.local !== null && testCase.remote !== null,
      });
      await expect(
        resolver.resolve(preview!.capability, testCase.choice, binding),
      ).resolves.toEqual({
        applied: true,
        conflicts: [],
      });
      expect(client.getEntityDiff).toHaveBeenCalledTimes(1);
      expect(client.getEntityDiff.mock.calls[0]?.[1]).toBe(0);
      expect(
        f.local.writes.filter((write) => write.keys.includes(ACTIVE_ROOT_KEY)).length -
          rootWritesBefore,
      ).toBe(1);

      const result = await f.repository.read();
      expect(result.items).toEqual(testCase.expectedItems);
      expect(result.state.mappings).toEqual(testCase.expectedMappings);
      expect(result.state.conflicts).toEqual([]);
      expect(result.state.pending.map((entry) => entry.kind)).toEqual(
        testCase.expectedPending === null ? [] : [testCase.expectedPending],
      );
      if (testCase.expectedPending !== null)
        expect(result.state.pending[0]).toMatchObject({
          operationId: ids.conflict,
          localId: ids.local,
          remoteId: ids.remote,
          baseDigest: digest(base),
          attempts: 0,
        });
      expect(result.state.bases).toEqual(
        testCase.expectedBaseLabel === null
          ? []
          : [
              {
                localId: ids.local,
                remoteId: ids.remote,
                digest: digest(projection(testCase.expectedBaseLabel)),
                encryptedBase: envelope(projection(testCase.expectedBaseLabel)),
              },
            ],
      );
      expect(client.createEntity).not.toHaveBeenCalled();
      expect(client.updateEntity).not.toHaveBeenCalled();
      expect(client.deleteEntity).not.toHaveBeenCalled();

      const rootWritesAfterResolution = f.local.writes.filter((write) =>
        write.keys.includes(ACTIVE_ROOT_KEY),
      ).length;
      await expect(
        resolver.resolve(preview!.capability, testCase.choice, binding),
      ).resolves.toMatchObject({
        applied: false,
        conflicts: [],
      });
      expect(client.getEntityDiff).toHaveBeenCalledTimes(1);
      expect(f.local.writes.filter((write) => write.keys.includes(ACTIVE_ROOT_KEY)).length).toBe(
        rootWritesAfterResolution,
      );
    },
  );
});

describe("Task12 Phase2 real SessionService operational bridge", () => {
  it("refreshes a queued local edit against R into a retained conflict without dispatch", async () => {
    const f = fixture();
    await setup(f.session);
    const base = projection("B");
    const local = projection("L");
    const remote = projection("R");
    await seed(
      f,
      state({
        initialSnapshotEstablished: true,
        snapshotAccountFingerprint: b64(new Uint8Array(32).fill(1)),
        cursor: 2,
        mappings: [{ localId: ids.local, remoteId: ids.remote }],
        bases: [
          {
            localId: ids.local,
            remoteId: ids.remote,
            digest: digest(base),
            encryptedBase: envelope(base),
          },
        ],
        pending: [
          {
            operationId: ids.operation,
            kind: "update",
            localId: ids.local,
            remoteId: ids.remote,
            baseDigest: digest(base),
            desired: envelope(local),
            attempts: 0,
          },
        ],
      }),
      [item(ids.local, local)],
    );
    const client = new FakeEnteClient();
    client.remote.set(ids.remote, live(ids.remote, remote, 4));
    await cycle(f, client)("manual", new AbortController().signal);
    const result = await f.repository.read();
    expect(result.state.pending).toEqual([]);
    expect(result.state.conflicts).toHaveLength(1);
    expect(client.getEntityDiff.mock.calls[0]?.[1]).toBe(2);
    expect(client.createEntity).not.toHaveBeenCalled();
    expect(client.updateEntity).not.toHaveBeenCalled();
    expect(client.deleteEntity).not.toHaveBeenCalled();
  });

  it("binds a create response only after a full pull and finalizes update and delete observations", async () => {
    const f = fixture();
    await setup(f.session);
    const created = projection("created");
    await seed(
      f,
      state({
        pending: [
          {
            operationId: ids.operation,
            kind: "create",
            localId: ids.local,
            desired: envelope(created),
            attempts: 0,
          },
        ],
      }),
      [item(ids.local, created)],
    );
    const client = new FakeEnteClient();

    await cycle(f, client)("manual", new AbortController().signal);
    let observed = await f.repository.read();
    expect(client.calls).toEqual(["pull", "create", "pull"]);
    expect(observed.state.mappings).toEqual([{ localId: ids.local, remoteId: ids.remote }]);
    expect(observed.state.pending).toEqual([]);
    expect(observed.state.uncertain).toBeNull();

    const changed = projection("updated");
    await seed(
      f,
      state({
        mappings: [{ localId: ids.local, remoteId: ids.remote }],
        bases: [
          {
            localId: ids.local,
            remoteId: ids.remote,
            digest: digest(created),
            encryptedBase: envelope(created),
          },
        ],
        pending: [
          {
            operationId: ids.operation,
            kind: "update",
            localId: ids.local,
            remoteId: ids.remote,
            baseDigest: digest(created),
            desired: envelope(changed),
            attempts: 0,
          },
        ],
      }),
      [item(ids.local, changed)],
    );
    client.calls.splice(0);
    await cycle(f, client)("manual", new AbortController().signal);
    observed = await f.repository.read();
    expect(client.calls).toEqual(["pull", "update", "pull"]);
    expect(observed.state.pending).toEqual([]);
    expect(observed.state.bases[0]?.digest).toBe(digest(changed));

    await seed(
      f,
      state({
        mappings: [{ localId: ids.local, remoteId: ids.remote }],
        bases: [
          {
            localId: ids.local,
            remoteId: ids.remote,
            digest: digest(changed),
            encryptedBase: envelope(changed),
          },
        ],
        pending: [
          {
            operationId: ids.operation,
            kind: "delete",
            localId: ids.local,
            remoteId: ids.remote,
            baseDigest: digest(changed),
            attempts: 0,
          },
        ],
      }),
      [],
    );
    client.calls.splice(0);
    await cycle(f, client)("manual", new AbortController().signal);
    observed = await f.repository.read();
    expect(client.calls).toEqual(["pull", "delete", "pull"]);
    expect(observed.state.pending).toEqual([]);
    expect(observed.state.mappings).toEqual([]);
  });

  it.each([
    ["zero", [] as Remote[], "retry"],
    ["one", [live(ids.remote, projection("desired"))], "complete"],
    [
      "multiple",
      [live(ids.remote, projection("desired")), live(ids.remote2, projection("desired"))],
      "conflict",
    ],
  ] as const)(
    "reconciles uncertain create with %s new matches",
    async (_name, entities, expected) => {
      const f = fixture();
      await setup(f.session);
      const desired = projection("desired");
      const uncertain: EntePendingOperation = {
        operationId: ids.operation,
        kind: "create",
        localId: ids.local,
        desired: envelope(desired),
        attempts: 1,
        beforeRemoteIds: [],
      };
      await seed(f, state({ pending: [uncertain], uncertain }), [item(ids.local, desired)]);
      const client = new FakeEnteClient();
      entities.forEach((entity) => client.remote.set(entity.id, entity));
      const run = cycle(f, client)("restart", new AbortController().signal);
      if (expected === "retry")
        await expect(run).rejects.toMatchObject({ code: "ENTE_CREATE_UNCERTAIN" });
      else await run;
      const result = await f.repository.read();
      if (expected === "complete") {
        expect(result.state.mappings).toEqual([{ localId: ids.local, remoteId: ids.remote }]);
        expect(result.state.pending).toEqual([]);
      } else if (expected === "retry") {
        expect(result.state.pending).toHaveLength(1);
        expect(result.state.uncertain).toBeNull();
      } else {
        expect(result.state.conflicts).toHaveLength(1);
        expect(result.state.pending).toEqual([]);
      }
      expect(client.createEntity).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["update", "observed", projection("desired"), "complete"],
    ["update", "absent", null, "conflict"],
    ["update", "divergent", projection("other"), "conflict"],
    ["delete", "observed", projection("base"), "retry"],
    ["delete", "absent", null, "complete"],
    ["delete", "divergent", projection("other"), "conflict"],
  ] as const)(
    "reconciles uncertain %s when remote is %s",
    async (kind, _observation, remote, expected) => {
      const f = fixture();
      await setup(f.session);
      const base = projection("base");
      const desired = projection("desired");
      const uncertain: EntePendingOperation =
        kind === "update"
          ? {
              operationId: ids.operation,
              kind,
              localId: ids.local,
              remoteId: ids.remote,
              baseDigest: digest(base),
              desired: envelope(desired),
              attempts: 1,
            }
          : {
              operationId: ids.operation,
              kind,
              localId: ids.local,
              remoteId: ids.remote,
              baseDigest: digest(base),
              attempts: 1,
            };
      await seed(
        f,
        state({
          mappings: [{ localId: ids.local, remoteId: ids.remote }],
          bases: [
            {
              localId: ids.local,
              remoteId: ids.remote,
              digest: digest(base),
              encryptedBase: envelope(base),
            },
          ],
          pending: [uncertain],
          uncertain,
        }),
        kind === "delete" ? [] : [item(ids.local, desired)],
      );
      const client = new FakeEnteClient();
      client.remote.set(
        ids.remote,
        remote === null ? deleted(ids.remote) : live(ids.remote, remote),
      );
      if (expected === "retry")
        await expect(
          cycle(f, client)("restart", new AbortController().signal),
        ).rejects.toMatchObject({ code: "ENTE_WRITE_UNCERTAIN" });
      else await cycle(f, client)("restart", new AbortController().signal);
      const result = await f.repository.read();
      expect(result.state.uncertain).toBeNull();
      expect(result.state.conflicts.length).toBe(expected === "conflict" ? 1 : 0);
      expect(result.state.pending.length).toBe(expected === "retry" ? 1 : 0);
      expect(client.updateEntity).not.toHaveBeenCalled();
      expect(client.deleteEntity).not.toHaveBeenCalled();
    },
  );

  it("persists the queue across fresh SessionService and coordinator instances without duplicate dispatch", async () => {
    const local = new FakeStoragePort();
    const first = fixture(local);
    await setup(first.session);
    const desired = projection("restart");
    await seed(
      first,
      state({
        pending: [
          {
            operationId: ids.operation,
            kind: "create",
            localId: ids.local,
            desired: envelope(desired),
            attempts: 0,
          },
        ],
      }),
      [item(ids.local, desired)],
    );
    const client = new FakeEnteClient();
    client.createResult = "throw-after";
    await expect(
      cycle(first, client)("manual", new AbortController().signal),
    ).rejects.toMatchObject({ code: "ENTE_CREATE_UNCERTAIN" });
    await first.session.lock();

    const restarted = fixture(local);
    await unlock(restarted.session);
    const coordinator = new EnteSyncCoordinator(cycle(restarted, client), () => true);
    await coordinator.trigger("restart");
    expect(client.createEntity).toHaveBeenCalledTimes(1);
    expect((await restarted.repository.read()).state.pending).toEqual([]);
  });

  it("coalesces concurrent triggers into one running cycle and one follow-up", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi.fn(async () => blocked);
    const coordinator = new EnteSyncCoordinator(run, () => true);
    const first = coordinator.trigger("manual");
    await Promise.resolve();
    await Promise.all([
      coordinator.trigger("alarm"),
      coordinator.trigger("unlock"),
      coordinator.trigger("manual"),
    ]);
    release();
    await first;
    expect(run).toHaveBeenCalledTimes(2);
  });

  it.each(["before", "after"] as const)(
    "faults %s every actual bridge stage write without exposing a partial active generation",
    async (phase) => {
      for (let writeAt = 1; writeAt <= 7; writeAt += 1) {
        const f = fixture();
        await setup(f.session);
        await seed(f, state());
        const before = await root(f.local);
        const transitions = f.local.writes.filter((write) =>
          write.keys.includes(ACTIVE_ROOT_KEY),
        ).length;
        const snapshot = await f.repository.read();
        f.local.resetOperationCount();
        f.local.failWriteAt(writeAt, phase, new Error(`fault-${phase}-${writeAt}`));
        await expect(
          f.repository.commit(snapshot.sessionEpoch, {
            state: { ...snapshot.state, cursor: 9 },
            items: [{ localId: ids.local, projection: projection("fault") }],
          }),
        ).rejects.toThrow();
        const visible = await root(f.local);
        const rootWrites =
          f.local.writes.filter((write) => write.keys.includes(ACTIVE_ROOT_KEY)).length -
          transitions;
        expect(rootWrites).toBeLessThanOrEqual(1);
        if (writeAt < 7 || phase === "before") expect(visible).toEqual(before);
        else expect(visible).not.toEqual(before);
        await assertAuthenticated(f.local, visible);
      }
    },
  );

  it("locks fail-closed at every awaited storage boundary and on external-root notification", async () => {
    const probes = ["get:before", "get:after", "set:before", "set:after"] as const;
    for (const probe of probes) {
      const f = fixture();
      await setup(f.session);
      await seed(f, state());
      const snapshot = await f.repository.read();
      let reached = false;
      f.local.pauseNext(probe, () => {
        reached = true;
        void f.session.lock();
      });
      await expect(
        f.repository.commit(snapshot.sessionEpoch, {
          state: { ...snapshot.state, cursor: 7 },
          items: snapshot.items,
        }),
      ).rejects.toMatchObject({ code: "VAULT_LOCKED" });
      expect(reached).toBe(true);
      await expect(f.session.getState()).resolves.toMatchObject({ state: "locked" });
    }

    const f = fixture();
    await setup(f.session);
    await seed(f, state());
    const snapshot = await f.repository.read();
    f.local.pauseNext("set:before", () => {
      void f.session.handleActiveRootChange({ invalid: true });
    });
    await expect(
      f.repository.commit(snapshot.sessionEpoch, { state: snapshot.state, items: snapshot.items }),
    ).rejects.toMatchObject({ code: "VAULT_LOCKED" });
  });
});
