import "@testing-library/jest-dom/vitest";

import type { KdfExecutor } from "@shardpass/crypto";
import type { ImportedPortableBackup, PortableBackupPayloadV2 } from "@shardpass/importers";
import type { BackupRequest, BackupResponse } from "@shardpass/messaging";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BackupUiExtensionPlatform } from "../../src/platform/extension-platform";
import { BackupView, type BackupCryptoPort } from "../../src/vault/settings/BackupView";

const capability = "10000000-0000-4000-8000-000000000030";
const previewToken = "10000000-0000-4000-8000-000000000031";
const folderId = "10000000-0000-4000-8000-000000000033";
const privateSeed = "JBSWY3DPEHPK3PXP";
const privateLabel = "Private account";
const privateNote = "Private note";
const privateTag = "Private tag";
const privatePassword = "private-login-password";
const privateFolder = "Private folder";
const zeroByKind = { otp: 0, login: 0, note: 0, card: 0, identity: 0, secret: 0 };
const payload: PortableBackupPayloadV2 = {
  schemaVersion: 2,
  exportedAt: "2026-08-12T00:00:00.000Z",
  items: [
    {
      id: "10000000-0000-4000-8000-000000000032",
      kind: "otp",
      schemaVersion: 2,
      revision: 1,
      createdAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:00.000Z",
      issuer: "Private issuer",
      label: privateLabel,
      secret: privateSeed,
      otpType: "totp",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      favorite: false,
      tags: [privateTag],
      note: privateNote,
      folderId,
    },
    {
      id: "10000000-0000-4000-8000-000000000034",
      kind: "login",
      schemaVersion: 2,
      revision: 1,
      createdAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:00.000Z",
      favorite: false,
      tags: [],
      name: "Private login",
      username: "private-user",
      password: privatePassword,
      urls: ["https://example.invalid"],
      notes: "",
    },
  ],
  folders: [{ id: folderId, name: privateFolder }],
  settings: { autoLockMinutes: 15, lockOnScreenLock: true },
  history: { journal: [], tombstones: [] },
};

function createPlatform(responder?: (request: BackupRequest) => Promise<BackupResponse>) {
  const snapshots: BackupRequest[] = [];
  const sendBackupMessage = vi.fn(async (request: BackupRequest): Promise<BackupResponse> => {
    snapshots.push(structuredClone(request));
    if (responder !== undefined) return responder(request);
    switch (request.kind) {
      case "backup.beginExportStepUp":
        return Promise.resolve({
          version: 1,
          kind: "backup.exportStepUpChallenge",
          challengeId: "0123456789abcdef0123456789abcdef",
          kdf: {
            algorithm: "argon2id",
            salt: "AAAAAAAAAAAAAAAAAAAAAA==",
            memoryKiB: 8192,
            iterations: 1,
            parallelism: 1,
          },
          expiresAt: Date.now() + 300_000,
        });
      case "backup.finishExportStepUp":
        return Promise.resolve({
          version: 1,
          kind: "backup.exportAuthorized",
          capability,
          expiresAt: Date.now() + 300_000,
        });
      case "backup.readPortableSnapshot":
        return Promise.resolve({
          version: 1,
          kind: "backup.portableSnapshot",
          capability,
          payload,
        });
      case "backup.previewImport":
        return Promise.resolve({
          version: 1,
          kind: "backup.importPreview",
          previewToken,
          rows: [
            { ordinal: 1, status: "accepted", reason: "BACKUP_IMPORT_ACCEPTED" },
            { ordinal: 2, status: "accepted", reason: "BACKUP_IMPORT_ACCEPTED" },
          ],
          accepted: 2,
          duplicate: 0,
          conflict: 0,
          rejected: 0,
          byKind: { ...zeroByKind, otp: 1, login: 1 },
          settings: "unchanged",
          history: { journalAdded: 0, tombstonesAdded: 0 },
          folders: { created: 1, unfiled: 0 },
          expiresAt: Date.now() + 300_000,
        });
      case "backup.confirmImport":
        return Promise.resolve({
          version: 1,
          kind: "backup.importConfirmed",
          imported: 2,
          duplicate: 0,
          conflict: 0,
          byKind: { ...zeroByKind, otp: 1, login: 1 },
          folders: { created: 1, unfiled: 0 },
        });
      case "backup.cancelImport":
        return Promise.resolve({
          version: 1,
          kind: "backup.importCancelled",
          cancelled: true,
        });
    }
  });
  const value: BackupUiExtensionPlatform = {
    extensionId: "vault-test-id",
    onMessage: () => () => undefined,
    sendMessage: () => Promise.resolve(undefined),
    sendBackupMessage,
    openVaultPage: () => Promise.resolve(),
  };
  return { value, snapshots, sendBackupMessage };
}

