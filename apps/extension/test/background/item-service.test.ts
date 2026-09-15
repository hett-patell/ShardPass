import type {
  CardItem,
  IdentityItem,
  LoginItem,
  OtpItem,
  SecretItem,
  VaultItem,
} from "@shardpass/domain";
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
  card: "018f47a6-7d11-7c2f-8bd9-a1d37f147a24",
  identity: "018f47a6-7d11-7c2f-8bd9-a1d37f147a25",
  secret: "018f47a6-7d11-7c2f-8bd9-a1d37f147a26",
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

function cardItem(overrides: Partial<CardItem> = {}): CardItem {
  return {
    id: ids.card,
    schemaVersion: 2,
    revision: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
    favorite: false,
    tags: [],
    kind: "card",
    name: "Everyday Visa",
    cardholderName: "Alice Example",
    number: "4111 1111 1111 1234",
    expMonth: "01",
    expYear: "2030",
    cvv: "123",
    pin: "",
    notes: "",
    ...overrides,
  };
}

function identityItem(overrides: Partial<IdentityItem> = {}): IdentityItem {
  return {
    id: ids.identity,
    schemaVersion: 2,
    revision: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
    favorite: false,
    tags: [],
    kind: "identity",
    name: "Primary Identity",
    firstName: "Alice",
    lastName: "Example",
    email: "alice@example.test",
    phone: "",
    street: "",
    city: "",
    state: "",
    zip: "",
    country: "",
    notes: "",
    ...overrides,
  };
}

function secretItem(overrides: Partial<SecretItem> = {}): SecretItem {
  return {
    id: ids.secret,
    schemaVersion: 2,
    revision: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
    favorite: false,
    tags: [],
    kind: "secret",
    name: "Deploy token",
    secretType: "token",
    value: "sk-super-secret-value",
    metadata: {},
    notes: "",
    ...overrides,
  };
}

class FakeRepository implements Pick<
  SessionVaultRepository,
  "listAllItems" | "getItem" | "createItem" | "createItems" | "updateItem" | "tombstone"
