import { describe, expect, it, vi } from "vitest";

import { BackupService } from "../../src/background/vault/backup-service";

const sender = {
  extensionId: "extension-id",
  contextKind: "vault" as const,
  senderUrl: "chrome-extension://extension-id/vault/index.html",
  documentId: "vault-document",
};
const challengeId = "0123456789abcdef0123456789abcdef";
const keyEncryptionKey = "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=";
const descriptor = {
  sourceFormat: "v2" as const,
  exportedAt: "2026-08-12T00:00:00.000Z",
  settings: { autoLockMinutes: 15 as const, lockOnScreenLock: true },
  history: { journal: [], tombstones: [] },
};
const emptyPreview = {
  rows: [],
  accepted: 0,
  duplicate: 0,
  conflict: 0,
  rejected: 0,
  settings: "unchanged" as const,
  history: { journalAdded: 0, tombstonesAdded: 0 },
};

function fixture() {
  let milliseconds = 0;
  let identifier = 0;
  let cleanup: (() => void) | undefined;
  const binding = Object.freeze({ marker: "session/root" });
  const sessions = {
    createBackupStepUpChallenge: vi.fn().mockResolvedValue({
      challengeId,
      kdf: {
        algorithm: "argon2id",
        salt: "AAAAAAAAAAAAAAAAAAAAAA==",
        memoryKiB: 65_536,
        iterations: 3,
        parallelism: 1,
      },
      expiresAt: 300_000,
    }),
    authorizeBackupExport: vi.fn().mockResolvedValue(binding),
    captureBackupSession: vi.fn().mockResolvedValue(binding),
    assertBackupSession: vi.fn().mockResolvedValue(undefined),
    readPortableBackupSnapshot: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      exportedAt: "2026-08-12T00:00:00.000Z",
      items: [],
      settings: { autoLockMinutes: 15, lockOnScreenLock: true },
      history: { journal: [], tombstones: [] },
    }),
    previewPortableBackupImport: vi.fn().mockResolvedValue(emptyPreview),
    confirmPortableBackupImport: vi.fn().mockResolvedValue({
      previewChanged: false,
      imported: 0,
      duplicate: 0,
      conflict: 0,
    }),
    onLockOrDispose: vi.fn((callback: () => void) => {
      cleanup = callback;
      return () => {
        if (cleanup === callback) cleanup = undefined;
      };
    }),
  };
  const applyImportedSettings = vi.fn().mockResolvedValue(undefined);
  const service = new BackupService({
    sessions,
    applyImportedSettings,
    now: () => milliseconds,
    nextId: () => `00000000-0000-4000-8000-${(++identifier).toString().padStart(12, "0")}`,
  });
  return {
    service,
    sessions,
    binding,
    applyImportedSettings,
    advance: (amount: number) => (milliseconds += amount),
    lock: () => cleanup?.(),
  };
}

async function authorize(values: ReturnType<typeof fixture>, owner = sender) {
  await values.service.handle({ version: 1, kind: "backup.beginExportStepUp" }, owner);
  const response = await values.service.handle(
    { version: 1, kind: "backup.finishExportStepUp", challengeId, keyEncryptionKey },
    owner,
  );
  if (response.kind !== "backup.exportAuthorized") throw new Error("expected capability");
  return response;
}

async function preview(values: ReturnType<typeof fixture>, owner = sender) {
  const response = await values.service.handle(
    { version: 1, kind: "backup.previewImport", descriptor, items: [] },
    owner,
  );
  if (response.kind !== "backup.importPreview") throw new Error("expected preview");
  return response;
}

