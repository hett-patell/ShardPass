import type { Folder, VaultItem } from "@shardpass/domain";
import type { SenderContext } from "@shardpass/messaging";
import { describe, expect, it } from "vitest";

import { FolderService } from "../../src/background/folder/folder-service";

const vaultSender: SenderContext = {
  extensionId: "extension-id",
  contextKind: "vault",
  senderUrl: "chrome-extension://extension-id/vault/index.html",
  documentId: "vault-document",
};
const popupSender: SenderContext = {
  ...vaultSender,
  contextKind: "popup",
  senderUrl: "chrome-extension://extension-id/popup/index.html",
};

const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
] as const;

function login(id: string, folderId?: string): VaultItem {
  return {
    id,
    schemaVersion: 2,
    revision: 1,
    createdAt: "2026-08-10T12:00:00.000Z",
    updatedAt: "2026-08-10T12:00:00.000Z",
    favorite: false,
    tags: [],
    kind: "login",
    name: "x",
    username: "u",
    password: "p",
    urls: [],
    notes: "",
    ...(folderId === undefined ? {} : { folderId }),
  };
}

function fixture(folders: Folder[] = [], items: VaultItem[] = []) {
  let stored = folders;
  const updated: VaultItem[] = [];
  let counter = 0;
  const service = new FolderService({
    repository: {
      readFolders: () => Promise.resolve(stored),
      replaceFolders: (next) => {
        stored = [...next];
        return Promise.resolve();
      },
      listAllItems: () => Promise.resolve(items),
      updateItems: (changes) => {
        for (const { candidate } of changes) updated.push(candidate);
        return Promise.resolve(changes.map(({ candidate }) => candidate));
      },
    },
    nextId: () => ids[counter++] ?? "",
    notePrivilegedActivity: () => Promise.resolve(),
  });
  return {
    service,
    get stored() {
      return stored;
    },
    updated,
  };
}
const req = (kind: string, values: Record<string, unknown> = {}) =>
  ({ version: 1, kind, ...values }) as never;

describe("FolderService", () => {
  it("creates, renames, and lists folders", async () => {
    const { service } = fixture();
    const created = await service.handle(req("folder.create", { name: "Work" }), vaultSender);
    expect(created.folders).toEqual([{ id: ids[0], name: "Work" }]);
    const child = await service.handle(
      req("folder.create", { name: "Clients", parentId: ids[0] }),
      vaultSender,
    );
    expect(child.folders[1]).toEqual({ id: ids[1], name: "Clients", parentId: ids[0] });
    const renamed = await service.handle(
      req("folder.rename", { id: ids[0], name: "Office" }),
      vaultSender,
    );
    expect(renamed.folders[0]?.name).toBe("Office");
    expect((await service.handle(req("folder.list"), vaultSender)).folders).toHaveLength(2);
  });

  it("refuses a sibling with the same name, ignoring case", async () => {
    const { service } = fixture([{ id: ids[0], name: "Work" }]);
    await expect(
      service.handle(req("folder.create", { name: "work" }), vaultSender),
    ).rejects.toMatchObject({ code: "FOLDER_INVALID" });
  });

  it("refuses nesting beyond the depth limit", async () => {
    const { service } = fixture([
      { id: ids[0], name: "a" },
      { id: ids[1], name: "b", parentId: ids[0] },
      { id: ids[2], name: "c", parentId: ids[1] },
    ]);
    await expect(
      service.handle(req("folder.create", { name: "d", parentId: ids[2] }), vaultSender),
    ).rejects.toMatchObject({ code: "FOLDER_INVALID" });
  });

  it("deleting a folder removes its subtree and un-files the items inside, deleting none", async () => {
    const { service, updated } = fixture(
      [
        { id: ids[0], name: "a" },
        { id: ids[1], name: "b", parentId: ids[0] },
        { id: ids[2], name: "c" },
      ],
      [
        login("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ids[1]),
        login("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ids[2]),
      ],
    );
    const result = await service.handle(req("folder.delete", { id: ids[0] }), vaultSender);
    expect(result.folders).toEqual([{ id: ids[2], name: "c" }]);
    expect(updated).toHaveLength(1);
    expect(updated[0]).not.toHaveProperty("folderId");
  });

  it("is vault-only", async () => {
    const { service } = fixture();
    await expect(service.handle(req("folder.list"), popupSender)).rejects.toMatchObject({
      code: "FOLDER_INVALID",
    });
  });
});