> {
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

  createItems(candidates: readonly VaultItem[]) {
    const results = candidates.map((item, index) => {
      this.items.set(item.id, item);
      return { index, status: "created" as const, itemId: item.id };
    });
    return Promise.resolve(results);
  }

  createItem(candidate: VaultItem): Promise<VaultItem> {
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

function request(
  kind: ItemCrudRequest["kind"],
  values: Record<string, unknown> = {},
): ItemCrudRequest {
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
    now: () => Date.parse(nowIso),
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
    expect(created).toMatchObject({
      kind: "item.mutationResult",
      item: { id: ids.created, name: "Example" },
    });

    const fetched = await service.handle(request("item.get", { itemId: ids.created }), vaultSender);
    expect(fetched).toMatchObject({
      kind: "item.getResult",
      item: { id: ids.created, username: "alice" },
    });
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
    const result = await service.handle(request("item.query", { itemKind: "login" }), vaultSender);
    if (result.kind !== "item.queryResult") throw new Error("expected query result");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ kind: "login", id: ids.login });
  });

  it("queries items filtered by folder and favorites", async () => {
    const inFolder = loginItem({ id: ids.login, folderId, favorite: true });
    const other = otpItem({ id: ids.otp, favorite: false });
    const { service } = fixture([inFolder, other]);

    const byFolder = await service.handle(request("item.query", { folderId }), vaultSender);
    if (byFolder.kind !== "item.queryResult") throw new Error("expected query result");
    expect(byFolder.items.map((item) => item.id)).toEqual([ids.login]);

    const favoritesOnly = await service.handle(
      request("item.query", { favoritesOnly: true }),
      vaultSender,
    );
    if (favoritesOnly.kind !== "item.queryResult") throw new Error("expected query result");
    expect(favoritesOnly.items.map((item) => item.id)).toEqual([ids.login]);
  });

  it("searches by name/issuer+label and tags, normalized", async () => {
    const values = [
      loginItem({ id: ids.login, name: "Ａcme Portal" }),
      otpItem({ id: ids.otp, issuer: "Other", label: "İSTANBUL" }),
    ];
    const { service } = fixture(values);

    const byName = await service.handle(request("item.query", { search: "acme" }), vaultSender);
    if (byName.kind !== "item.queryResult") throw new Error("expected query result");
    expect(byName.items.map((item) => item.id)).toEqual([ids.login]);

    const byIssuer = await service.handle(
      request("item.query", { search: "i̇stanbul" }),
      vaultSender,
    );
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

  it("defends every mutating item-crud command in depth; the popup may read one item for its detail screen", async () => {
    const stored = loginItem();
    const { repository, service } = fixture([stored]);
    await expect(service.handle(request("item.query", {}), popupSender)).rejects.toMatchObject({
      code: "ITEM_INVALID",
    });
    await expect(
      service.handle(request("item.get", { itemId: stored.id }), popupSender),
    ).resolves.toMatchObject({ kind: "item.getResult", item: { id: stored.id } });
    await expect(
      service.handle(request("item.get", { itemId: stored.id }), {
        extensionId: vaultSender.extensionId,
        contextKind: "content",
        senderUrl: "https://example.test/login",
        tabId: 7,
        frameId: 0,
        documentId: "content-document",
      }),
    ).rejects.toMatchObject({ code: "ITEM_INVALID" });
    await expect(
      service.handle(
        request("item.create", { item: { ...loginItem(), id: ids.created } }),
        popupSender,
      ),
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
    expect(result).toMatchObject({
      kind: "item.mutationResult",
      item: { revision: 2, username: "renamed", notes: "old" },
    });
    expect(repository.items.get(stored.id)).toMatchObject({
      id: stored.id,
      kind: "login",
      revision: 2,
    });
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
    expect(result).toMatchObject({
      kind: "item.mutationResult",
      item: { id: stored.id, kind: "login", username: "still-login" },
    });
  });

  it("returns ITEM_CONFLICT when the displayed expectedRevision is stale", async () => {
    const stored = loginItem({ revision: 2 });
    const { activity, service } = fixture([stored]);
    await expect(
      service.handle(
        request("item.update", {
          itemId: stored.id,
          expectedRevision: 1,
          fields: { username: "x" },
        }),
        vaultSender,
      ),
    ).rejects.toMatchObject({ code: "ITEM_CONFLICT" });
    expect(activity).toEqual([]);
  });

  it("returns ITEM_NOT_FOUND for get, update, and delete of a missing item", async () => {
    const { service } = fixture();
    await expect(
      service.handle(request("item.get", { itemId: ids.missing }), vaultSender),
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
    expect(result).toEqual({
      version: 1,
      kind: "item.deleteResult",
      itemId: stored.id,
      revision: 2,
    });
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
        .handle(request("item.query", {}), vaultSender)
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
      await service.handle(request("item.query", {}), vaultSender),
      await service.handle(request("item.get", { itemId: stored.id }), vaultSender),
    ]) {
      expect(ItemCrudResponseSchema.safeParse(result).success).toBe(true);
      expect(Object.isFrozen(result)).toBe(true);
    }
  });

  describe("item.list (popup-safe projection)", () => {
    it("is reachable from the popup, unlike the full-item commands", async () => {
      const { service } = fixture([loginItem()]);
      const result = await service.handle(request("item.list", {}), popupSender);
      expect(result.kind).toBe("item.listResult");
    });

    it("never includes plaintext secret material for any kind", async () => {
      const values = [loginItem(), otpItem(), cardItem(), identityItem(), secretItem()];
      const { service } = fixture(values);
      const result = await service.handle(request("item.list", {}), popupSender);
      if (result.kind !== "item.listResult") throw new Error("expected list result");
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("s3cret");
      expect(serialized).not.toContain("JBSWY3DPEHPK3PXP");
      expect(serialized).not.toContain("4111 1111 1111 1234");
      expect(serialized).not.toContain("sk-super-secret-value");
      for (const item of result.items) {
        expect(item).not.toHaveProperty("password");
        expect(item).not.toHaveProperty("secret");
        expect(item).not.toHaveProperty("number");
        expect(item).not.toHaveProperty("value");
      }
    });

    it("projects a display name and safe subtitle per kind", async () => {
      const note: VaultItem = {
        id: ids.note,
        schemaVersion: 2,
        revision: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
        favorite: false,
        tags: [],
        kind: "note",
        name: "Wifi",
        content: "  guest-network  \nsecondary line",
      };
      const values = [loginItem(), otpItem(), note, cardItem(), identityItem(), secretItem()];
      const { service } = fixture(values);
      const result = await service.handle(request("item.list", {}), popupSender);
      if (result.kind !== "item.listResult") throw new Error("expected list result");
      const byId = new Map(result.items.map((item) => [item.id, item]));

      expect(byId.get(ids.login)).toMatchObject({
        kind: "login",
        name: "Example",
        subtitle: "alice",
      });
      expect(byId.get(ids.otp)).toMatchObject({
        kind: "otp",
        name: "Example",
        subtitle: "account",
      });
      expect(byId.get(ids.note)).toMatchObject({
        kind: "note",
        name: "Wifi",
        subtitle: "guest-network",
      });
      expect(byId.get(ids.card)).toMatchObject({
        kind: "card",
        name: "Everyday Visa",
        subtitle: "•••• 1234",
      });
      expect(byId.get(ids.identity)).toMatchObject({ kind: "identity", name: "Primary Identity" });
      // The popup pins the person's identity at the top and shows the email beneath the name.
      expect(byId.get(ids.identity)?.subtitle).toBe(identityItem().email);
      expect(byId.get(ids.secret)).toMatchObject({
        kind: "secret",
        name: "Deploy token",
        subtitle: "Token",
      });
    });

    it("omits the subtitle when there is nothing safe to preview", async () => {
      const values = [loginItem({ username: "" }), cardItem({ number: "12" })];
      const { service } = fixture(values);
      const result = await service.handle(request("item.list", {}), popupSender);
      if (result.kind !== "item.listResult") throw new Error("expected list result");
      for (const item of result.items) expect(item.subtitle).toBeUndefined();
    });

    it("filters by kind and search the same way item.query does", async () => {
      const values = [
        loginItem({ name: "Ａcme Portal" }),
        otpItem({ issuer: "Other", label: "x" }),
      ];
      const { service } = fixture(values);

      const byKind = await service.handle(request("item.list", { itemKind: "login" }), popupSender);
      if (byKind.kind !== "item.listResult") throw new Error("expected list result");
      expect(byKind.items.map((item) => item.id)).toEqual([ids.login]);

      const bySearch = await service.handle(request("item.list", { search: "acme" }), popupSender);
      if (bySearch.kind !== "item.listResult") throw new Error("expected list result");
      expect(bySearch.items.map((item) => item.id)).toEqual([ids.login]);
    });

    it("is also reachable from the vault page and returns a frozen, schema-valid response", async () => {
      const { service } = fixture([loginItem()]);
      const result = await service.handle(request("item.list", {}), vaultSender);
      expect(ItemCrudResponseSchema.safeParse(result).success).toBe(true);
      expect(Object.isFrozen(result)).toBe(true);
      if (result.kind === "item.listResult")
        expect(Object.isFrozen(result.items[0]?.tags)).toBe(true);
    });
  });
});

