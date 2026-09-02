import "@testing-library/jest-dom/vitest";

import type { KdfExecutor } from "@shardpass/crypto";
import type { ImportedPortableBackup, PortableBackupPayload } from "@shardpass/importers";
import type { BackupRequest, BackupResponse } from "@shardpass/messaging";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BackupUiExtensionPlatform } from "../../src/platform/extension-platform";
import { BackupView, type BackupCryptoPort } from "../../src/vault/settings/BackupView";

const capability = "10000000-0000-4000-8000-000000000030";
const previewToken = "10000000-0000-4000-8000-000000000031";
const privateSeed = "JBSWY3DPEHPK3PXP";
const privateLabel = "Private account";
const privateNote = "Private note";
const privateTag = "Private tag";
const payload: PortableBackupPayload = {
  schemaVersion: 1,
  exportedAt: "2026-08-12T00:00:00.000Z",
  items: [
    {
      id: "10000000-0000-4000-8000-000000000032",
      kind: "otp",
      schemaVersion: 1,
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
    },
  ],
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
            {
              ordinal: 1,
              status: "accepted",
              reason: "BACKUP_IMPORT_ACCEPTED",
            },
          ],
          accepted: 1,
          duplicate: 0,
          conflict: 0,
          rejected: 0,
          settings: "unchanged",
          history: { journalAdded: 0, tombstonesAdded: 0 },
          expiresAt: Date.now() + 300_000,
        });
      case "backup.confirmImport":
        return Promise.resolve({
          version: 1,
          kind: "backup.importConfirmed",
          imported: 1,
          duplicate: 0,
          conflict: 0,
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
  };
}

const kdfExecutor: KdfExecutor = {
  derive: vi.fn(() => Promise.resolve(new Uint8Array(32).fill(7))),
};

function fillExportPasswords() {
  fireEvent.change(screen.getByLabelText("Current vault password"), {
    target: { value: "current-private-password" },
  });
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

function assertNoPrivateDom(container: HTMLElement): void {
  const text = container.textContent ?? "";
  expect(text).not.toContain(privateSeed);
  expect(text).not.toContain(privateLabel);
  expect(text).not.toContain(privateNote);
  expect(text).not.toContain(privateTag);
  expect(text).not.toContain("private-name.shardpass");
  expect(container.innerHTML).not.toMatch(/1,2,3,4|9,8,7/u);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("BackupView", () => {
  it("renders only while unlocked with distinct hardened password controls and fixed warnings", async () => {
    const { value } = createPlatform();
    const { container, rerender } = render(
      <BackupView
        platform={value}
        active={false}
        kdfExecutor={kdfExecutor}
        crypto={createCrypto()}
      />,
    );
    expect(screen.queryByRole("region", { name: "Encrypted backups" })).not.toBeInTheDocument();

    rerender(
      <BackupView platform={value} active kdfExecutor={kdfExecutor} crypto={createCrypto()} />,
    );
    expect(screen.getByRole("region", { name: "Encrypted backups" })).toBeVisible();
    for (const label of [
      "Current vault password",
      "Backup password",
      "Confirm backup password",
      "Backup file password",
    ]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("type", "password");
      expect(screen.getByLabelText(label)).toHaveAttribute("autocomplete", "off");
    }
    expect(screen.getByText(/portable backup contains sensitive vault data/i)).toBeVisible();
    expect(screen.getByText(/processed locally/i)).toBeVisible();
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
    unmount();
  });

  it("bounds and clears local file selection, decrypts v2 locally, and sends only strict candidates and descriptor", async () => {
    const { value, snapshots } = createPlatform();
    const cryptoPort = createCrypto();
    const { container } = render(
      <BackupView platform={value} active kdfExecutor={kdfExecutor} crypto={cryptoPort} />,
    );
    const fileInput = screen.getByLabelText<HTMLInputElement>("Choose local backup file");
    const file = localFile();
    fireEvent.change(screen.getByLabelText("Backup file password"), {
      target: { value: "local-private-password" },
    });
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(fileInput).toHaveValue("");
    expect(screen.getByLabelText("Backup file password")).toHaveValue("");

    expect(await screen.findByRole("heading", { name: "Review backup import" })).toBeVisible();
    expect(cryptoPort.importPortableBackup).toHaveBeenCalledTimes(1);
    const request = snapshots.find(({ kind }) => kind === "backup.previewImport");
    expect(request).toMatchObject({
      version: 1,
      kind: "backup.previewImport",
      descriptor: { sourceFormat: "v2" },
      items: payload.items,
    });
    expect(JSON.stringify(snapshots)).not.toContain("local-private-password");
    expect(screen.getByText("1 ready")).toBeVisible();
    assertNoPrivateDom(container);
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
          settings: "replace",
          history: { journalAdded: 0, tombstonesAdded: 0 },
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
          settings: "unchanged",
          history: { journalAdded: 0, tombstonesAdded: 0 },
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
    fireEvent.change(screen.getByLabelText("Backup file password"), {
      target: { value: "local-private-password" },
    });
    fireEvent.change(screen.getByLabelText("Choose local backup file"), {
      target: { files: [localFile()] },
    });
    await screen.findByRole("heading", { name: "Review backup import" });
    expect(cryptoPort.importLegacyBackup).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText("I reviewed this backup summary"));
    fireEvent.click(screen.getByRole("button", { name: "Import backup" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Backup summary changed. Review it again before importing.",
    );
    expect(screen.getByLabelText("I reviewed this backup summary")).not.toBeChecked();
    fireEvent.click(screen.getByLabelText("I reviewed this backup summary"));
    fireEvent.click(screen.getByRole("button", { name: "Import backup" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Backup import complete");
    expect(snapshots.filter(({ kind }) => kind === "backup.confirmImport")).toHaveLength(2);
    assertNoPrivateDom(container);
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
    const password = screen.getByLabelText("Backup file password");
    const file = screen.getByLabelText("Choose local backup file");
    fireEvent.change(password, { target: { value: "first-private-password" } });
    fireEvent.change(file, { target: { files: [localFile(new Uint8Array([1]))] } });
    await waitFor(() => expect(cryptoPort.importPortableBackup).toHaveBeenCalledTimes(1));
    fireEvent.change(password, { target: { value: "second-private-password" } });
    fireEvent.change(file, { target: { files: [localFile(new Uint8Array([2]))] } });
    expect(await screen.findByRole("heading", { name: "Review backup import" })).toBeVisible();
    resolveFirst({ sourceFormat: "v2", payload });
    await Promise.resolve();
    expect(
      sendBackupMessage.mock.calls.filter(([request]) => request.kind === "backup.previewImport"),
    ).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancel import" }));
    expect(screen.queryByRole("heading", { name: "Review backup import" })).not.toBeInTheDocument();
    rerender(
      <BackupView platform={value} active={false} kdfExecutor={kdfExecutor} crypto={cryptoPort} />,
    );
    expect(screen.queryByRole("region", { name: "Encrypted backups" })).not.toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText("Backup file password"), {
      target: { value: "local-private-password" },
    });
    fireEvent.change(screen.getByLabelText("Choose local backup file"), {
      target: { files: [file] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Backup exceeds the safe local limit.",
    );
    expect(read).not.toHaveBeenCalled();
    expect(container).not.toHaveTextContent("private-name.shardpass");
  });
});
