import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LegacyEnvelopeSchema, deriveLegacyVaultKey } from "@shardpass/importers/legacy-v1";
import type { BackupResponse, OtpResponse } from "@shardpass/messaging";
import { ACTIVE_ROOT_KEY, generationKeys, type StorageValue } from "@shardpass/storage";
import { FakeExtensionPlatform } from "@shardpass/testing";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/platform/chrome-platform", () => ({
  createChromePlatform: () => new FakeExtensionPlatform("background-entry-test-id"),
}));

import {
  installBackground,
  shouldPublishOtpState,
  shouldRefreshBackupState,
} from "../../src/background/main";

const extensionId = "runtime-migration-extension";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const keyEncryptionKey = Buffer.from(
  Uint8Array.from({ length: 32 }, (_, index) => index + 1),
).toString("base64");
const vaultSender = {
  extensionId,
  senderUrl: `chrome-extension://${extensionId}/vault/index.html`,
  documentId: "full-vault-document",
};
const popupSender = {
  extensionId,
  senderUrl: `chrome-extension://${extensionId}/popup/index.html`,
  documentId: "popup-document",
};
const unauthorized = {
  version: 1,
  kind: "error",
  error: { code: "UNAUTHORIZED_SENDER", message: "This action is not allowed here." },
};

type LegacyFixture = Readonly<{
  testOnlyPassword: string;
  vault: StorageValue;
}>;

async function legacyFixture(): Promise<LegacyFixture> {
  return JSON.parse(
    await readFile(path.join(root, "tests/fixtures/legacy/vault-standard.json"), "utf8"),
  ) as LegacyFixture;
}

async function setupVault(platform: FakeExtensionPlatform) {
  const challenge = (await platform.dispatchMessage(
    { version: 1, kind: "vault.getKdfChallenge", purpose: "setup" },
    vaultSender,
  )) as { challengeId: string };
  await expect(
    platform.dispatchMessage(
      {
        version: 1,
        kind: "vault.setup",
        challengeId: challenge.challengeId,
        keyEncryptionKey,
      },
      vaultSender,
    ),
  ).resolves.toMatchObject({ kind: "vault.ok", state: "unlocked" });
}

async function unlockVault(platform: FakeExtensionPlatform) {
  const challenge = (await platform.dispatchMessage(
    { version: 1, kind: "vault.getKdfChallenge", purpose: "unlock" },
    vaultSender,
  )) as { challengeId: string };
  await platform.dispatchMessage(
    {
      version: 1,
      kind: "vault.unlock",
      challengeId: challenge.challengeId,
      keyEncryptionKey,
    },
    vaultSender,
  );
}

async function authorizeLegacyKey(platform: FakeExtensionPlatform, fixture: LegacyFixture) {
  const challenge = (await platform.dispatchMessage(
    { version: 1, kind: "migration.getCredentialChallenge" },
    vaultSender,
  )) as { challengeId: string };
  const derivedKey = await deriveLegacyVaultKey(
    LegacyEnvelopeSchema.parse(fixture.vault),
    fixture.testOnlyPassword,
  );
  const authorization = (await platform.dispatchMessage(
    {
      version: 1,
      kind: "migration.authorizeCredential",
      challengeId: challenge.challengeId,
      derivedKey: Buffer.from(derivedKey).toString("base64"),
    },
    vaultSender,
  )) as { credentialToken: string };
  derivedKey.fill(0);
  return authorization.credentialToken;
}