describe("item.createMany", () => {
  it("creates new items, skips duplicates of stored ones, and names why an entry is invalid", async () => {
    const { service, repository } = fixture([loginItem()]);
    const fresh = loginItem({
      id: ids.created,
      name: "Other",
      username: "bob",
      urls: ["https://other.test"],
    });

    const response = await service.handle(
      request("item.createMany", {
        items: [loginItem({ id: ids.missing }), { kind: "login" }, fresh],
      }),
      vaultSender,
    );

    expect(response).toEqual({
      version: 1,
      kind: "item.createManyResult",
      results: [
        // Same account as the stored login (name, username, host) under a new id.
        { index: 0, status: "duplicate" },
        { index: 1, status: "invalid", reason: expect.any(String) as unknown },
        { index: 2, status: "created", itemId: ids.created },
      ],
    });
    expect(repository.items.has(ids.created)).toBe(true);
    expect(repository.items.has(ids.missing)).toBe(false);
  });

  it("deduplicates within the batch itself", async () => {
    const { service } = fixture();
    const response = await service.handle(
      request("item.createMany", {
        items: [loginItem({ id: ids.login }), loginItem({ id: ids.created })],
      }),
      vaultSender,
    );
    expect(response).toMatchObject({
      results: [
        { index: 0, status: "created", itemId: ids.login },
        { index: 1, status: "duplicate" },
      ],
    });
  });

  it("keeps a login that differs only by password or folder: same name is not the same item", async () => {
    const { service } = fixture([loginItem()]);
    const response = await service.handle(
      request("item.createMany", {
        items: [
          loginItem({ id: ids.created, password: "another-password" }),
          loginItem({ id: ids.missing, folderId: "30000000-0000-4000-8000-000000000001" }),
        ],
      }),
      vaultSender,
    );
    expect(response).toMatchObject({
      results: [
        { index: 0, status: "created" },
        { index: 1, status: "created" },
      ],
    });
  });

  it("brings a stored login up to date from a richer copy instead of skipping it", async () => {
    const { service, repository } = fixture([loginItem({ password: "" })]);
    const response = await service.handle(
      request("item.createMany", {
        items: [
          loginItem({
            id: ids.created,
            password: "",
            signInWith: "google",
            urls: ["https://example.test", "https://mail.example.test"],
            tags: ["Work"],
          }),
          loginItem({ id: ids.missing, password: "" }),
        ],
      }),
      vaultSender,
    );
    expect(response).toMatchObject({
      results: [
        { index: 0, status: "updated", itemId: ids.login },
        { index: 1, status: "duplicate" },
      ],
    });
    const stored = repository.items.get(ids.login);
    expect(stored).toMatchObject({
      signInWith: "google",
      urls: ["https://example.test", "https://mail.example.test"],
      tags: ["Work"],
    });
    expect(repository.items.has(ids.created)).toBe(false);
  });

  it("treats a login on a different host as a different account", async () => {
    const { service } = fixture([loginItem()]);
    const response = await service.handle(
      request("item.createMany", {
        items: [loginItem({ id: ids.created, urls: ["https://elsewhere.test"] })],
      }),
      vaultSender,
    );
    expect(response).toMatchObject({ results: [{ index: 0, status: "created" }] });
  });

  it("is vault-only", async () => {
    const { service } = fixture();
    await expect(
      service.handle(request("item.createMany", { items: [] }), popupSender),
    ).rejects.toMatchObject({ code: "ITEM_INVALID" });
  });

  it("returns an empty result for an empty batch without touching the repository", async () => {
    const { service, activity } = fixture();
    const response = await service.handle(request("item.createMany", { items: [] }), vaultSender);
    expect(response).toEqual({ version: 1, kind: "item.createManyResult", results: [] });
    expect(activity).toEqual(["noted"]);
  });
});

