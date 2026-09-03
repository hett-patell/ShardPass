import type { OtpItem, VaultItem } from "@shardpass/domain";
import type { OtpRequest, SenderContext } from "@shardpass/messaging";
import { OtpResponseSchema } from "@shardpass/messaging";
import { HotpReservationService } from "@shardpass/otp";
import { StorageError, type TombstoneResult } from "@shardpass/storage";
import { describe, expect, it } from "vitest";

import {
  OtpService,
  OtpServiceError,
  normalizeOtpSearch,
} from "../../src/background/otp/otp-service";
import { VaultSessionError } from "../../src/background/vault/session-service";
import type { SessionVaultRepository } from "../../src/background/vault/session-vault-repository";

const ids = {
  first: "018f47a6-7d11-7c2f-8bd9-a1d37f147a20",
  second: "018f47a6-7d11-7c2f-8bd9-a1d37f147a21",
  third: "018f47a6-7d11-7c2f-8bd9-a1d37f147a22",
  fourth: "018f47a6-7d11-7c2f-8bd9-a1d37f147a23",
  created: "018f47a6-7d11-7c2f-8bd9-a1d37f147a24",
};
const nowIso = "2026-08-10T12:00:00.000Z";
const popupSender: SenderContext = {
  extensionId: "extension-id",
  contextKind: "popup",
  senderUrl: "chrome-extension://extension-id/popup/index.html",
  documentId: "popup-document",
};
const vaultSender: SenderContext = {
  extensionId: "extension-id",
  contextKind: "vault",
  senderUrl: "chrome-extension://extension-id/vault/index.html",
  documentId: "vault-document",
};

function item(overrides: Partial<OtpItem> = {}): OtpItem {
  return {
    id: ids.first,
    schemaVersion: 2,
    revision: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
    favorite: false,
    tags: [],
    kind: "otp",
    issuer: "Example",
    label: "account",
    secret: "JBSWY3DPEHPK3PXP",
    otpType: "totp",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    note: "",
    ...overrides,
  };
}

class FakeRepository implements Omit<
  SessionVaultRepository,
  | "importOtpBatch"
  | "readPortableState"
  | "previewPortableImport"
  | "importPortableState"
  | "previewPortableOtpItems"
  | "importPortableOtpItems"
  | "migrateLegacySchema"