describe("installed background migration runtime", () => {
  it("drives the Ente alarm from persisted connection and live vault lock state", async () => {
    const platform = new FakeExtensionPlatform(extensionId);
    const dispose = installBackground(platform);
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    await setupVault(platform);
    await settle();
    // A fresh worker clears whatever periodic alarm an earlier instance left, exactly once.
    expect(platform.enteSyncSchedules).toEqual([null]);

    await expect(
      platform.dispatchMessage(
        {
          version: 1,
          kind: "ente.connect",
          capability: "a".repeat(64),
          ciphertext: Array.from({ length: 49 }, () => 0),
        },
        vaultSender,
      ),
    ).resolves.toMatchObject({ kind: "error" });
    await settle();
    expect(platform.enteSyncSchedules).toEqual([null]);

    await platform.dispatchMessage({ version: 1, kind: "vault.lock" }, vaultSender);
    await settle();
    expect(platform.enteSyncSchedules).toEqual([null]);
    platform.triggerEnteSyncAlarm();
    await settle();

    await unlockVault(platform);
    await settle();
    expect(platform.enteSyncSchedules).toEqual([null]);
    await platform.dispatchMessage(
      {
        version: 1,
        kind: "ente.disconnectConfirm",
      },
      vaultSender,
    );
    await settle();
    expect(platform.enteSyncSchedules).toEqual([null]);
    dispose();
  });
  it("constructs one backup service, injects current settings, publishes committed imports, and clears on lock/dispose", async () => {
    const platform = new FakeExtensionPlatform(extensionId);
    const dispose = installBackground(platform);
    await setupVault(platform);
    await platform.dispatchMessage(
      {
        version: 1,
        kind: "vault.updateLockSettings",
        autoLockMinutes: 30,
        lockOnScreenLock: false,
      },
      vaultSender,
    );
    const states: unknown[] = [];
    const disconnect = platform.connectBackgroundPort(vaultSender, (state) => states.push(state));
    await vi.waitFor(() => expect(states.at(-1)).toMatchObject({ state: "unlocked" }));

    const challenge = (await platform.dispatchMessage(
      { version: 1, kind: "backup.beginExportStepUp" },
      vaultSender,
    )) as Extract<BackupResponse, { kind: "backup.exportStepUpChallenge" }>;
    const authorization = (await platform.dispatchMessage(
      {
        version: 1,
        kind: "backup.finishExportStepUp",
        challengeId: challenge.challengeId,
        keyEncryptionKey,
      },
      vaultSender,
    )) as Extract<BackupResponse, { kind: "backup.exportAuthorized" }>;
    const snapshot = (await platform.dispatchMessage(
      {
        version: 1,
        kind: "backup.readPortableSnapshot",
        capability: authorization.capability,
      },
      vaultSender,
    )) as Extract<BackupResponse, { kind: "backup.portableSnapshot" }>;
    expect(snapshot.payload.settings).toEqual({ autoLockMinutes: 30, lockOnScreenLock: false });

    const preview = (await platform.dispatchMessage(
      {
        version: 1,
        kind: "backup.previewImport",
        descriptor: {
          sourceFormat: "v2",
          exportedAt: "2026-08-12T00:00:00.000Z",
          settings: { autoLockMinutes: 5, lockOnScreenLock: true },
          history: { journal: [], tombstones: [] },
        },
        items: [],
      },
      vaultSender,
    )) as Extract<BackupResponse, { kind: "backup.importPreview" }>;
    const beforeConfirm = states.length;
    const originalSet = platform.localStorage.set.bind(platform.localStorage);
    let rejectedProjection = false;
    platform.localStorage.set = (values) => {
      if (!rejectedProjection && "shardpass:v1:lock-settings" in values) {
        rejectedProjection = true;
        return Promise.reject(new Error("synthetic post-activation projection failure"));
      }
      return originalSet(values);
    };
    await expect(
      platform.dispatchMessage(
        { version: 1, kind: "backup.confirmImport", previewToken: preview.previewToken },
        vaultSender,
      ),
    ).resolves.toMatchObject({ kind: "backup.importConfirmed" });
    await vi.waitFor(() => expect(states.length).toBe(beforeConfirm + 1));
    expect(rejectedProjection).toBe(true);
    platform.localStorage.set = originalSet;
    expect(platform.autoLockMinutes).toBe(30);
    dispose();
    const restartedDispose = installBackground(platform);
    const unlockChallenge = (await platform.dispatchMessage(
      { version: 1, kind: "vault.getKdfChallenge", purpose: "unlock" },
      vaultSender,
    )) as { challengeId: string };
    await expect(
      platform.dispatchMessage(
        {
          version: 1,
          kind: "vault.unlock",
          challengeId: unlockChallenge.challengeId,
          keyEncryptionKey,
        },
        vaultSender,
      ),
    ).resolves.toMatchObject({ kind: "vault.ok", state: "unlocked" });
    expect(platform.autoLockMinutes).toBe(5);
    await platform.dispatchMessage(
      {
        version: 1,
        kind: "vault.updateLockSettings",
        autoLockMinutes: 60,
        lockOnScreenLock: false,
      },
      vaultSender,
    );
    expect(platform.autoLockMinutes).toBe(60);
    const importedSnapshot = (await platform.dispatchMessage(
      {
        version: 1,
        kind: "backup.readPortableSnapshot",
        capability: (
          (await platform.dispatchMessage(
            {
              version: 1,
              kind: "backup.finishExportStepUp",
              challengeId: (
                (await platform.dispatchMessage(
                  { version: 1, kind: "backup.beginExportStepUp" },
                  vaultSender,
                )) as Extract<BackupResponse, { kind: "backup.exportStepUpChallenge" }>
              ).challengeId,
              keyEncryptionKey,
            },
            vaultSender,
          )) as Extract<BackupResponse, { kind: "backup.exportAuthorized" }>
        ).capability,
      },
      vaultSender,
    )) as Extract<BackupResponse, { kind: "backup.portableSnapshot" }>;
    expect(importedSnapshot.payload.settings).toEqual({
      autoLockMinutes: 60,
      lockOnScreenLock: false,
    });

    const pending = (await platform.dispatchMessage(
      {
        version: 1,
        kind: "backup.previewImport",
        descriptor: {
          sourceFormat: "v2",
          exportedAt: "2026-08-12T00:00:00.000Z",
          settings: { autoLockMinutes: 5, lockOnScreenLock: true },
          history: { journal: [], tombstones: [] },
        },
        items: [],
      },
      vaultSender,
    )) as Extract<BackupResponse, { kind: "backup.importPreview" }>;
    await platform.dispatchMessage({ version: 1, kind: "vault.lock" }, vaultSender);
    await expect(
      platform.dispatchMessage(
        { version: 1, kind: "backup.confirmImport", previewToken: pending.previewToken },
        vaultSender,
      ),
    ).resolves.toMatchObject({ kind: "error", error: { code: "BACKUP_EXPIRED" } });

    restartedDispose();
    restartedDispose();
    disconnect();
    expect(platform.listenerCount).toBe(0);
  });

  it("publishes backup state only after commit or lock-relevant failures", () => {
    expect(
      shouldRefreshBackupState({
        version: 1,
        kind: "error",
        error: { code: "BACKUP_EXPIRED", message: "fixed" },
      }),
    ).toBe(true);
    for (const code of [
      "BACKUP_UNAVAILABLE",
      "BACKUP_INVALID",
      "BACKUP_AUTH_FAILED",
      "BACKUP_CHANGED",
      "BACKUP_CAPACITY",
      "UNEXPECTED",
    ] as const)
      expect(
        shouldRefreshBackupState({ version: 1, kind: "error", error: { code, message: "fixed" } }),
      ).toBe(false);
  });

  it("publishes only command-matched OTP mutations and effective cancellation", () => {
    const itemId = "01234567-89ab-4def-8123-456789abcdef";
    const reservationId = "fedcba98-7654-4abc-9234-fedcba987654";
    const mutation: OtpResponse = {
      version: 1,
      kind: "otp.mutationResult",
      item: {
        id: itemId,
        revision: 1,
        issuer: "Example",
        label: "Account",
        otpType: "totp",
        favorite: false,
        tags: [],
      },
    };
    expect(
      shouldPublishOtpState({ version: 1, kind: "otp.create", input: {} } as never, mutation),
    ).toBe(true);
    expect(
      shouldPublishOtpState({ version: 1, kind: "otp.create", input: {} } as never, {
        version: 1,
        kind: "otp.hotpCommitted",
        reservationId,
        revision: 2,
        counter: 1,
      }),
    ).toBe(false);
    expect(
      shouldPublishOtpState({ version: 1, kind: "otp.commitHotp", reservationId }, mutation),
    ).toBe(false);
    expect(
      shouldPublishOtpState(
        { version: 1, kind: "otp.cancelHotp", reservationId },
        { version: 1, kind: "otp.hotpCancelled", reservationId, cancelled: false },
      ),
    ).toBe(false);
    expect(
      shouldPublishOtpState(
        { version: 1, kind: "otp.cancelHotp", reservationId },
        { version: 1, kind: "otp.hotpCancelled", reservationId, cancelled: true },
      ),
    ).toBe(true);
  });

  it("publishes authoritative redaction to a second trusted page after OTP root authentication fails", async () => {
    const platform = new FakeExtensionPlatform(extensionId);
    const dispose = installBackground(platform);
    const pageAStates: unknown[] = [];
    const pageBStates: unknown[] = [];
    const disconnectA = platform.connectBackgroundPort(vaultSender, (state) =>
      pageAStates.push(state),
    );
    const disconnectB = platform.connectBackgroundPort(
      { ...vaultSender, documentId: "second-vault-document" },
      (state) => pageBStates.push(state),
    );
    await setupVault(platform);
    await vi.waitFor(() => {
      expect(pageAStates.at(-1)).toMatchObject({ kind: "vault.state", state: "unlocked" });
      expect(pageBStates.at(-1)).toMatchObject({ kind: "vault.state", state: "unlocked" });
    });

    const root = (await platform.localStorage.get([ACTIVE_ROOT_KEY]))[ACTIVE_ROOT_KEY] as {
      activeGenerationId: string;
    };
    await platform.localStorage.remove([generationKeys(root.activeGenerationId).verified]);
    const publicationsBeforeFailure = pageBStates.length;

    await expect(
      platform.dispatchMessage({ version: 1, kind: "otp.list", query: "" }, popupSender),
    ).resolves.toMatchObject({ kind: "error", error: { code: "VAULT_UNAVAILABLE" } });
    await vi.waitFor(() => {
      expect(pageBStates.length).toBeGreaterThan(publicationsBeforeFailure);
      expect(pageBStates.at(-1)).toMatchObject({ kind: "vault.state", state: "locked" });
    });

    disconnectA();
    disconnectB();
    dispose();
  });

  it("owns one live migration lifecycle with exact sender policy, cleanup, and state publication", async () => {
    const fixture = await legacyFixture();
    const platform = new FakeExtensionPlatform(extensionId);
    await platform.localStorage.set({
      vault: fixture.vault,
      settings: { autoLockMinutes: 7, lockOnScreenLock: false },
    });
    const legacyBefore = await platform.localStorage.get(["vault", "settings"]);
    const states: unknown[] = [];
    const dispose = installBackground(platform);
    const disconnect = platform.connectBackgroundPort(vaultSender, (state) => states.push(state));

    await setupVault(platform);
    await vi.waitFor(() => expect(states.length).toBeGreaterThan(0));

    await expect(
      platform.dispatchMessage({ version: 1, kind: "migration.inspect" }, vaultSender),
    ).resolves.toEqual({
      version: 1,
      kind: "migration.status",
      available: true,
      phase: "none",
      itemCount: 0,
    });

    for (const denied of [
      popupSender,
      {
        extensionId,
        senderUrl: "https://example.test/login",
        documentId: "content-document",
        tabId: 7,
        frameId: 0,
      },
      { ...vaultSender, senderUrl: `chrome-extension://${extensionId}/popup/index.html` },
    ])
      await expect(
        platform.dispatchMessage({ version: 1, kind: "migration.inspect" }, denied),
      ).resolves.toEqual(unauthorized);

    const invalidatedChallenge = (await platform.dispatchMessage(
      { version: 1, kind: "migration.getCredentialChallenge" },
      vaultSender,
    )) as { challengeId: string };
    await platform.dispatchMessage({ version: 1, kind: "vault.lock" }, vaultSender);
    await expect(
      platform.dispatchMessage(
        {
          version: 1,
          kind: "migration.authorizeCredential",
          challengeId: invalidatedChallenge.challengeId,
          derivedKey: Buffer.alloc(32).toString("base64"),
        },
        vaultSender,
      ),
    ).resolves.toMatchObject({ kind: "error", error: { code: "VAULT_UNAVAILABLE" } });

    await unlockVault(platform);
    const invalidatedToken = await authorizeLegacyKey(platform, fixture);
    await platform.dispatchMessage({ version: 1, kind: "vault.lock" }, vaultSender);
    await expect(
      platform.dispatchMessage(
        { version: 1, kind: "migration.start", credentialToken: invalidatedToken },
        vaultSender,
      ),
    ).resolves.toMatchObject({ kind: "error", error: { code: "VAULT_UNAVAILABLE" } });

    await unlockVault(platform);
    const credentialToken = await authorizeLegacyKey(platform, fixture);
    await expect(
      platform.dispatchMessage(
        { version: 1, kind: "migration.start", credentialToken },
        vaultSender,
      ),
    ).resolves.toMatchObject({ kind: "migration.status", phase: "staged" });
    await expect(
      platform.dispatchMessage({ version: 1, kind: "migration.verify" }, vaultSender),
    ).resolves.toMatchObject({ kind: "migration.status", phase: "verified" });

    const statesBeforeActivation = states.length;
    const rootWritesBeforeActivation = platform.localStorage.writes.filter((write) =>
      write.keys.includes(ACTIVE_ROOT_KEY),
    ).length;
    await expect(
      platform.dispatchMessage({ version: 1, kind: "migration.activate" }, vaultSender),
    ).resolves.toMatchObject({ kind: "migration.status", phase: "completed" });
    await vi.waitFor(() => expect(states.length).toBeGreaterThan(statesBeforeActivation));
    const rootWritesAfterActivation = platform.localStorage.writes.filter((write) =>
      write.keys.includes(ACTIVE_ROOT_KEY),
    ).length;
    expect(rootWritesAfterActivation).toBe(rootWritesBeforeActivation + 1);

    const statesBeforeRetry = states.length;
    await expect(
      platform.dispatchMessage({ version: 1, kind: "migration.retry" }, vaultSender),
    ).resolves.toMatchObject({ kind: "migration.status", phase: "completed" });
    await vi.waitFor(() => expect(states.length).toBeGreaterThan(statesBeforeRetry));
    expect(
      platform.localStorage.writes.filter((write) => write.keys.includes(ACTIVE_ROOT_KEY)),
    ).toHaveLength(rootWritesAfterActivation);
    await expect(platform.localStorage.get(["vault", "settings"])).resolves.toEqual(legacyBefore);

    const disposedToken = await authorizeLegacyKey(platform, fixture);
    dispose();
    dispose();
    disconnect();
    expect(platform.listenerCount).toBe(0);
    await expect(
      platform.dispatchMessage({ version: 1, kind: "migration.inspect" }, vaultSender),
    ).rejects.toThrow("No extension message listener is installed.");

    const disposeRestarted = installBackground(platform);
    await unlockVault(platform);
    await expect(
      platform.dispatchMessage(
        { version: 1, kind: "migration.start", credentialToken: disposedToken },
        vaultSender,
      ),
    ).resolves.toMatchObject({ kind: "error", error: { code: "VAULT_UNAVAILABLE" } });
    disposeRestarted();
  });

  it("routes one live OTP lifecycle, publishes mutations, locks safely, and reuses after unlock", async () => {
    const platform = new FakeExtensionPlatform(extensionId);
    const states: unknown[] = [];
    const dispose = installBackground(platform);
    const disconnect = platform.connectBackgroundPort(vaultSender, (state) => states.push(state));
    await setupVault(platform);
    await vi.waitFor(() => expect(states.length).toBeGreaterThan(0));

    const create = await platform.dispatchMessage(
      {
        version: 1,
        kind: "otp.create",
        input: {
          issuer: "Example",
          label: "Account",
          secret: "JBSWY3DPEHPK3PXP",
          otpType: "totp",
          algorithm: "SHA1",
          digits: 6,
          period: 30,
          favorite: false,
          tags: [],
          note: "",
        },
      },
      vaultSender,
    );
    expect(create).toMatchObject({ kind: "otp.mutationResult" });
    const itemId = (create as { item: { id: string } }).item.id;
    const statesAfterCreate = states.length;
    await vi.waitFor(() => expect(states.length).toBeGreaterThan(statesAfterCreate));

    await expect(
      platform.dispatchMessage({ version: 1, kind: "otp.list", query: "" }, popupSender),
    ).resolves.toMatchObject({ kind: "otp.listResult", items: [{ id: itemId }] });
    await expect(
      platform.dispatchMessage({ version: 1, kind: "otp.getCode", itemId }, popupSender),
    ).resolves.toMatchObject({ kind: "otp.codeResult", itemId, otpType: "totp" });
    await expect(
      platform.dispatchMessage({ version: 1, kind: "otp.getEditor", itemId }, popupSender),
    ).resolves.toEqual(unauthorized);
    await expect(
      platform.dispatchMessage({ version: 1, kind: "otp.getEditor", itemId }, vaultSender),
    ).resolves.toMatchObject({ kind: "otp.editorResult", item: { id: itemId, revision: 1 } });
    await expect(
      platform.dispatchMessage(
        {
          version: 1,
          kind: "otp.update",
          itemId,
          expectedRevision: 1,
          input: {
            issuer: "Example",
            label: "Updated account",
            secret: "JBSWY3DPEHPK3PXP",
            otpType: "totp",
            algorithm: "SHA1",
            digits: 6,
            period: 30,
            favorite: true,
            tags: [],
            note: "",
          },
        },
        vaultSender,
      ),
    ).resolves.toMatchObject({ kind: "otp.mutationResult", item: { id: itemId, revision: 2 } });

    await platform.dispatchMessage({ version: 1, kind: "vault.lock" }, vaultSender);
    await expect(
      platform.dispatchMessage({ version: 1, kind: "otp.list", query: "" }, popupSender),
    ).resolves.toMatchObject({ kind: "error", error: { code: "VAULT_LOCKED" } });
    await expect(
      platform.dispatchMessage({ version: 1, kind: "otp.getCode", itemId }, popupSender),
    ).resolves.toMatchObject({ kind: "error", error: { code: "VAULT_LOCKED" } });

    await unlockVault(platform);
    await expect(
      platform.dispatchMessage({ version: 1, kind: "otp.list", query: "" }, popupSender),
    ).resolves.toMatchObject({ kind: "otp.listResult", items: [{ id: itemId }] });

    const hotpCreate = await platform.dispatchMessage(
      {
        version: 1,
        kind: "otp.create",
        input: {
          issuer: "Example",
          label: "Counter account",
          secret: "JBSWY3DPEHPK3PXP",
          otpType: "hotp",
          algorithm: "SHA1",
          digits: 6,
          period: 0,
          counter: 0,
          favorite: false,
          tags: [],
          note: "",
        },
      },
      vaultSender,
    );
    const hotpItemId = (hotpCreate as { item: { id: string } }).item.id;
    const contentSender = {
      extensionId,
      senderUrl: "https://example.test/login",
      tabId: 7,
      frameId: 0,
      documentId: "content-document",
    };
    await expect(
      platform.dispatchMessage(
        { version: 1, kind: "otp.reserveHotp", itemId: hotpItemId },
        contentSender,
      ),
    ).resolves.toEqual(unauthorized);
    for (const command of ["otp.commitHotp", "otp.cancelHotp"] as const)
      await expect(
        platform.dispatchMessage(
          {
            version: 1,
            kind: command,
            reservationId: "fedcba98-7654-4abc-9234-fedcba987654",
          },
          contentSender,
        ),
      ).resolves.toEqual(unauthorized);
    await expect(
      platform.dispatchMessage(
        { version: 1, kind: "otp.delete", itemId, expectedRevision: 2 },
        vaultSender,
      ),
    ).resolves.toMatchObject({ kind: "otp.deleteResult", itemId, revision: 3 });

    dispose();
    dispose();
    disconnect();
    expect(platform.listenerCount).toBe(0);
  });
});