function createCrypto(): BackupCryptoPort {
  return {
    exportPortableBackup: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3, 4]))),
    importPortableBackup: vi.fn(() =>
      Promise.resolve({ sourceFormat: "v2", payload } satisfies ImportedPortableBackup),
    ),
    importLegacyBackup: vi.fn(() =>
      Promise.resolve({ sourceFormat: "legacy-v1", payload } satisfies ImportedPortableBackup),
    ),
    canonicalPayload: vi.fn(() => new TextEncoder().encode("canonical")),
    encodePlaintextJson: vi.fn(() => new TextEncoder().encode('{"json":true}')),
    encodeLoginsCsv: vi.fn(() => new TextEncoder().encode("name,url\r\n")),
  };
}

const kdfExecutor: KdfExecutor = {
  derive: vi.fn(() => Promise.resolve(new Uint8Array(32).fill(7))),
};

function fillCurrentPassword() {
  fireEvent.change(screen.getByLabelText("Current vault password"), {
    target: { value: "current-private-password" },
  });
}

function fillExportPasswords() {
  fillCurrentPassword();
  fireEvent.change(screen.getByLabelText("Backup password"), {
    target: { value: "backup-private-password" },
  });
  fireEvent.change(screen.getByLabelText("Confirm backup password"), {
    target: { value: "backup-private-password" },
  });
}

function localFile(bytes = new Uint8Array([9, 8, 7]), name = "private-name.shardpass"): File {
  const file = new File([bytes], name, { type: "application/x-shardpass" });
  Object.defineProperty(file, "arrayBuffer", {
    value: vi.fn(() => Promise.resolve(bytes.slice().buffer)),
  });
  return file;
}

/** The restore flow: choose the file first, then type its password and unlock it. */
function chooseFileThenPassword(file = localFile(), password = "local-private-password") {
  const fileInput = screen.getByLabelText<HTMLInputElement>("Choose local backup file");
  fireEvent.change(fileInput, { target: { files: [file] } });
  fireEvent.change(screen.getByLabelText("Backup file password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Unlock backup" }));
  return fileInput;
}