> {
  readonly items = new Map<string, OtpItem>();
  getCalls: string[] = [];
  listItemsCalls = 0;
  createCalls = 0;
  updateCalls = 0;
  tombstoneCalls = 0;
  beforeGet: ((itemId: string, call: number) => void | Promise<void>) | undefined;
  listError: unknown;

  constructor(values: readonly OtpItem[] = []) {
    for (const value of values) this.items.set(value.id, structuredClone(value));
  }

  listItems(): Promise<readonly OtpItem[]> {
    this.listItemsCalls += 1;
    if (this.listError !== undefined) return Promise.reject(asError(this.listError));
    return Promise.resolve([...this.items.values()].map((value) => structuredClone(value)));
  }

  listAllItems(): Promise<readonly VaultItem[]> {
    return this.listItems();
  }

  listMetadata(): Promise<never> {
    return Promise.reject(new Error("OtpService list must use one item snapshot"));
  }

  async get(itemId: string): Promise<OtpItem | null> {
    this.getCalls.push(itemId);
    await this.beforeGet?.(itemId, this.getCalls.length);
    const value = this.items.get(itemId);
    return value === undefined ? null : structuredClone(value);
  }

  getItem(itemId: string): Promise<VaultItem | null> {
    return this.get(itemId);
  }

  create(candidate: OtpItem): Promise<OtpItem> {
    this.createCalls += 1;
    if (this.items.has(candidate.id)) return Promise.reject(new StorageError("REVISION_CONFLICT"));
    const created = {
      ...structuredClone(candidate),
      revision: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    this.items.set(created.id, created);
    return Promise.resolve(structuredClone(created));
  }

  async createItems(candidates: readonly VaultItem[]) {
    const outcomes: { index: number; status: "created"; itemId: string }[] = [];
    for (const [index, candidate] of candidates.entries()) {
      const created = await this.createItem(candidate);
      outcomes.push({ index, status: "created", itemId: created.id });
    }
    return outcomes;
  }

  createItem(candidate: VaultItem): Promise<VaultItem> {
    return this.create(candidate as OtpItem);
  }

  updateItem(candidate: VaultItem, expectedRevision: number): Promise<VaultItem> {
    return this.update(candidate as OtpItem, expectedRevision);
  }

  update(candidate: OtpItem, expectedRevision: number): Promise<OtpItem> {
    this.updateCalls += 1;
    const current = this.items.get(candidate.id);
    if (current === undefined || current.revision !== expectedRevision)
      return Promise.reject(new StorageError("REVISION_CONFLICT"));
    const updated = {
      ...structuredClone(candidate),
      id: current.id,
      schemaVersion: current.schemaVersion,
      revision: current.revision + 1,
      createdAt: current.createdAt,
      updatedAt: "2026-08-10T12:01:00.000Z",
      deletedAt: undefined,
    };
    this.items.set(updated.id, updated);
    return Promise.resolve(structuredClone(updated));
  }

  tombstone(itemId: string, expectedRevision: number): Promise<TombstoneResult> {
    this.tombstoneCalls += 1;
    const current = this.items.get(itemId);
    if (current === undefined || current.revision !== expectedRevision)
      return Promise.reject(new StorageError("REVISION_CONFLICT"));
    this.items.delete(itemId);
    return Promise.resolve({ id: itemId, revision: current.revision + 1, deletedAt: nowIso });
  }

  commitHotpReservation(): Promise<never> {
    throw new Error("Task 4 must not be called");
  }

  cancelHotpReservation(): Promise<boolean> {
    return Promise.resolve(false);
  }

  lookupHotpReservationReceipt(): Promise<null> {
    return Promise.resolve(null);
  }

  savePendingHotpReservation(): Promise<void> {
    return Promise.reject(new Error("Task 4 must not be called"));
  }

  lookupPendingHotpReservation(): Promise<null> {
    return Promise.resolve(null);
  }

  removePendingHotpReservation(): Promise<void> {
    return Promise.resolve();
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error("test failure");
}

function editable(overrides: Record<string, unknown> = {}) {
  return {
    issuer: "Example",
    label: "account",
    secret: "JBSWY3DPEHPK3PXP",
    otpType: "totp" as const,
    algorithm: "SHA1" as const,
    digits: 6,
    period: 30,
    favorite: false,
    tags: [] as string[],
    note: "private note",
    ...overrides,
  };
}

function request(kind: OtpRequest["kind"], values: Record<string, unknown> = {}): OtpRequest {
  return { version: 1, kind, ...values } as OtpRequest;
}

function fixture(
  values: readonly OtpItem[] = [],
  now = 15_000,
  notePrivilegedActivity: (() => Promise<void>) | undefined = undefined,
) {
  const repository = new FakeRepository(values);
  const activity: string[] = [];
  const service = new OtpService({
    repository,
    clock: { now: () => now, isoNow: () => nowIso },
    ids: { next: () => ids.created },
    reservations: new HotpReservationService({
      clock: { now: () => now },
      random: { uuid: () => "018f47a6-7d11-7c2f-8bd9-a1d37f147aff" },
      committer: {
        commit: () => Promise.reject(new Error("Task 4 must not be called")),
      },
    }),
    notePrivilegedActivity:
      notePrivilegedActivity ??
      (() => {
        activity.push("noted");
        return Promise.resolve();
      }),
  });
  return { activity, repository, service };
}

async function list(service: OtpService, query = "") {
  const result = await service.handle(request("otp.list", { query }), popupSender);
  if (result.kind !== "otp.listResult") throw new Error("expected list");
  return result.items;
}

describe("OtpService search and CRUD", () => {
  it("normalizes search with trimmed NFKC and en-US locale folding", () => {
    expect(normalizeOtpSearch("  Ａİ  ")).toBe("ai̇");
  });

  it("searches only normalized issuer, label, and tags", async () => {
    const values = [
      item({ id: ids.first, issuer: "Ａcme", note: "note-only-token" }),
      item({ id: ids.second, issuer: "Other", label: "İSTANBUL" }),
      item({ id: ids.third, issuer: "Other", label: "third", tags: ["Work"] }),
    ];
    const { service } = fixture(values);

    await expect(list(service, "acme")).resolves.toMatchObject([{ id: ids.first }]);
    await expect(list(service, "i̇stanbul")).resolves.toMatchObject([{ id: ids.second }]);
    await expect(list(service, "work")).resolves.toMatchObject([{ id: ids.third }]);
    await expect(list(service, "note-only-token")).resolves.toEqual([]);
    await expect(list(service, "  ")).resolves.toHaveLength(3);
  });

  it("lists a capacity-sized snapshot with one bridge call and no item gets", async () => {
    const values = Array.from({ length: 10_000 }, (_, index) =>
      item({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        label: `account-${String(index).padStart(5, "0")}`,
      }),
    );
    const { repository, service } = fixture(values);

    await expect(list(service)).resolves.toHaveLength(10_000);
    expect(repository.listItemsCalls).toBe(1);
    expect(repository.getCalls).toEqual([]);
  });

  it("sorts favorite first, then normalized issuer, label, and id deterministically", async () => {
    const values = [
      item({ id: ids.fourth, issuer: "Zulu", label: "z" }),
      item({ id: ids.third, issuer: "acme", label: "same" }),
      item({ id: ids.second, issuer: "Ａcme", label: "Same", favorite: true }),
      item({ id: ids.first, issuer: "Acme", label: "same" }),
    ];
    const { service } = fixture(values);

    expect((await list(service)).map(({ id }) => id)).toEqual([
      ids.second,
      ids.first,
      ids.third,
      ids.fourth,
    ]);
  });

  it("returns fresh deeply frozen list projections without seed, note, timestamps, or records", async () => {
    const original = item({ tags: ["work"], note: "private note" });
    const { service } = fixture([original]);

    const first = await list(service);
    const second = await list(service);
    expect(first).toEqual([
      {
        id: ids.first,
        revision: 1,
        issuer: "Example",
        label: "account",
        otpType: "totp",
        favorite: false,
        tags: ["work"],
      },
    ]);
    expect(first[0]).not.toBe(second[0]);
    expect(first[0]!.tags).not.toBe(second[0]!.tags);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0])).toBe(true);
    expect(Object.isFrozen(first[0]!.tags)).toBe(true);
    expect(JSON.stringify(first)).not.toContain(original.secret);
    expect(JSON.stringify(first)).not.toContain(original.note);
    expect(JSON.stringify(first)).not.toContain("createdAt");
  });

  it("fails closed for unknown, invalid, and deleted snapshot records", async () => {
    const deleted = item({ id: ids.second, deletedAt: nowIso });
    const unknown = { ...item({ id: ids.third }), kind: "future" } as unknown as OtpItem;
    const invalid = { ...item({ id: ids.fourth }), secret: "LEAKED-INVALID-SECRET" } as OtpItem;
    const { service } = fixture([deleted, unknown, invalid]);

    await expect(list(service)).resolves.toEqual([]);
  });

  it("returns metadata-free locked list failure and never reflects secrets", async () => {
    const { repository, service } = fixture([item()]);
    repository.listError = new VaultSessionError("VAULT_LOCKED");

    const failure = await service
      .handle(request("otp.list", { query: "secret-query" }), popupSender)
      .catch((error: unknown) => error);
    expect(failure).toEqual(expect.objectContaining({ code: "VAULT_LOCKED" }));
    expect(failure).toBeInstanceOf(OtpServiceError);
    expect(JSON.stringify(failure)).not.toContain("secret-query");
    expect(Reflect.ownKeys(failure as object)).not.toContain("items");
  });

  it("returns the exact vault-only editor projection as a fresh frozen object", async () => {
    const stored = item({ tags: ["work"], note: "private note" });
    const { service } = fixture([stored]);
    const result = await service.handle(
      request("otp.getEditor", { itemId: stored.id }),
      vaultSender,
    );

    expect(result).toEqual({
      version: 1,
      kind: "otp.editorResult",
      item: { id: stored.id, revision: 1, ...editable({ tags: ["work"] }) },
    });
    if (result.kind !== "otp.editorResult") throw new Error("expected editor");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.item)).toBe(true);
    expect(Object.isFrozen(result.item.tags)).toBe(true);
    expect(result.item).not.toBe(stored);
    expect(JSON.stringify(result)).not.toContain("createdAt");
    expect(JSON.stringify(result)).not.toContain("schemaVersion");
  });

  it("defends editor access in depth and does not decrypt for popup", async () => {
    const { repository, service } = fixture([item()]);
    await expect(
      service.handle(request("otp.getEditor", { itemId: ids.first }), popupSender),
    ).rejects.toMatchObject({ code: "OTP_INVALID" });
    expect(repository.getCalls).toEqual([]);
  });

  it("creates from editable input while background owns identity, revision, and timestamps", async () => {
    const { activity, repository, service } = fixture();
    const result = await service.handle(
      request("otp.create", { input: editable({ issuer: "Created", tags: ["one"] }) }),
      vaultSender,
    );

    expect(result).toEqual({
      version: 1,
      kind: "otp.mutationResult",
      item: {
        id: ids.created,
        revision: 1,
        issuer: "Created",
        label: "account",
        otpType: "totp",
        favorite: false,
        tags: ["one"],
      },
    });
    expect(repository.items.get(ids.created)).toMatchObject({
      id: ids.created,
      revision: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
      schemaVersion: 2,
      kind: "otp",
    });
    expect(activity).toEqual(["noted"]);
  });

  it("rejects noncanonical and incompatible create input before repository access", async () => {
    const { activity, repository, service } = fixture();
    for (const input of [
      editable({ secret: "jbswy3dpehpk3pxp" }),
      editable({ issuer: " padded " }),
      editable({ otpType: "steam", digits: 6 }),
      editable({ otpType: "hotp", period: 0 }),
    ]) {
      await expect(
        service.handle(request("otp.create", { input }), vaultSender),
      ).rejects.toMatchObject({
        code: "OTP_INVALID",
      });
    }
    expect(repository.items.size).toBe(0);
    expect(activity).toEqual([]);
  });

  it("updates only editable fields and preserves repository-owned metadata", async () => {
    const stored = item({ archivedAt: "2026-08-01T00:00:00.000Z" });
    const { activity, repository, service } = fixture([stored]);
    const result = await service.handle(
      request("otp.update", {
        itemId: stored.id,
        expectedRevision: 1,
        input: editable({ label: "changed", algorithm: "SHA512", digits: 8, period: 60 }),
      }),
      vaultSender,
    );

    expect(result).toMatchObject({
      kind: "otp.mutationResult",
      item: { revision: 2, label: "changed" },
    });
    expect(repository.items.get(stored.id)).toMatchObject({
      id: stored.id,
      revision: 2,
      createdAt: stored.createdAt,
      updatedAt: "2026-08-10T12:01:00.000Z",
      archivedAt: stored.archivedAt,
      algorithm: "SHA512",
      digits: 8,
      period: 60,
    });
    expect(activity).toEqual(["noted"]);
  });

  it("does not overwrite a newer revision and returns a fixed conflict", async () => {
    const newer = item({ revision: 2, label: "newer", secret: "KRUGS4ZANFZSAYJA" });
    const { activity, repository, service } = fixture([newer]);
    const failure = await service
      .handle(
        request("otp.update", {
          itemId: newer.id,
          expectedRevision: 1,
          input: editable({ label: "overwrite", secret: "JBSWY3DPEHPK3PXP" }),
        }),
        vaultSender,
      )
      .catch((error: unknown) => error);

    expect(failure).toEqual(expect.objectContaining({ code: "OTP_CONFLICT" }));
    expect((failure as Error).message).toBe("OTP_CONFLICT");
    expect(JSON.stringify(failure)).not.toContain("KRUGS4ZANFZSAYJA");
    expect(repository.items.get(newer.id)).toMatchObject({ revision: 2, label: "newer" });
    expect(activity).toEqual([]);
  });

  it("tombstones with the expected revision and returns no record metadata", async () => {
    const stored = item();
    const { activity, repository, service } = fixture([stored]);
    const result = await service.handle(
      request("otp.delete", { itemId: stored.id, expectedRevision: 1 }),
      vaultSender,
    );

    expect(result).toEqual({
      version: 1,
      kind: "otp.deleteResult",
      itemId: stored.id,
      revision: 2,
    });
    expect(repository.items.has(stored.id)).toBe(false);
    expect(JSON.stringify(result)).not.toContain(stored.secret);
    expect(activity).toEqual(["noted"]);
  });

  it("maps missing reads and deletes to not found without activity", async () => {
    const { activity, service } = fixture();
    await expect(
      service.handle(request("otp.getEditor", { itemId: ids.first }), vaultSender),
    ).rejects.toMatchObject({ code: "OTP_NOT_FOUND" });
    await expect(
      service.handle(
        request("otp.delete", { itemId: ids.first, expectedRevision: 1 }),
        vaultSender,
      ),
    ).rejects.toMatchObject({ code: "OTP_NOT_FOUND" });
    expect(activity).toEqual([]);
  });

  it("generates one bounded TOTP projection at the exact injected boundary", async () => {
    const stored = item({ algorithm: "SHA256", digits: 8, period: 30 });
    const { activity, repository, service } = fixture([stored], 30_000);
    const result = await service.handle(request("otp.getCode", { itemId: stored.id }), popupSender);

    expect(result).toMatchObject({
      version: 1,
      kind: "otp.codeResult",
      itemId: stored.id,
      revision: 1,
      otpType: "totp",
      period: 30,
      remaining: 30,
      expiresAt: 60_000,
    });
    if (result.kind !== "otp.codeResult") throw new Error("expected code");
    expect(result.code).toMatch(/^\d{8}$/u);
    expect(JSON.stringify(result)).not.toContain(stored.secret);
    expect(repository.getCalls).toEqual([stored.id, stored.id]);
    // Reading a code is automatic polling, not a deliberate act; it must not reset the lock.
    expect(activity).toEqual([]);
  });

  it("uses period-bound countdown immediately before rollover", async () => {
    const stored = item({ period: 45 });
    const { service } = fixture([stored], 44_999);
    await expect(
      service.handle(
        request("otp.copyCode", { itemId: stored.id, expectedRevision: 1 }),
        vaultSender,
      ),
    ).resolves.toMatchObject({
      period: 45,
      remaining: 1,
      expiresAt: 45_000,
    });
  });

  it("rejects otp.copyCode with OTP_CONFLICT when the displayed expectedRevision is stale", async () => {
    const stored = item({ revision: 2, label: "updated-after-display" });
    const { activity, repository, service } = fixture([stored]);
    await expect(
      service.handle(
        request("otp.copyCode", { itemId: stored.id, expectedRevision: 1 }),
        vaultSender,
      ),
    ).rejects.toMatchObject({ code: "OTP_CONFLICT" });
    expect(repository.getCalls).toEqual([stored.id]);
    expect(repository.items.get(stored.id)).toMatchObject({
      revision: 2,
      label: "updated-after-display",
    });
    expect(activity).toEqual([]);
  });

  it("rejects otp.copyCode with OTP_CONFLICT when the item changes during generation", async () => {
    const stored = item();
    const { activity, repository, service } = fixture([stored]);
    repository.beforeGet = (itemId, call) => {
      if (call === 2) repository.items.set(itemId, item({ revision: 2, label: "raced" }));
    };
    await expect(
      service.handle(
        request("otp.copyCode", { itemId: stored.id, expectedRevision: 1 }),
        vaultSender,
      ),
    ).rejects.toMatchObject({ code: "OTP_CONFLICT" });
    expect(repository.getCalls).toEqual([stored.id, stored.id]);
    expect(activity).toEqual([]);
  });

  it("returns the authoritative code for otp.copyCode when expectedRevision matches", async () => {
    const stored = item({ period: 30 });
    const { activity, repository, service } = fixture([stored], 15_000);
    const result = await service.handle(
      request("otp.copyCode", { itemId: stored.id, expectedRevision: 1 }),
      vaultSender,
    );
    expect(result).toMatchObject({
      version: 1,
      kind: "otp.codeResult",
      itemId: stored.id,
      revision: 1,
      otpType: "totp",
      period: 30,
    });
    if (result.kind !== "otp.codeResult") throw new Error("expected code");
    expect(result.code).toMatch(/^\d{6}$/u);
    expect(JSON.stringify(result)).not.toContain(stored.secret);
    expect(repository.getCalls).toEqual([stored.id, stored.id]);
    expect(activity).toEqual(["noted"]);
  });

  it("handles Steam only from explicit valid steam type and returns five characters", async () => {
    const steam = item({ otpType: "steam", algorithm: "SHA1", digits: 5, period: 30 });
    const { service } = fixture([steam], 15_000);
    const result = await service.handle(request("otp.getCode", { itemId: steam.id }), popupSender);

    expect(result).toMatchObject({
      otpType: "steam",
      period: 30,
      remaining: 15,
      expiresAt: 30_000,
    });
    if (result.kind !== "otp.codeResult") throw new Error("expected code");
    expect(result.code).toMatch(/^[23456789BCDFGHJKMNPQRTVWXY]{5}$/u);
  });

  it("defers HOTP display to Task 4 without advancing its counter", async () => {
    const hotp = item({ otpType: "hotp", period: 0, counter: 7 });
    const { activity, repository, service } = fixture([hotp]);

    await expect(
      service.handle(request("otp.getCode", { itemId: hotp.id }), popupSender),
    ).rejects.toMatchObject({ code: "OTP_HOTP_REQUIRED" });
    expect(repository.items.get(hotp.id)).toMatchObject({ counter: 7, revision: 1 });
    expect(activity).toEqual([]);
  });

  it("fails closed when lock wins during code generation and leaks no seed or code", async () => {
    const stored = item({ secret: "KRUGS4ZANFZSAYJA" });
    const { activity, repository, service } = fixture([stored]);
    repository.beforeGet = (_itemId, call) => {
      if (call === 2) throw new VaultSessionError("VAULT_LOCKED");
    };

    const failure = await service
      .handle(request("otp.getCode", { itemId: stored.id }), popupSender)
      .catch((error: unknown) => error);
    expect(failure).toEqual(expect.objectContaining({ code: "VAULT_LOCKED" }));
    expect(JSON.stringify(failure)).not.toContain(stored.secret);
    expect(activity).toEqual([]);
  });

  it("fails closed when an item changes during code generation", async () => {
    const stored = item();
    const { activity, repository, service } = fixture([stored]);
    repository.beforeGet = (itemId, call) => {
      if (call === 2) repository.items.set(itemId, item({ revision: 2, label: "raced" }));
    };

    await expect(
      service.handle(request("otp.getCode", { itemId: stored.id }), popupSender),
    ).rejects.toMatchObject({ code: "OTP_CONFLICT" });
    expect(activity).toEqual([]);
  });

  it("maps storage, session, validation, and unknown failures to allowlisted typed codes", async () => {
    const cases: [unknown, string][] = [
      [new VaultSessionError("VAULT_NOT_CONFIGURED"), "VAULT_UNAVAILABLE"],
      [new VaultSessionError("VAULT_UNAVAILABLE"), "VAULT_UNAVAILABLE"],
      [new StorageError("VAULT_INVALID"), "VAULT_UNAVAILABLE"],
      [new StorageError("STORAGE_FAILED"), "VAULT_UNAVAILABLE"],
      [new Error("internal secret text"), "VAULT_UNAVAILABLE"],
    ];
    for (const [source, code] of cases) {
      const { repository, service } = fixture();
      repository.listError = source;
      const failure = await service
        .handle(request("otp.list", { query: "" }), popupSender)
        .catch((error: unknown) => error);
      expect(failure).toEqual(expect.objectContaining({ code }));
      expect((failure as Error).message).toBe(code);
      expect(JSON.stringify(failure)).not.toContain("internal secret text");
    }
  });

  it.each(["create", "update", "delete"] as const)(
    "preserves a committed %s result when activity scheduling rejects",
    async (operation) => {
      const stored = item();
      const { repository, service } = fixture(operation === "create" ? [] : [stored], 15_000, () =>
        Promise.reject(new Error("internal activity failure")),
      );
      const result =
        operation === "create"
          ? await service.handle(request("otp.create", { input: editable() }), vaultSender)
          : operation === "update"
            ? await service.handle(
                request("otp.update", {
                  itemId: stored.id,
                  expectedRevision: 1,
                  input: editable({ label: "changed" }),
                }),
                vaultSender,
              )
            : await service.handle(
                request("otp.delete", { itemId: stored.id, expectedRevision: 1 }),
                vaultSender,
              );

      expect(result.kind).toBe(operation === "delete" ? "otp.deleteResult" : "otp.mutationResult");
      expect(repository.createCalls).toBe(operation === "create" ? 1 : 0);
      expect(repository.updateCalls).toBe(operation === "update" ? 1 : 0);
      expect(repository.tombstoneCalls).toBe(operation === "delete" ? 1 : 0);
    },
  );

  it.each(["list", "editor", "code"] as const)(
    "preserves a successful %s response when activity scheduling rejects",
    async (operation) => {
      const stored = item();
      const { service } = fixture([stored], 15_000, () =>
        Promise.reject(new Error("internal activity failure")),
      );
      const result =
        operation === "list"
          ? await service.handle(request("otp.list", { query: "" }), popupSender)
          : operation === "editor"
            ? await service.handle(request("otp.getEditor", { itemId: stored.id }), vaultSender)
            : await service.handle(request("otp.getCode", { itemId: stored.id }), popupSender);

      expect(result.kind).toBe(
        operation === "list"
          ? "otp.listResult"
          : operation === "editor"
            ? "otp.editorResult"
            : "otp.codeResult",
      );
    },
  );

  it("records activity for deliberate operations but not for automatic polling", async () => {
    const stored = item();
    const { activity, service } = fixture([stored]);
    // list and getCode are issued by views on a schedule; only opening the editor is a person acting.
    await service.handle(request("otp.list", { query: "" }), popupSender);
    await service.handle(request("otp.getCode", { itemId: stored.id }), popupSender);
    expect(activity).toEqual([]);
    await service.handle(request("otp.getEditor", { itemId: stored.id }), vaultSender);
    expect(activity).toEqual(["noted"]);
  });

  it("returns responses accepted by strict messaging schemas", async () => {
    const { service } = fixture([item()]);
    for (const result of [
      await service.handle(request("otp.list", { query: "" }), popupSender),
      await service.handle(request("otp.getEditor", { itemId: ids.first }), vaultSender),
      await service.handle(request("otp.getCode", { itemId: ids.first }), popupSender),
    ]) {
      expect(OtpResponseSchema.safeParse(result).success).toBe(true);
      expect(Object.isFrozen(result)).toBe(true);
    }
  });

  it("rejects Task 4 lifecycle commands without invoking reservation state", async () => {
    const { activity, service } = fixture([item()]);
    await expect(
      service.handle(request("otp.reserveHotp", { itemId: ids.first }), {
        extensionId: "extension-id",
        contextKind: "content",
        senderUrl: "https://example.test/",
        tabId: 1,
        frameId: 0,
        documentId: "content-document",
      }),
    ).rejects.toMatchObject({ code: "OTP_RESERVATION_INVALID" });
    expect(activity).toEqual([]);
  });
});