describe("BackupService core", () => {
  it("requires current-password verification and clears its owned decoded key", async () => {
    const values = fixture();
    let observed: Uint8Array | undefined;
    values.sessions.authorizeBackupExport.mockImplementation(
      (_challenge: string, key: Uint8Array) => {
        observed = key;
        expect(key).toEqual(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
        return Promise.resolve(values.binding);
      },
    );

    await expect(
      values.service.handle(
        { version: 1, kind: "backup.readPortableSnapshot", capability: crypto.randomUUID() },
        sender,
      ),
    ).rejects.toMatchObject({ code: "BACKUP_EXPIRED" });
    await values.service.handle({ version: 1, kind: "backup.beginExportStepUp" }, sender);
    const authorized = await values.service.handle(
      { version: 1, kind: "backup.finishExportStepUp", challengeId, keyEncryptionKey },
      sender,
    );

    expect(authorized.kind).toBe("backup.exportAuthorized");
    expect(values.sessions.authorizeBackupExport).toHaveBeenCalledWith(
      challengeId,
      expect.any(Uint8Array),
      sender,
    );
    expect(observed).toEqual(new Uint8Array(32));
  });

  it("rejects noncanonical key material before session verification", async () => {
    const values = fixture();
    await expect(
      values.service.handle(
        {
          version: 1,
          kind: "backup.finishExportStepUp",
          challengeId,
          keyEncryptionKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        } as never,
        sender,
      ),
    ).rejects.toMatchObject({ code: "BACKUP_INVALID" });
    expect(values.sessions.authorizeBackupExport).not.toHaveBeenCalled();
  });

  it("reports an authenticated import commit honestly when runtime settings projection fails", async () => {
    const values = fixture();
    values.applyImportedSettings.mockRejectedValueOnce(new Error("synthetic projection failure"));
    const pending = await preview(values);

    await expect(
      values.service.handle(
        { version: 1, kind: "backup.confirmImport", previewToken: pending.previewToken },
        sender,
      ),
    ).resolves.toMatchObject({ kind: "backup.importConfirmed", imported: 0 });
    expect(values.sessions.confirmPortableBackupImport).toHaveBeenCalledTimes(1);
    await expect(
      values.service.handle(
        { version: 1, kind: "backup.confirmImport", previewToken: pending.previewToken },
        sender,
      ),
    ).rejects.toMatchObject({ code: "BACKUP_EXPIRED" });
    expect(values.sessions.confirmPortableBackupImport).toHaveBeenCalledTimes(1);
  });

  it("makes export capabilities random, one-use, five-minute, and sender/session/root bound", async () => {
    const values = fixture();
    const authorized = await authorize(values);
    expect(authorized.expiresAt).toBe(300_000);

    await expect(
      values.service.handle(
        { version: 1, kind: "backup.readPortableSnapshot", capability: authorized.capability },
        { ...sender, documentId: "replacement-document" },
      ),
    ).rejects.toMatchObject({ code: "BACKUP_EXPIRED" });
    await expect(
      values.service.handle(
        { version: 1, kind: "backup.readPortableSnapshot", capability: authorized.capability },
        sender,
      ),
    ).resolves.toMatchObject({ kind: "backup.portableSnapshot" });
    expect(values.sessions.assertBackupSession).toHaveBeenCalledWith(values.binding);
    expect(values.sessions.readPortableBackupSnapshot).toHaveBeenCalledWith(values.binding);
    await expect(
      values.service.handle(
        { version: 1, kind: "backup.readPortableSnapshot", capability: authorized.capability },
        sender,
      ),
    ).rejects.toMatchObject({ code: "BACKUP_EXPIRED" });

    const expired = await authorize(values);
    values.advance(300_001);
    await expect(
      values.service.handle(
        { version: 1, kind: "backup.readPortableSnapshot", capability: expired.capability },
        sender,
      ),
    ).rejects.toMatchObject({ code: "BACKUP_EXPIRED" });
  });

  it("invalidates export capabilities on lock and dispose", async () => {
    const locked = fixture();
    const first = await authorize(locked);
    locked.lock();
    await expect(
      locked.service.handle(
        { version: 1, kind: "backup.readPortableSnapshot", capability: first.capability },
        sender,
      ),
    ).rejects.toMatchObject({ code: "BACKUP_EXPIRED" });

    const disposed = fixture();
    const second = await authorize(disposed);
    disposed.service.dispose();
    disposed.service.dispose();
    await expect(
      disposed.service.handle(
        { version: 1, kind: "backup.readPortableSnapshot", capability: second.capability },
        sender,
      ),
    ).rejects.toMatchObject({ code: "BACKUP_UNAVAILABLE" });
  });

  it("owns preview copies without writes and binds them to sender/session/root", async () => {
    const values = fixture();
    const result = await preview(values);
    expect(values.sessions.captureBackupSession).toHaveBeenCalledTimes(1);
    expect(values.sessions.previewPortableBackupImport).toHaveBeenCalledWith(
      descriptor,
      [],
      values.binding,
    );
    expect(result).toMatchObject({ kind: "backup.importPreview", expiresAt: 300_000 });
    expect(values.sessions).not.toHaveProperty("repository");

    await expect(
      values.service.handle(
        { version: 1, kind: "backup.confirmImport", previewToken: result.previewToken },
        { ...sender, documentId: "replacement-document" },
      ),
    ).rejects.toMatchObject({ code: "BACKUP_EXPIRED" });
    await expect(
      values.service.handle(
        { version: 1, kind: "backup.confirmImport", previewToken: result.previewToken },
        sender,
      ),
    ).resolves.toMatchObject({ kind: "backup.importConfirmed" });
    expect(values.sessions.confirmPortableBackupImport).toHaveBeenCalledWith(
      descriptor,
      [],
      emptyPreview,
      values.binding,
    );
  });

  it("expires previews, cancels without ownership disclosure, and clears on lock/dispose", async () => {
    const values = fixture();
    const expired = await preview(values);
    values.advance(300_001);
    await expect(
      values.service.handle(
        { version: 1, kind: "backup.confirmImport", previewToken: expired.previewToken },
        sender,
      ),
    ).rejects.toMatchObject({ code: "BACKUP_EXPIRED" });

    const cancelled = await preview(values);
    await expect(
      values.service.handle(
        { version: 1, kind: "backup.cancelImport", previewToken: cancelled.previewToken },
        { ...sender, documentId: "replacement-document" },
      ),
    ).resolves.toMatchObject({ kind: "backup.importCancelled", cancelled: true });
    await values.service.handle(
      { version: 1, kind: "backup.cancelImport", previewToken: cancelled.previewToken },
      sender,
    );
    await expect(
      values.service.handle(
        { version: 1, kind: "backup.confirmImport", previewToken: cancelled.previewToken },
        sender,
      ),
    ).rejects.toMatchObject({ code: "BACKUP_EXPIRED" });

    const locked = await preview(values);
    values.lock();
    await expect(
      values.service.handle(
        { version: 1, kind: "backup.confirmImport", previewToken: locked.previewToken },
        sender,
      ),
    ).rejects.toMatchObject({ code: "BACKUP_EXPIRED" });
  });

  it("returns a replacement capability when confirm-time classification changes", async () => {
    const values = fixture();
    values.sessions.confirmPortableBackupImport.mockResolvedValue({
      previewChanged: true,
      preview: {
        rows: [{ ordinal: 1, status: "conflict", reason: "BACKUP_IMPORT_CONFLICT" }],
        accepted: 0,
        duplicate: 0,
        conflict: 1,
        rejected: 0,
        settings: "replace",
        history: { journalAdded: 1, tombstonesAdded: 0 },
      },
    });
    const original = await preview(values);
    const changed = await values.service.handle(
      { version: 1, kind: "backup.confirmImport", previewToken: original.previewToken },
      sender,
    );
    expect(changed).toMatchObject({ kind: "backup.importPreviewChanged", conflict: 1 });
    if (changed.kind !== "backup.importPreviewChanged") throw new Error("expected changed preview");
    expect(changed.previewToken).not.toBe(original.previewToken);
    await expect(
      values.service.handle(
        { version: 1, kind: "backup.confirmImport", previewToken: original.previewToken },
        sender,
      ),
    ).rejects.toMatchObject({ code: "BACKUP_EXPIRED" });
  });

  it("uses identity-safe finalizers so an old confirmation cannot delete its replacement", async () => {
    const values = fixture();
    let resolveConfirm!: (value: unknown) => void;
    values.sessions.confirmPortableBackupImport.mockReturnValue(
      new Promise((resolve) => {
        resolveConfirm = resolve;
      }),
    );
    const original = await preview(values);
    const pending = values.service.handle(
      { version: 1, kind: "backup.confirmImport", previewToken: original.previewToken },
      sender,
    );
    resolveConfirm({ previewChanged: true, preview: emptyPreview });
    const changed = await pending;
    if (changed.kind !== "backup.importPreviewChanged") throw new Error("expected changed preview");
    await expect(
      values.service.handle(
        { version: 1, kind: "backup.cancelImport", previewToken: original.previewToken },
        sender,
      ),
    ).resolves.toMatchObject({ cancelled: true });
    values.sessions.confirmPortableBackupImport.mockResolvedValue({
      previewChanged: false,
      imported: 0,
      duplicate: 0,
      conflict: 0,
    });
    await expect(
      values.service.handle(
        { version: 1, kind: "backup.confirmImport", previewToken: changed.previewToken },
        sender,
      ),
    ).resolves.toMatchObject({ kind: "backup.importConfirmed" });
    expect(values.applyImportedSettings).toHaveBeenCalledOnce();
  });

  it("evicts the oldest fifth preview per document and enforces a global live cap", async () => {
    const values = fixture();
    const own = [];
    for (let index = 0; index < 5; index++) own.push(await preview(values));
    await expect(
      values.service.handle(
        { version: 1, kind: "backup.confirmImport", previewToken: own[0]!.previewToken },
        sender,
      ),
    ).rejects.toMatchObject({ code: "BACKUP_EXPIRED" });

    const global = fixture();
    for (let index = 0; index < 32; index++) {
      await preview(global, { ...sender, documentId: `document-${index}` });
    }
    await expect(
      preview(global, { ...sender, documentId: "document-over-cap" }),
    ).rejects.toMatchObject({ code: "BACKUP_CAPACITY" });
  });

  it("fails closed when session/root validity changes across an awaited operation", async () => {
    const values = fixture();
    values.sessions.assertBackupSession.mockRejectedValueOnce({ code: "VAULT_LOCKED" });
    const authorized = await authorize(values);
    await expect(
      values.service.handle(
        { version: 1, kind: "backup.readPortableSnapshot", capability: authorized.capability },
        sender,
      ),
    ).rejects.toMatchObject({ code: "BACKUP_EXPIRED" });
  });
});
