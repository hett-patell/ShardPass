import "@testing-library/jest-dom/vitest";

import type { Folder } from "@shardpass/domain";
import type { ItemCrudRequest } from "@shardpass/messaging";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  BackupUiExtensionPlatform,
  ExtensionPlatform,
  OtpImportUiExtensionPlatform,
} from "../../src/platform/extension-platform";
import { planFolders } from "../../src/vault/import/folder-plan";
import { ImportDialog } from "../../src/vault/import/ImportDialog";
import { runKeePassImport } from "../../src/vault/keepass/keepass-executor";

vi.mock("../../src/vault/keepass/keepass-executor", () => ({ runKeePassImport: vi.fn() }));

const CHROME_CSV = [
  "name,url,username,password,note",
  "Example Site,https://example.test,alice,s3cret-pass,",
  "Empty Password,https://empty.test,bob,,",
].join("\n");

type Platform = OtpImportUiExtensionPlatform &
  BackupUiExtensionPlatform &
  Pick<ExtensionPlatform, "sendMessage">;

function createPlatform(sendMessage?: (payload: unknown) => Promise<unknown>): {
  platform: Platform;
  createRequests: ItemCrudRequest[];
} {
  const createRequests: ItemCrudRequest[] = [];
  const platform: Platform = {
    extensionId: "vault-test-id",
    onMessage: () => () => undefined,
    openVaultPage: () => Promise.resolve(),
    sendMessage: (payload: unknown) => {
      const request = payload as ItemCrudRequest;
      if (request.kind === "item.create" || request.kind === "item.createMany")
        createRequests.push(structuredClone(request));
      if (sendMessage !== undefined) return sendMessage(payload);
      if (request.kind === "item.createMany") {
        const items = (request as { items: readonly { id: string }[] }).items;
        return Promise.resolve({
          version: 1,
          kind: "item.createManyResult",
          results: items.map((entry, index) => ({ index, status: "created", itemId: entry.id })),
        });
      }
      return Promise.resolve({
        version: 1,
        kind: "item.mutationResult",
        item: (request as { item: unknown }).item,
      });
    },
    sendOtpImportMessage: () =>
      Promise.reject(new Error("sendOtpImportMessage not used in this test")),
    sendBackupMessage: () => Promise.reject(new Error("sendBackupMessage not used in this test")),
  };
  return { platform, createRequests };
}

/** A background stand-in that keeps a folder list and answers folder commands like the real one. */
function folderBackground(initial: readonly Folder[] = []) {
  const folders: Folder[] = [...initial];
  const created: string[] = [];
  const list = () => ({ version: 1, kind: "folder.listResult", folders: [...folders] });
  const answer = (payload: unknown): Promise<unknown> | undefined => {
    const request = payload as { kind: string; name?: string; parentId?: string };
    if (request.kind === "folder.list") return Promise.resolve(list());
    if (request.kind === "folder.create") {
      created.push(request.name ?? "");
      folders.push({
        id: crypto.randomUUID(),
        name: request.name ?? "",
        ...(request.parentId === undefined ? {} : { parentId: request.parentId }),
      });
      return Promise.resolve(list());
    }
    return undefined;
  };
  return { folders, created, answer };
}

function chromeFile(): File {
  return new File([CHROME_CSV], "passwords.csv", { type: "text/csv" });
}

function bitwardenFile(folders: readonly { id: string; name: string }[], items: readonly { name: string; folderId: string | null }[]): File {
  const json = {
    encrypted: false,
    folders,
    items: items.map((item, index) => ({
      id: `item-${index}`,
      type: 1,
      name: item.name,
      folderId: item.folderId,
      login: { username: `user${index}`, password: "pw", uris: [] },
    })),
  };
  return new File([JSON.stringify(json)], "bitwarden.json", { type: "application/json" });
}