function assertNoPrivateDom(container: HTMLElement): void {
  const text = container.textContent ?? "";
  expect(text).not.toContain(privateSeed);
  expect(text).not.toContain(privateLabel);
  expect(text).not.toContain(privateNote);
  expect(text).not.toContain(privateTag);
  expect(text).not.toContain(privatePassword);
  expect(text).not.toContain(privateFolder);
  expect(text).not.toContain("private-name.shardpass");
  expect(container.innerHTML).not.toMatch(/1,2,3,4|9,8,7/u);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("BackupView", () => {
  it("renders only while unlocked, names the three exports plainly, and hardens every password control", async () => {
    const { value } = createPlatform();
    const { container, rerender } = render(
      <BackupView
        platform={value}
        active={false}
        kdfExecutor={kdfExecutor}
        crypto={createCrypto()}
      />,
    );
    expect(screen.queryByRole("region", { name: "Backup and export" })).not.toBeInTheDocument();

    rerender(
      <BackupView platform={value} active kdfExecutor={kdfExecutor} crypto={createCrypto()} />,
    );
    expect(screen.getByRole("region", { name: "Backup and export" })).toBeVisible();
    for (const label of ["Current vault password", "Backup password", "Confirm backup password"]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("type", "password");
      expect(screen.getByLabelText(label)).toHaveAttribute("autocomplete", "off");
    }
    expect(screen.getByRole("radio", { name: /Encrypted backup.*Recommended/su })).toBeChecked();
    expect(screen.getByRole("radio", { name: /JSON export.*Unencrypted/su })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Logins as CSV.*Unencrypted/su })).not.toBeChecked();
    expect(screen.getByText(/every item, every folder, and your lock settings/iu)).toBeVisible();
    expect(screen.getByText(/secrets included, in plain text/iu)).toBeVisible();
    expect(screen.getByText(/name, URL, username, password, notes, one-time code/iu)).toBeVisible();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.getByText(/holds the secrets in this vault/iu)).toBeVisible();
    expect(screen.getByText(/happen locally/iu)).toBeVisible();
    // The restore side asks for the file first; the password field appears once one is chosen.
    expect(screen.getByRole("button", { name: /Choose backup file/u })).toBeVisible();
    expect(screen.queryByLabelText("Backup file password")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Choose local backup file"), {
      target: { files: [localFile()] },
    });
    expect(screen.getByLabelText("Backup file password")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Backup file password")).toHaveAttribute("autocomplete", "off");
    expect(screen.getByRole("button", { name: /Backup file chosen/u })).toBeVisible();
    assertNoPrivateDom(container);
    const results = await axe.run(container, {
      resultTypes: ["violations"],
      rules: { "color-contrast": { enabled: false } },
    });
    expect(
      results.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
    ).toEqual([]);
  });

  it("derives only local proof, clears raw passwords synchronously, self-verifies, then offers a direct download link", async () => {
    const { value, snapshots } = createPlatform();
    const cryptoPort = createCrypto();
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:verified-backup");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const { container, unmount } = render(
      <BackupView platform={value} active kdfExecutor={kdfExecutor} crypto={cryptoPort} />,
    );
    fillExportPasswords();

    fireEvent.click(screen.getByRole("button", { name: "Prepare encrypted backup" }));
    expect(screen.getByLabelText("Current vault password")).toHaveValue("");
    expect(screen.getByLabelText("Backup password")).toHaveValue("");
    expect(screen.getByLabelText("Confirm backup password")).toHaveValue("");
    expect(createObjectURL).not.toHaveBeenCalled();

    const link = await screen.findByRole("link", { name: "Download verified backup" });
    expect(link).toHaveAttribute("href", "blob:verified-backup");
    expect(link).toHaveAttribute("download", "shardpass-backup.shardpass");
    expect(cryptoPort.exportPortableBackup).toHaveBeenCalledTimes(1);
    expect(cryptoPort.importPortableBackup).toHaveBeenCalledTimes(1);
    expect(cryptoPort.canonicalPayload).toHaveBeenCalledTimes(2);
    expect(cryptoPort.encodePlaintextJson).not.toHaveBeenCalled();
    expect(cryptoPort.encodeLoginsCsv).not.toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(snapshots.map(({ kind }) => kind)).toEqual([
      "backup.beginExportStepUp",
      "backup.finishExportStepUp",
      "backup.readPortableSnapshot",
    ]);
    expect(JSON.stringify(snapshots)).not.toMatch(
      /current-private-password|backup-private-password/u,
    );
    expect(snapshots[1]).toMatchObject({ kind: "backup.finishExportStepUp" });
    assertNoPrivateDom(container);

    fireEvent.click(link);
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:verified-backup"));
    expect(screen.getByRole("status")).toHaveTextContent("Backup download started.");
    unmount();
  });

  it.each([
    {
      choice: /JSON export/u,
      prepare: "Prepare JSON export",
      link: "Download JSON export",
      fileName: "shardpass-export.json",
      encoder: "encodePlaintextJson" as const,
      other: "encodeLoginsCsv" as const,
    },
    {
      choice: /Logins as CSV/u,
      prepare: "Prepare CSV export",
      link: "Download CSV export",
      fileName: "shardpass-logins.csv",
      encoder: "encodeLoginsCsv" as const,
      other: "encodePlaintextJson" as const,
    },
  ])(
    "requires the same step-up for $prepare, warns that the file is unencrypted, and downloads $fileName",
    async ({ choice, prepare, link, fileName, encoder, other }) => {
      const { value, snapshots } = createPlatform();
      const cryptoPort = createCrypto();
      const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:plain");
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
      const { container } = render(
        <BackupView platform={value} active kdfExecutor={kdfExecutor} crypto={cryptoPort} />,
      );
      fireEvent.click(screen.getByRole("radio", { name: choice }));
      expect(screen.getByRole("note")).toHaveTextContent(/not encrypted/iu);
      expect(screen.getByRole("note")).toHaveTextContent(/delete it/iu);
      expect(screen.queryByLabelText("Backup password")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Confirm backup password")).not.toBeInTheDocument();

      // Without the current vault password nothing leaves the page.
      fireEvent.click(screen.getByRole("button", { name: prepare }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Enter your current vault password.",
      );
      expect(snapshots).toHaveLength(0);

      fillCurrentPassword();
      fireEvent.click(screen.getByRole("button", { name: prepare }));
      expect(screen.getByLabelText("Current vault password")).toHaveValue("");
      const download = await screen.findByRole("link", { name: link });
      expect(download).toHaveAttribute("href", "blob:plain");
      expect(download).toHaveAttribute("download", fileName);
      expect(snapshots.map(({ kind }) => kind)).toEqual([
        "backup.beginExportStepUp",
        "backup.finishExportStepUp",
        "backup.readPortableSnapshot",
      ]);
      expect(JSON.stringify(snapshots)).not.toContain("current-private-password");
      expect(cryptoPort[encoder]).toHaveBeenCalledTimes(1);
      expect(cryptoPort[encoder]).toHaveBeenCalledWith(payload);
      expect(cryptoPort[other]).not.toHaveBeenCalled();
      expect(cryptoPort.exportPortableBackup).not.toHaveBeenCalled();
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("status")).toHaveTextContent(/not encrypted/iu);
      assertNoPrivateDom(container);
    },
  );

  it("asks for the file first and the password second, clears both, decrypts locally, and sends strict candidates, folders, and descriptor", async () => {
    const { value, snapshots } = createPlatform();
    const cryptoPort = createCrypto();
    const { container } = render(
      <BackupView platform={value} active kdfExecutor={kdfExecutor} crypto={cryptoPort} />,
    );
    const fileInput = screen.getByLabelText<HTMLInputElement>("Choose local backup file");
    const file = localFile();
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(fileInput).toHaveValue("");
    expect(cryptoPort.importPortableBackup).not.toHaveBeenCalled();
    assertNoPrivateDom(container);

    // An empty password keeps the chosen file and says so.
    fireEvent.click(screen.getByRole("button", { name: "Unlock backup" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter the password for this backup file.",
    );
    expect(screen.getByRole("button", { name: /Backup file chosen/u })).toBeVisible();

    fireEvent.change(screen.getByLabelText("Backup file password"), {
      target: { value: "local-private-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock backup" }));
    expect(screen.getByLabelText("Backup file password")).toHaveValue("");

    expect(await screen.findByRole("heading", { name: "Review backup import" })).toBeVisible();
    expect(cryptoPort.importPortableBackup).toHaveBeenCalledTimes(1);
    const request = snapshots.find(({ kind }) => kind === "backup.previewImport");
    expect(request).toMatchObject({
      version: 1,
      kind: "backup.previewImport",
      descriptor: { sourceFormat: "v2", folders: payload.folders },
      items: payload.items,
    });
    expect(JSON.stringify(snapshots)).not.toContain("local-private-password");
    expect(screen.getByText("2 ready")).toBeVisible();
    expect(screen.getByText(/Ready to add: 1 login, 1 one-time code\./u)).toBeVisible();
    expect(screen.getByText(/Folders: 1 folder to create\./u)).toBeVisible();
    assertNoPrivateDom(container);
  });

  it("keeps the chosen file when the password is wrong so it can be typed again", async () => {
    const { value } = createPlatform();
    const cryptoPort = createCrypto();
    vi.mocked(cryptoPort.importPortableBackup).mockRejectedValueOnce(new Error("not v2"));
    vi.mocked(cryptoPort.importLegacyBackup).mockRejectedValueOnce(new Error("not legacy"));
    render(<BackupView platform={value} active kdfExecutor={kdfExecutor} crypto={cryptoPort} />);
    chooseFileThenPassword(localFile(), "wrong-private-password");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Backup could not be processed safely.",
    );
    expect(screen.getByRole("button", { name: /Backup file chosen/u })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Backup file password"), {
      target: { value: "right-private-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock backup" }));
    expect(await screen.findByRole("heading", { name: "Review backup import" })).toBeVisible();
    expect(cryptoPort.importPortableBackup).toHaveBeenCalledTimes(2);
  });

  it("supports legacy input, changed-preview reconfirmation, confirm, and cancel without exposing rows", async () => {
    let confirmCount = 0;
    const { value, snapshots } = createPlatform((request) => {
      if (request.kind === "backup.previewImport") {
        return Promise.resolve({
          version: 1,
          kind: "backup.importPreview",
          previewToken,
          rows: [{ ordinal: 1, status: "accepted", reason: "BACKUP_IMPORT_ACCEPTED" }],
          accepted: 1,
          duplicate: 0,
          conflict: 0,
          rejected: 0,
          byKind: { ...zeroByKind, otp: 1 },
          settings: "replace",
          history: { journalAdded: 0, tombstonesAdded: 0 },
          folders: { created: 0, unfiled: 1 },
          expiresAt: Date.now() + 300_000,
        });
      }
      if (request.kind === "backup.confirmImport" && confirmCount++ === 0) {
        return Promise.resolve({
          version: 1,
          kind: "backup.importPreviewChanged",
          previewToken,
          rows: [{ ordinal: 1, status: "duplicate", reason: "BACKUP_IMPORT_DUPLICATE" }],
          accepted: 0,
          duplicate: 1,
          conflict: 0,
          rejected: 0,
          byKind: zeroByKind,
          settings: "unchanged",
          history: { journalAdded: 0, tombstonesAdded: 0 },
          folders: { created: 0, unfiled: 0 },
          expiresAt: Date.now() + 300_000,
        });
      }
      if (request.kind === "backup.confirmImport") {
        return Promise.resolve({
          version: 1,
          kind: "backup.importConfirmed",
          imported: 0,
          duplicate: 1,
          conflict: 0,
          byKind: zeroByKind,
          folders: { created: 0, unfiled: 0 },
        });
      }
      if (request.kind === "backup.cancelImport") {
        return Promise.resolve({ version: 1, kind: "backup.importCancelled", cancelled: true });
      }
      throw new Error("unused");
    });
    const cryptoPort = createCrypto();
    vi.mocked(cryptoPort.importPortableBackup).mockRejectedValueOnce(new Error("not v2"));
    const { container } = render(
      <BackupView platform={value} active kdfExecutor={kdfExecutor} crypto={cryptoPort} />,
    );
    chooseFileThenPassword();
    await screen.findByRole("heading", { name: "Review backup import" });
    expect(cryptoPort.importLegacyBackup).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/1 item will be left out of a folder/u)).toBeVisible();

    fireEvent.click(screen.getByLabelText("I reviewed this backup summary"));
    fireEvent.click(screen.getByRole("button", { name: "Import backup" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Backup summary changed. Review it again before importing.",
    );
    expect(screen.getByLabelText("I reviewed this backup summary")).not.toBeChecked();
    fireEvent.click(screen.getByLabelText("I reviewed this backup summary"));
    fireEvent.click(screen.getByRole("button", { name: "Import backup" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Backup import complete");
    expect(screen.getByText(/Added nothing, as one vault generation\./u)).toBeVisible();
    expect(snapshots.filter(({ kind }) => kind === "backup.confirmImport")).toHaveLength(2);
    assertNoPrivateDom(container);
  });

  it("reports what a completed restore added, per kind, and the folders it created", async () => {
    const { value } = createPlatform();
    const onImported = vi.fn();
    render(
      <BackupView
        platform={value}
        active
        kdfExecutor={kdfExecutor}
        crypto={createCrypto()}
        onImported={onImported}
      />,
    );
    chooseFileThenPassword();
    await screen.findByRole("heading", { name: "Review backup import" });
    fireEvent.click(screen.getByLabelText("I reviewed this backup summary"));
    fireEvent.click(screen.getByRole("button", { name: "Import backup" }));
    expect(await screen.findByRole("status")).toHaveTextContent("2 imported");
    expect(
      screen.getByText(/Added 1 login, 1 one-time code and created 1 folder, as one vault generation\./u),
    ).toBeVisible();
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it("cancels owned work on replacement, lock, cancel, and unmount and suppresses stale results", async () => {
    let resolveFirst!: (value: ImportedPortableBackup) => void;
    const first = new Promise<ImportedPortableBackup>((resolve) => (resolveFirst = resolve));
    const cryptoPort = createCrypto();
    vi.mocked(cryptoPort.importPortableBackup)
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({ sourceFormat: "v2", payload });
    const { value, sendBackupMessage } = createPlatform();
    const { rerender, unmount } = render(
      <BackupView platform={value} active kdfExecutor={kdfExecutor} crypto={cryptoPort} />,
    );
    chooseFileThenPassword(localFile(new Uint8Array([1])), "first-private-password");
    await waitFor(() => expect(cryptoPort.importPortableBackup).toHaveBeenCalledTimes(1));
    chooseFileThenPassword(localFile(new Uint8Array([2])), "second-private-password");
    expect(await screen.findByRole("heading", { name: "Review backup import" })).toBeVisible();
    resolveFirst({ sourceFormat: "v2", payload });
    await Promise.resolve();
    expect(
      sendBackupMessage.mock.calls.filter(([request]) => request.kind === "backup.previewImport"),
    ).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancel import" }));
    expect(screen.queryByRole("heading", { name: "Review backup import" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Choose backup file/u })).toBeVisible();
    rerender(
      <BackupView platform={value} active={false} kdfExecutor={kdfExecutor} crypto={cryptoPort} />,
    );
    expect(screen.queryByRole("region", { name: "Backup and export" })).not.toBeInTheDocument();
    unmount();
  });

  it("rejects oversized files before reading and uses fixed non-reflective errors", async () => {
    const { value } = createPlatform();
    const { container } = render(
      <BackupView platform={value} active kdfExecutor={kdfExecutor} crypto={createCrypto()} />,
    );
    const file = localFile();
    Object.defineProperty(file, "size", { value: 9_000_000 });
    const read = vi.spyOn(file, "arrayBuffer");
    fireEvent.change(screen.getByLabelText("Choose local backup file"), {
      target: { files: [file] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Backup exceeds the safe local limit.",
    );
    expect(read).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Backup file password")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent("private-name.shardpass");
  });
});
