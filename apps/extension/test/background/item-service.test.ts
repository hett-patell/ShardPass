import type { LoginItem, OtpItem, VaultItem } from "@shardpass/domain";
import type { ItemCrudRequest, SenderContext } from "@shardpass/messaging";
import { ItemCrudResponseSchema } from "@shardpass/messaging";
import { StorageError, type TombstoneResult } from "@shardpass/storage";
import { describe, expect, it } from "vitest";

import { ItemService, ItemServiceError } from "../../src/background/item/item-service";
import { VaultSessionError } from "../../src/background/vault/session-service";
import type { SessionVaultRepository } from "../../src/background/vault/session-vault-repository";

const ids = {
  login: "018f47a6-7d11-7c2f-8bd9-a1d37f147a20",
  otp: "018f47a6-7d11-7c2f-8bd9-a1d37f147a21",
  note: "018f47a6-7d11-7c2f-8bd9-a1d37f147a22",
  created: "018f47a6-7d11-7c2f-8bd9-a1d37f147a23",
  missing: "018f47a6-7d11-7c2f-8bd9-a1d37f147a99",
};
const folderId = "89abcdef-0123-4456-8789-0123456789ab";
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

function loginItem(overrides: Partial<LoginItem> = {}): LoginItem {
  return {
    id: ids.login,
    schemaVersion: 2,
    revision: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
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

function otpItem(overrides: Partial<OtpItem> = {}): OtpItem {
  return {
    id: ids.otp,
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

class FakeRepository
  implements Pick<SessionVaultRepository, "listAllItems" | "getItem" | "createItem" | "updateItem" | "tombstone">
{
  readonly items = new Map<string, VaultItem>();
  tombstoneCalls = 0;
  listError: unknown;

  constructor(values: readonly VaultItem[] = []) {
    for (const value of values) this.items.set(value.id, structuredClone(value));
  }

  listAllItems(): Promise<readonly VaultItem[]> {
    if (this.listError !== undefined) return Promise.reject(asError(this.listError));
    return Promise.resolve([...this.items.values()].map((value) => structuredClone(value)));
  }

  getItem(itemId: string): Promise<VaultItem | null> {
    const value = this.items.get(itemId);
    return Promise.resolve(value === undefined ? null : structuredClone(value));
  }

  createItem(candidate: VaultItem): Promise<VaultItem> {
    if (this.items.has(candidate.id)) return Promise.reject(new StorageError("REVISION_CONFLICT"));
    const created = { ...structuredClone(candidate), revision: 1, createdAt: nowIso, updatedAt: nowIso };
    this.items.set(created.id, created);
    return Promise.resolve(structuredClone(created));
  }

  updateItem(candidate: VaultItem, expectedRevision: number): Promise<VaultItem> {
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
    } as VaultItem;
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
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error("test failure");
}

function request(kind: ItemCrudRequest["kind"], values: Record<string, unknown> = {}): ItemCrudRequest {
  return { version: 1, kind, ...values } as ItemCrudRequest;
}

function fixture(
  values: readonly VaultItem[] = [],
  notePrivilegedActivity: (() => Promise<void>) | undefined = undefined,
) {
  const repository = new FakeRepository(values);
  const activity: string[] = [];
  const service = new ItemService({
    repository,
    notePrivilegedActivity:
      notePrivilegedActivity ??
      (() => {
        activity.push("noted");
        return Promise.resolve();
      }),
  });
  return { activity, repository, service };
}

describe("ItemService", () => {
  it("creates a login item and retrieves it", async () => {
    const { service } = fixture();
    const candidate = { ...loginItem(), id: ids.created };

    const created = await service.handle(request("item.create", { item: candidate }), vaultSender);
    expect(created).toMatchObject({ kind: "item.mutationResult", item: { id: ids.created, name: "Example" } });

    const fetched = await service.handle(request("item.get", { itemId: ids.created }), popupSender);
    expect(fetched).toMatchObject({ kind: "item.getResult", item: { id: ids.created, username: "alice" } });
  });

  it("queries items filtered by kind", async () => {
    const note: VaultItem = {
      id: ids.note,
      schemaVersion: 2,
      revision: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
      favorite: false,
      tags: [],
      kind: "note",
      name: "A note",
      content: "",
    };
    const { service } = fixture([loginItem(), otpItem(), note]);
    const result = await service.handle(request("item.query", { itemKind: "login" }), popupSender);
    if (result.kind !== "item.queryResult") throw new Error("expected query result");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ kind: "login", id: ids.login });
  });

  it("queries items filtered by folder and favorites", async () => {
    const inFolder = loginItem({ id: ids.login, folderId, favorite: true });
    const other = otpItem({ id: ids.otp, favorite: false });
    const { service } = fixture([inFolder, other]);

    const byFolder = await service.handle(request("item.query", { folderId }), popupSender);
    if (byFolder.kind !== "item.queryResult") throw new Error("expected query result");
    expect(byFolder.items.map((item) => item.id)).toEqual([ids.login]);

    const favoritesOnly = await service.handle(request("item.query", { favoritesOnly: true }), popupSender);
    if (favoritesOnly.kind !== "item.queryResult") throw new Error("expected query result");
    expect(favoritesOnly.items.map((item) => item.id)).toEqual([ids.login]);
  });

  it("searches by name/issuer+label and tags, normalized", async () => {
    const values = [
      loginItem({ id: ids.login, name: "Ａcme Portal" }),
      otpItem({ id: ids.otp, issuer: "Other", label: "İSTANBUL" }),
    ];
    const { service } = fixture(values);

    const byName = await service.handle(request("item.query", { search: "acme" }), popupSender);
    if (byName.kind !== "item.queryResult") throw new Error("expected query result");
    expect(byName.items.map((item) => item.id)).toEqual([ids.login]);

    const byIssuer = await service.handle(request("item.query", { search: "i̇stanbul" }), popupSender);
    if (byIssuer.kind !== "item.queryResult") throw new Error("expected query result");
    expect(byIssuer.items.map((item) => item.id)).toEqual([ids.otp]);
  });

  it("rejects invalid item schema on create", async () => {
    const { activity, repository, service } = fixture();
    await expect(
      service.handle(request("item.create", { item: { kind: "login" } }), vaultSender),
    ).rejects.toMatchObject({ code: "ITEM_INVALID" });
    expect(repository.items.size).toBe(0);
    expect(activity).toEqual([]);
  });

  it("rejects item.create, item.update, and item.delete from a popup sender in depth", async () => {
    const stored = loginItem();
    const { repository, service } = fixture([stored]);
    await expect(
      service.handle(request("item.create", { item: { ...loginItem(), id: ids.created } }), popupSender),
    ).rejects.toMatchObject({ code: "ITEM_INVALID" });
    await expect(
      service.handle(
        request("item.update", { itemId: stored.id, expectedRevision: 1, fields: { name: "x" } }),
        popupSender,
      ),
    ).rejects.toMatchObject({ code: "ITEM_INVALID" });
    await expect(
      service.handle(request("item.delete", { itemId: stored.id }), popupSender),
    ).rejects.toMatchObject({ code: "ITEM_INVALID" });
    expect(repository.items.has(stored.id)).toBe(true);
  });

  it("updates only the supplied fields and preserves repository-owned metadata", async () => {
    const stored = loginItem({ notes: "old" });
    const { activity, repository, service } = fixture([stored]);
    const result = await service.handle(
      request("item.update", {
        itemId: stored.id,
        expectedRevision: 1,
        fields: { username: "renamed" },
      }),
      vaultSender,
    );
    expect(result).toMatchObject({ kind: "item.mutationResult", item: { revision: 2, username: "renamed", notes: "old" } });
    expect(repository.items.get(stored.id)).toMatchObject({ id: stored.id, kind: "login", revision: 2 });
    expect(activity).toEqual(["noted"]);
  });

  it("ignores a client-supplied kind/id override during update", async () => {
    const stored = loginItem();
    const { service } = fixture([stored]);
    const result = await service.handle(
      request("item.update", {
        itemId: stored.id,
        expectedRevision: 1,
        fields: { kind: "note", id: ids.missing, username: "still-login" },
      }),
      vaultSender,
    );
    expect(result).toMatchObject({ kind: "item.mutationResult", item: { id: stored.id, kind: "login", username: "still-login" } });
  });

  it("returns ITEM_CONFLICT when the displayed expectedRevision is stale", async () => {
    const stored = loginItem({ revision: 2 });
    const { activity, service } = fixture([stored]);
    await expect(
      service.handle(
        request("item.update", { itemId: stored.id, expectedRevision: 1, fields: { username: "x" } }),
        vaultSender,
      ),
    ).rejects.toMatchObject({ code: "ITEM_CONFLICT" });
    expect(activity).toEqual([]);
  });

  it("returns ITEM_NOT_FOUND for get, update, and delete of a missing item", async () => {
    const { service } = fixture();
    await expect(
      service.handle(request("item.get", { itemId: ids.missing }), popupSender),
    ).rejects.toMatchObject({ code: "ITEM_NOT_FOUND" });
    await expect(
      service.handle(
        request("item.update", { itemId: ids.missing, expectedRevision: 1, fields: {} }),
        vaultSender,
      ),
    ).rejects.toMatchObject({ code: "ITEM_NOT_FOUND" });
    await expect(
      service.handle(request("item.delete", { itemId: ids.missing }), vaultSender),
    ).rejects.toMatchObject({ code: "ITEM_NOT_FOUND" });
  });

  it("tombstones with the current revision and returns no secret material", async () => {
    const stored = loginItem();
    const { activity, repository, service } = fixture([stored]);
    const result = await service.handle(request("item.delete", { itemId: stored.id }), vaultSender);
    expect(result).toEqual({ version: 1, kind: "item.deleteResult", itemId: stored.id, revision: 2 });
    expect(repository.items.has(stored.id)).toBe(false);
    expect(JSON.stringify(result)).not.toContain(stored.password);
    expect(activity).toEqual(["noted"]);
  });

  it("maps storage, session, and unknown failures to allowlisted typed codes", async () => {
    const cases: [unknown, string][] = [
      [new VaultSessionError("VAULT_LOCKED"), "VAULT_LOCKED"],
      [new StorageError("VAULT_INVALID"), "ITEM_INVALID"],
      [new StorageError("STORAGE_FAILED"), "VAULT_UNAVAILABLE"],
      [new Error("internal secret text"), "VAULT_UNAVAILABLE"],
    ];
    for (const [source, code] of cases) {
      const { repository, service } = fixture();
      repository.listError = source;
      const failure = await service
        .handle(request("item.query", {}), popupSender)
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ItemServiceError);
      expect(failure).toEqual(expect.objectContaining({ code }));
      expect(JSON.stringify(failure)).not.toContain("internal secret text");
    }
  });

  it("preserves a committed mutation when activity scheduling rejects", async () => {
    const stored = loginItem();
    const { repository, service } = fixture([stored], () =>
      Promise.reject(new Error("internal activity failure")),
    );
    const result = await service.handle(request("item.delete", { itemId: stored.id }), vaultSender);
    expect(result.kind).toBe("item.deleteResult");
    expect(repository.tombstoneCalls).toBe(1);
  });

  it("returns responses accepted by the strict item CRUD messaging schema, deeply frozen", async () => {
    const stored = loginItem();
    const { service } = fixture([stored]);
    for (const result of [
      await service.handle(request("item.query", {}), popupSender),
      await service.handle(request("item.get", { itemId: stored.id }), popupSender),
    ]) {
      expect(ItemCrudResponseSchema.safeParse(result).success).toBe(true);
      expect(Object.isFrozen(result)).toBe(true);
    }
  });
});