/** A stored-only ZIP, enough for a 1PUX fixture: local headers, central directory, end record. */
function storedZip(entries: readonly { name: string; data: string }[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = encoder.encode(entry.data);
    const local = new Uint8Array(30 + name.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    const record = new Uint8Array(46 + name.length);
    const recordView = new DataView(record.buffer);
    recordView.setUint32(0, 0x02014b50, true);
    recordView.setUint32(20, data.length, true);
    recordView.setUint32(24, data.length, true);
    recordView.setUint16(28, name.length, true);
    recordView.setUint32(42, offset, true);
    record.set(name, 46);
    parts.push(local);
    central.push(record);
    offset += local.length;
  }
  const directorySize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of all) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

function onePasswordFile(vaults: readonly { name: string; items: readonly { title: string; sso?: string }[] }[]): File {
  const data = {
    accounts: [
      {
        attrs: { name: "Personal" },
        vaults: vaults.map((vault) => ({
          attrs: { name: vault.name },
          items: vault.items.map((entry, index) => ({
            uuid: `item-${vault.name}-${index}`,
            favIndex: 0,
            createdAt: 1_700_000_000,
            updatedAt: 1_700_000_000,
            state: "active",
            categoryUuid: "001",
            details: {
              loginFields: [
                { value: `user${index}@example.com`, name: "email", fieldType: "E", designation: "username" },
                ...(entry.sso === undefined ? [{ value: "pw", name: "password", fieldType: "P", designation: "password" }] : []),
              ],
              notesPlain: "",
              sections: entry.sso === undefined ? [] : [{ title: "", fields: [{ title: "", id: "sso", value: { sso: entry.sso } }] }],
            },
            overview: { title: entry.title, urls: [{ label: "website", url: "https://example.com" }], tags: [] },
          })),
        })),
      },
    ],
  };
  const bytes = storedZip([
    { name: "export.data", data: JSON.stringify(data) },
    { name: "files/", data: "" },
  ]);
  return new File([bytes], "export.1pux");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ImportDialog", () => {
  it("renders nothing when inactive", () => {
    const { platform } = createPlatform();
    const { container } = render(
      <ImportDialog platform={platform} active={false} onImported={() => undefined} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists every import source, defaulting to Chrome CSV with local instructions", () => {
    const { platform } = createPlatform();
    render(<ImportDialog platform={platform} active onImported={() => undefined} />);

    for (const label of [
      "Chrome CSV",
      "Firefox CSV",
      "Bitwarden JSON",
      "1Password CSV",
      "1Password 1PUX",
      "QR code / otpauth://",
      "ShardPass backup",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeVisible();
    }
    expect(screen.getByRole("button", { name: "Chrome CSV" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByText(/chrome:\/\/password-manager\/settings/i)).toBeVisible();
  });

  it("tells 1Password 8 users that only logins reach the CSV", () => {
    const { platform } = createPlatform();
    render(<ImportDialog platform={platform} active onImported={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "1Password CSV" }));
    expect(screen.getByText(/1Password 8 writes only logins to CSV/u)).toBeVisible();
  });

  it("says an empty file is empty rather than too large", async () => {
    const { platform } = createPlatform();
    render(<ImportDialog platform={platform} active onImported={() => undefined} />);
    const fileInput = screen.getByLabelText("Choose a local Chrome CSV file");
    fireEvent.change(fileInput, { target: { files: [new File([], "empty.csv", { type: "text/csv" })] } });
    expect(await screen.findByText("The file is empty.")).toBeVisible();
  });

  it("parses a Chrome CSV export, previews rows, and imports only the checked ones", async () => {
    const { platform, createRequests } = createPlatform();
    const onImported = vi.fn();
    render(<ImportDialog platform={platform} active onImported={onImported} />);

    const fileInput = screen.getByLabelText("Choose a local Chrome CSV file");
    fireEvent.change(fileInput, { target: { files: [chromeFile()] } });

    await waitFor(() => expect(screen.getByText("Example Site")).toBeVisible());
    expect(screen.getByText("alice")).toBeVisible();
    expect(screen.getByText("1 notice")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Import selected" }));

    await waitFor(() => expect(createRequests).toHaveLength(1));
    expect(createRequests[0]?.kind).toBe("item.createMany");
    const item = (createRequests[0] as { items: { kind: string; name: string }[] }).items[0]!;
    expect(item.kind).toBe("login");
    expect(item.name).toBe("Example Site");
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/1 item imported/i)).toBeVisible());
  });

  it("excludes an unchecked row from the import", async () => {
    const { platform, createRequests } = createPlatform();
    render(<ImportDialog platform={platform} active onImported={() => undefined} />);

    fireEvent.change(screen.getByLabelText("Choose a local Chrome CSV file"), {
      target: { files: [chromeFile()] },
    });
    await waitFor(() => expect(screen.getByText("Example Site")).toBeVisible());

    fireEvent.click(screen.getByRole("checkbox", { name: /Import Example Site/i }));
    fireEvent.click(screen.getByRole("button", { name: "Import selected" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Import selected" })).toBeDisabled(),
    );
    expect(createRequests).toHaveLength(0);
  });

  it("flags a row that repeats an earlier row of the same file", async () => {
    const csv = [
      "name,url,username,password,note",
      "Same,https://same.test,alice,one,",
      "Same,https://same.test,alice,two,",
      "Same,https://same.test,bob,three,",
    ].join("\n");
    const { platform } = createPlatform();
    render(<ImportDialog platform={platform} active onImported={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Choose a local Chrome CSV file"), {
      target: { files: [new File([csv], "dupes.csv", { type: "text/csv" })] },
    });
    await waitFor(() => expect(screen.getAllByText("Same")).toHaveLength(3));
    expect(screen.getAllByText("Duplicate?")).toHaveLength(1);
  });

  it("keeps the sources locked while an import runs, then shows the summary", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { platform } = createPlatform(async (payload) => {
      const request = payload as { kind: string; items?: { id: string }[] };
      await gate;
      return {
        version: 1,
        kind: "item.createManyResult",
        results: (request.items ?? []).map((entry, index) => ({ index, status: "created", itemId: entry.id })),
      };
    });
    render(<ImportDialog platform={platform} active onImported={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Choose a local Chrome CSV file"), {
      target: { files: [chromeFile()] },
    });
    await waitFor(() => expect(screen.getByText("Example Site")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "Import selected" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Firefox CSV" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    release?.();
    await waitFor(() => expect(screen.getByText(/1 item imported/i)).toBeVisible());
    expect(screen.getByRole("button", { name: "Firefox CSV" })).toBeEnabled();
  });

  it("shows how many folders will be created, folds over-deep paths, and files what it cannot", async () => {
    const background = folderBackground();
    const { platform, createRequests } = createPlatform((payload) => {
      const answered = background.answer(payload);
      if (answered !== undefined) return answered;
      const request = payload as { items: { id: string }[] };
      return Promise.resolve({
        version: 1,
        kind: "item.createManyResult",
        results: request.items.map((entry, index) => ({ index, status: "created", itemId: entry.id })),
      });
    });
    const folders = Array.from({ length: 66 }, (_, index) => ({ id: `f${index}`, name: `Folder ${index}` }));
    folders.push({ id: "deep", name: "Work/Clients/Acme/2024" });
    const items = folders.map((folder, index) => ({ name: `Item ${index}`, folderId: folder.id }));
    render(<ImportDialog platform={platform} active onImported={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Bitwarden JSON" }));
    fireEvent.change(screen.getByLabelText("Choose a local Bitwarden JSON file"), {
      target: { files: [bitwardenFile(folders, items)] },
    });

    await waitFor(() => expect(screen.getByText("Item 0")).toBeVisible());
    const summary = await screen.findByText(/64 folders will be created/u);
    expect(summary).toHaveTextContent(/1 nested deeper than 3 levels was folded into its parent's name/u);
    expect(summary).toHaveTextContent(/5 cannot be created: a vault holds at most 64 folders, so 3 items will be imported without a folder/u);

    fireEvent.click(screen.getByRole("button", { name: "Import selected" }));
    await waitFor(() => expect(screen.getByText(/67 items imported/u)).toBeVisible());
    expect(background.created).toHaveLength(64);
    expect(background.created).not.toContain("Acme / 2024");
    expect(screen.getByText(/3 without a folder/u)).toBeVisible();
    expect(screen.getAllByText("Imported without a folder: the vault's folder limit was reached.")).toHaveLength(3);
    const sent = createRequests.flatMap((request) => (request as { items: { folderId?: string }[] }).items);
    expect(sent.filter((item) => item.folderId === undefined)).toHaveLength(3);
  });

  it("reads a 1Password 1PUX archive as bytes, keeps the provider, and files vaults as folders", async () => {
    const background = folderBackground();
    const { platform, createRequests } = createPlatform((payload) => {
      const answered = background.answer(payload);
      if (answered !== undefined) return answered;
      const request = payload as { items: { id: string }[] };
      return Promise.resolve({
        version: 1,
        kind: "item.createManyResult",
        results: request.items.map((entry, index) => ({ index, status: "created", itemId: entry.id })),
      });
    });
    render(<ImportDialog platform={platform} active onImported={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "1Password 1PUX" }));
    expect(screen.getByText(/File → Export → 1PUX/u)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Choose a local 1Password 1PUX file"), {
      target: {
        files: [
          onePasswordFile([
            { name: "Personal", items: [{ title: "Google-backed", sso: "Google" }] },
            { name: "Work", items: [{ title: "Office" }] },
          ]),
        ],
      },
    });

    await waitFor(() => expect(screen.getByText("Google-backed")).toBeVisible());
    expect(screen.getByText("Office")).toBeVisible();
    expect(await screen.findByText(/2 folders will be created/u)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Import selected" }));
    await waitFor(() => expect(screen.getByText(/2 items imported/u)).toBeVisible());
    expect(background.created).toEqual(["Personal", "Work"]);
    const sent = createRequests.flatMap(
      (request) => (request as { items: { name: string; signInWith?: string; password?: string }[] }).items,
    );
    expect(sent.find((entry) => entry.name === "Google-backed")).toMatchObject({ signInWith: "google", password: "" });
    expect(sent.find((entry) => entry.name === "Office")?.signInWith).toBeUndefined();
  });

  it("names the problem when a 1PUX file is not an archive", async () => {
    const { platform } = createPlatform();
    render(<ImportDialog platform={platform} active onImported={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "1Password 1PUX" }));
    fireEvent.change(screen.getByLabelText("Choose a local 1Password 1PUX file"), {
      target: { files: [new File([new Uint8Array([1, 2, 3, 4])], "broken.1pux")] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("This file is not a ZIP archive.");
  });

  it("offers a key file for a KeePass database and hands it to the worker", async () => {
    vi.mocked(runKeePassImport).mockResolvedValue({ items: [], warnings: [], folders: [] });
    const { platform } = createPlatform();
    render(<ImportDialog platform={platform} active onImported={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "KeePass database" }));
    fireEvent.change(screen.getByLabelText("Choose a local KeePass database file"), {
      target: { files: [new File([new Uint8Array([1, 2, 3])], "vault.kdbx")] },
    });

    const open = await screen.findByRole("button", { name: "Open database" });
    expect(open).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Key file (optional)"), {
      target: { files: [new File([new Uint8Array([9, 9])], "vault.keyx")] },
    });
    expect(open).toBeEnabled();
    fireEvent.click(open);

    await waitFor(() => expect(runKeePassImport).toHaveBeenCalledTimes(1));
    const [file, password, keyFile] = vi.mocked(runKeePassImport).mock.calls[0]!;
    expect(new Uint8Array(file)).toEqual(new Uint8Array([1, 2, 3]));
    expect(password).toBe("");
    expect(keyFile === undefined ? undefined : new Uint8Array(keyFile)).toEqual(new Uint8Array([9, 9]));
    expect(await screen.findByText("No importable entries were found in this database.")).toBeVisible();
  });

  it("switches to the existing OTP and ShardPass backup import surfaces", () => {
    const { platform } = createPlatform();
    render(<ImportDialog platform={platform} active onImported={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "QR code / otpauth://" }));
    expect(screen.getByText("Import OTP items")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "ShardPass backup" }));
    expect(screen.getByText("Backup and export")).toBeVisible();
  });
});

describe("planFolders", () => {
  const folder = (id: string, name: string, parentId?: string) => ({ id, name, ...(parentId === undefined ? {} : { parentId }) });

  it("reuses same-named folders under the same parent and creates the rest, parents first", () => {
    const existingWork: Folder = { id: crypto.randomUUID(), name: "work" };
    const plan = planFolders(
      [folder("a", "Work"), folder("b", "Clients", "a"), folder("c", "Home")],
      ["b", "c", "c", undefined],
      [existingWork],
    );
    expect(plan.reused.get(plan.remap.get("b")!)).toBeUndefined();
    expect(plan.creatable.map((entry) => entry.name)).toEqual(["Clients", "Home"]);
    const clients = plan.folders.find((entry) => entry.name === "Clients")!;
    expect(plan.reused.get(clients.parentId!)).toBe(existingWork.id);
    expect(plan.overLimit.size).toBe(0);
    expect(plan.unfiledItems).toBe(0);
  });

  it("folds a path deeper than the vault allows into the deepest allowed level", () => {
    const plan = planFolders(
      [folder("a", "A"), folder("b", "B", "a"), folder("c", "C", "b"), folder("d", "D", "c"), folder("e", "E", "d")],
      ["e", "c"],
      [],
    );
    expect(plan.folders.map((entry) => entry.name)).toEqual(["A", "B", "C / D / E", "C"]);
    expect(plan.collapsed).toBe(1);
    expect(plan.folders.find((entry) => entry.name === "C / D / E")?.folded).toBe(true);
  });

  it("stops creating once the vault would hold more than its limit, blocking children too", () => {
    const existing = Array.from({ length: 63 }, (_, index): Folder => ({ id: crypto.randomUUID(), name: `Old ${index}` }));
    const plan = planFolders(
      [folder("a", "A"), folder("b", "B", "a"), folder("c", "C")],
      ["b", "c"],
      existing,
    );
    expect(plan.creatable.map((entry) => entry.name)).toEqual(["A"]);
    expect(plan.overLimit.size).toBe(2);
    expect(plan.unfiledItems).toBe(2);
  });
});