describe("password history on item.update", () => {
  it("records the outgoing password with the time it stopped being current", async () => {
    const { service, repository } = fixture([loginItem()]);
    await service.handle(
      request("item.update", {
        itemId: ids.login,
        expectedRevision: 1,
        fields: { password: "n3w" },
      }),
      vaultSender,
    );
    const stored = repository.items.get(ids.login);
    expect(stored?.kind === "login" && stored.password).toBe("n3w");
    expect(stored?.kind === "login" && stored.passwordHistory).toEqual([
      { password: "s3cret", changedAt: nowIso },
    ]);
  });

  it("keeps the newest entries first and caps the list", async () => {
    const seeded = loginItem({
      passwordHistory: Array.from({ length: 10 }, (_, index) => ({
        password: `old-${index}`,
        changedAt: nowIso,
      })),
    });
    const { service, repository } = fixture([seeded]);
    await service.handle(
      request("item.update", {
        itemId: ids.login,
        expectedRevision: 1,
        fields: { password: "n3w" },
      }),
      vaultSender,
    );
    const stored = repository.items.get(ids.login);
    const history = stored?.kind === "login" ? (stored.passwordHistory ?? []) : [];
    expect(history).toHaveLength(10);
    expect(history[0]).toEqual({ password: "s3cret", changedAt: nowIso });
    expect(history.at(-1)?.password).toBe("old-8");
  });

  it("does not record an unchanged or empty outgoing password", async () => {
    const { service, repository } = fixture([loginItem({ password: "" })]);
    await service.handle(
      request("item.update", {
        itemId: ids.login,
        expectedRevision: 1,
        fields: { password: "first" },
      }),
      vaultSender,
    );
    expect(repository.items.get(ids.login)).not.toHaveProperty("passwordHistory");

    const revision = repository.items.get(ids.login)?.revision ?? 1;
    await service.handle(
      request("item.update", {
        itemId: ids.login,
        expectedRevision: revision,
        fields: { username: "bob" },
      }),
      vaultSender,
    );
    expect(repository.items.get(ids.login)).not.toHaveProperty("passwordHistory");
  });

  it("defers to an explicitly supplied history", async () => {
    const { service, repository } = fixture([loginItem()]);
    await service.handle(
      request("item.update", {
        itemId: ids.login,
        expectedRevision: 1,
        fields: { password: "n3w", passwordHistory: [] },
      }),
      vaultSender,
    );
    const stored = repository.items.get(ids.login);
    expect(stored?.kind === "login" && stored.passwordHistory).toEqual([]);
  });
});

describe("inactivity-lock activity", () => {
  it("is noted for mutations but not for reads", async () => {
    const { service, activity } = fixture([loginItem()]);
    await service.handle(request("item.list"), popupSender);
    await service.handle(request("item.query"), vaultSender);
    await service.handle(request("item.get", { itemId: ids.login }), vaultSender);
    // Reads are issued by views on their own schedule; they must not keep the vault open.
    expect(activity).toEqual([]);

    await service.handle(
      request("item.update", { itemId: ids.login, expectedRevision: 1, fields: { notes: "x" } }),
      vaultSender,
    );
    expect(activity).toEqual(["noted"]);
  });
});

describe("archive", () => {
  it("keeps archived items out of every ordinary listing and shows them only on request", async () => {
    const archived = loginItem({ id: ids.created, name: "Old", archivedAt: nowIso });
    const { service } = fixture([loginItem(), archived]);
    const everyday = (await service.handle(request("item.query"), vaultSender)) as {
      items: { id: string }[];
    };
    expect(everyday.items.map((item) => item.id)).toEqual([ids.login]);
    const popup = (await service.handle(request("item.list"), popupSender)) as {
      items: { id: string }[];
    };
    expect(popup.items.map((item) => item.id)).toEqual([ids.login]);
    const shelf = (await service.handle(
      request("item.query", { archived: true }),
      vaultSender,
    )) as { items: { id: string }[] };
    expect(shelf.items.map((item) => item.id)).toEqual([ids.created]);
  });
});

describe("update clears", () => {
  it("treats a null field as a request to remove it, so un-filing survives the wire format", async () => {
    const filed = loginItem({
      folderId: "11111111-1111-4111-8111-111111111111",
      archivedAt: nowIso,
    });
    const { service, repository } = fixture([filed]);
    const response = (await service.handle(
      request("item.update", {
        itemId: filed.id,
        expectedRevision: filed.revision,
        fields: { folderId: null, archivedAt: null },
      }),
      vaultSender,
    )) as { item: Record<string, unknown> };
    expect(response.item).not.toHaveProperty("folderId");
    expect(response.item).not.toHaveProperty("archivedAt");
    expect(await repository.getItem(filed.id)).not.toHaveProperty("folderId");
  });
});

describe("search", () => {
  it("finds a login by username or site host from the popup's list, not only by name", async () => {
    const github = loginItem({
      id: ids.created,
      name: "Code host",
      username: "octocat",
      urls: ["https://github.com/login"],
    });
    const { service } = fixture([loginItem(), github]);
    const byUser = (await service.handle(
      request("item.list", { search: "octo" }),
      popupSender,
    )) as {
      items: { id: string }[];
    };
    expect(byUser.items.map((item) => item.id)).toEqual([ids.created]);
    const byHost = (await service.handle(
      request("item.list", { search: "github" }),
      popupSender,
    )) as {
      items: { id: string }[];
    };
    expect(byHost.items.map((item) => item.id)).toEqual([ids.created]);
  });
});
