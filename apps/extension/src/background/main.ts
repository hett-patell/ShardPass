import {
  BackupRequestSchema,
  ItemCrudRequestSchema,
  MigrationRequestSchema,
  normalizeSenderContext,
  OtpFillRequestSchema,
  OtpImportRequestSchema,
  OtpRequestSchema,
  otpResponseKindByRequest,
  VaultRequestSchema,
  type OtpRequest,
  type OtpResponse,
} from "@shardpass/messaging";
import { toSafeError } from "@shardpass/security";
import { ACTIVE_ROOT_KEY } from "@shardpass/storage";
import { webCryptoRandomSource } from "@shardpass/crypto";
import { HotpReservationService } from "@shardpass/otp";

import { createChromePlatform } from "../platform/chrome-platform";
import type { BackgroundExtensionPlatform } from "../platform/extension-platform";
import { EnteOtpMetadataStore } from "./ente/ente-otp-metadata-store";
import { EnteSyncCoordinator } from "./ente/coordinator";
import { EnteService } from "./ente/ente-service";
import { EnteSyncScheduler } from "./ente/scheduler";
import { EnteProtocolError } from "./ente/protocol";
import { createProductionEnteRuntimeDependencies } from "./ente/production-runtime";
import { createEnteRuntimeOwner, type EnteRuntimeDependencies } from "./ente/runtime";
import { ItemService } from "./item/item-service";
import { LoginFillService } from "./login/login-fill-service";
import { createInternalHotpLifecycle } from "./otp/hotp-lifecycle";
import { OtpImportService } from "./otp/import-service";
import { OtpFillService } from "./otp/otp-fill-service";
import { OtpService } from "./otp/otp-service";
import { PasswordGenService } from "./password/password-gen-service";
import { routeMessage, type BackgroundErrorResponse, type BackgroundResponse } from "./router";
import { StatePublisher } from "./state-publisher";
import { BackupService } from "./vault/backup-service";
import { MigrationCredentialService } from "./vault/migration-credential-service";
import { EncryptedMigrationDestination } from "./vault/migration-destination";
import { MigrationService } from "./vault/migration-service";
import { SessionService } from "./vault/session-service";
import { SettingsService } from "./vault/settings-service";
import { VaultService } from "./vault/vault-service";

function errorResponse(code: "UNEXPECTED" | "VAULT_UNAVAILABLE"): BackgroundErrorResponse {
  return { version: 1, kind: "error", error: toSafeError(undefined, code) };
}

export function shouldPublishOtpState(request: OtpRequest, response: OtpResponse): boolean {
  if (response.kind !== otpResponseKindByRequest[request.kind]) return false;
  switch (request.kind) {
    case "otp.create":
    case "otp.update":
    case "otp.delete":
    case "otp.commitHotp":
      return true;
    case "otp.cancelHotp":
      return response.kind === "otp.hotpCancelled" && response.cancelled;
    case "otp.list":
    case "otp.getEditor":
    case "otp.getCode":
    case "otp.copyCode":
    case "otp.reserveHotp":
      return false;
  }
}

export function shouldRefreshOtpState(response: BackgroundResponse): boolean {
  return (
    response.kind === "error" &&
    (response.error.code === "VAULT_LOCKED" || response.error.code === "VAULT_UNAVAILABLE")
  );
}

export function shouldRefreshBackupState(response: BackgroundResponse): boolean {
  return response.kind === "error" && response.error.code === "BACKUP_EXPIRED";
}

export function installBackground(
  platform: BackgroundExtensionPlatform,
  enteRuntime?: EnteRuntimeDependencies,
): () => void {
  let disposed = false;
  let readyFailed = false;
  const sessions = new SessionService({
    local: platform.localStorage,
    session: platform.sessionStorage,
    random: webCryptoRandomSource,
    now: () => Date.now(),
    isoNow: () => new Date().toISOString(),
    nextId: () => crypto.randomUUID(),
  });
  let lockTransition = () => sessions.lock();
  const settings = new SettingsService(platform.localStorage, platform, () => lockTransition());
  const vault = new VaultService(sessions, settings);
  const backup = new BackupService({
    sessions,
    readSettings: () => settings.snapshot(),
    applyImportedSettings: async (imported) => {
      await settings.applyMigrated(imported);
    },
    now: () => Date.now(),
    nextId: () => crypto.randomUUID(),
  });
  const reservations = new HotpReservationService({
    clock: { now: () => Date.now() },
    random: { uuid: () => crypto.randomUUID() },
    committer: { commit: () => Promise.reject(new Error("repository owns HOTP commits")) },
  });
  const otp = new OtpService({
    repository: sessions.vaultRepository,
    clock: { now: () => Date.now(), isoNow: () => new Date().toISOString() },
    ids: { next: () => crypto.randomUUID() },
    reservations,
    notePrivilegedActivity: () => settings.notePrivilegedActivity(),
    registerReservationCleanup: (cleanup) => sessions.onLockOrDispose(cleanup),
  });
  const hotpLifecycle = createInternalHotpLifecycle({
    repository: sessions.vaultRepository,
    reservations,
    now: () => Date.now(),
  });
  const otpFill = new OtpFillService({
    repository: sessions.vaultRepository,
    hotp: hotpLifecycle,
    now: () => Date.now(),
    nextOpaqueId: randomStreamId,
    captureSession: () => sessions.captureBackupSession(),
    assertSession: (authority) => sessions.assertBackupSession(authority),
    notePrivilegedActivity: () => settings.notePrivilegedActivity(),
    registerCleanup: (cleanup) => sessions.onLockOrDispose(cleanup),
  });
  const otpImport = new OtpImportService({
    repository: sessions.vaultRepository,
    now: () => Date.now(),
    nextId: () => crypto.randomUUID(),
    notePrivilegedActivity: () => settings.notePrivilegedActivity(),
  });
  const unregisterImportCleanup = sessions.onLockOrDispose(() => otpImport.clearForSession());
  const item = new ItemService({
    repository: sessions.vaultRepository,
    notePrivilegedActivity: () => settings.notePrivilegedActivity(),
  });
  const loginFill = new LoginFillService({
    repository: sessions.vaultRepository,
    now: () => Date.now(),
    notePrivilegedActivity: () => settings.notePrivilegedActivity(),
  });
  const passwordGen = new PasswordGenService();
  const ente = new EnteOtpMetadataStore();
  const credentials = new MigrationCredentialService(platform.localStorage, sessions, {
    now: () => Date.now(),
    nextOpaqueId: randomStreamId,
  });
  const destination = new EncryptedMigrationDestination(platform.localStorage, sessions, {
    now: () => Date.now(),
    settings,
    ente,
  });
  const migration = new MigrationService(platform.localStorage, destination, credentials);
  let enteUnlocked = false;
  const runtimeOwner =
    enteRuntime === undefined
      ? null
      : createEnteRuntimeOwner(
          sessions.vaultRepository as Parameters<typeof createEnteRuntimeOwner>[0],
          enteRuntime,
        );
  const enteCoordinator = new EnteSyncCoordinator(
    runtimeOwner === null
      ? () => Promise.reject(new EnteProtocolError("ENTE_UNAVAILABLE"))
      : runtimeOwner.cycle,
    () => enteUnlocked,
  );
  const enteScheduler =
    platform.scheduleEnteSync === undefined
      ? null
      : new EnteSyncScheduler(
          { scheduleEnteSync: (minutes) => platform.scheduleEnteSync!(minutes) },
          enteCoordinator,
        );
  const enteService = new EnteService(
    enteCoordinator,
    runtimeOwner === null ? undefined : runtimeOwner.resolve,
    runtimeOwner === null ? undefined : runtimeOwner.preview,
    async (connected) => {
      await runtimeOwner?.setConnected(connected);
      await enteScheduler?.setConnected(connected);
    },
    runtimeOwner === null ? undefined : runtimeOwner.issueSessionHandoff,
    runtimeOwner === null ? undefined : runtimeOwner.activateSession,
    runtimeOwner === null
      ? undefined
      : async () => {
          await runtimeOwner.disconnect();
          await enteScheduler?.setConnected(false);
        },
  );
  const publisher = new StatePublisher(randomStreamId(), () => vault.getStateSnapshot());

  const ready = (async () => {
    try {
      await platform.initializeTrustedStorage();
      await settings.start();
      if (disposed) settings.dispose();
    } catch (error) {
      // Logged rather than swallowed: a failure here disables every route behind
      // awaitReady(), so a silent catch leaves the UI stuck with no diagnosable cause.
      console.error("[ShardPass] Background startup failed; vault is unavailable.", error);
      readyFailed = true;
      await sessions.lock().catch(() => undefined);
    }
  })();

  const lockAndPublish = async () => {
    await ready;
    if (disposed || readyFailed) return;
    enteUnlocked = false;
    await enteScheduler?.setUnlocked(false);
    enteService.lock();
    runtimeOwner?.clearSessionHandoffs();
    await sessions.lock();
    await settings.cancelAutoLock();
    publisher.publish();
  };
  lockTransition = lockAndPublish;

  const awaitReady = async (): Promise<boolean> => {
    await ready;
    return !disposed && !readyFailed;
  };

  const disposeAlarm = platform.onAutoLock(() => void lockAndPublish());
  const disposeEnteAlarm =
    platform.onEnteSyncAlarm?.(() => enteScheduler?.alarmHandler()()) ?? (() => undefined);
  const disposeRoot = platform.onLocalStorageChanged((changes) => {
    void (async () => {
      if (!(await awaitReady()) || !(ACTIVE_ROOT_KEY in changes)) return;
      await sessions.handleActiveRootChange(changes[ACTIVE_ROOT_KEY]);
      publisher.publish();
    })();
  });
  const disposePorts = platform.onVaultStatePort((rawSenderMetadata, send) => {
    let active = true;
    let unsubscribe: () => void = () => undefined;
    void (async () => {
      if (!(await awaitReady()) || !active) return;
      const sender = normalizeSenderContext(rawSenderMetadata, platform.extensionId);
      if (sender === null || sender.contextKind === "content" || sender.documentId === undefined) {
        console.warn(
          "[ShardPass] Vault-state port rejected. Raw metadata:",
          JSON.stringify(rawSenderMetadata),
        );
        return;
      }
      unsubscribe = publisher.subscribe(send);
    })();
    return () => {
      active = false;
      unsubscribe();
    };
  });
  const disposeMessage = platform.onMessage(async (payload, rawSenderMetadata) => {
    if (!(await awaitReady())) return errorResponse("VAULT_UNAVAILABLE");
    try {
      const senderContext = normalizeSenderContext(rawSenderMetadata, platform.extensionId);
      if (senderContext === null)
        // A rejected sender is otherwise indistinguishable from a dead worker at the
        // call site, so name the metadata that failed normalization. Browser-supplied
        // routing fields only — no message payload, no vault data.
        console.warn(
          "[ShardPass] Sender rejected (UNAUTHORIZED_SENDER). Raw metadata:",
          JSON.stringify(rawSenderMetadata),
          "expected extensionId:",
          platform.extensionId,
        );
      const parsedBackup = BackupRequestSchema.safeParse(payload);
      const parsedVault = VaultRequestSchema.safeParse(payload);
      const parsedMigration = MigrationRequestSchema.safeParse(payload);
      const parsedOtp = OtpRequestSchema.safeParse(payload);
      const parsedImport = OtpImportRequestSchema.safeParse(payload);
      const parsedFill = OtpFillRequestSchema.safeParse(payload);
      const parsedItemCrud = ItemCrudRequestSchema.safeParse(payload);
      const response = await routeMessage(
        payload,
        senderContext,
        platform.extensionId,
        vault,
        () => publisher.snapshot(),
        migration,
        otp,
        otpImport,
        backup,
        otpFill,
        enteService,
        item,
        loginFill,
        passwordGen,
      );
      if (parsedVault.success) {
        const state = await sessions.getState();
        const wasUnlocked = enteUnlocked;
        enteUnlocked = state.state === "unlocked";
        if (wasUnlocked !== enteUnlocked) {
          await enteScheduler?.setUnlocked(enteUnlocked).catch(() => undefined);
          if (enteUnlocked && (await runtimeOwner?.connected().catch(() => false)))
            await enteScheduler?.setConnected(true).catch(() => undefined);
        }
        if (!wasUnlocked && enteUnlocked && enteScheduler === null)
          void enteCoordinator.trigger("unlock").catch(() => undefined);
        if (!enteUnlocked) enteService.lock();
      }
      if (
        (parsedBackup.success &&
          (response.kind === "backup.importConfirmed" || shouldRefreshBackupState(response))) ||
        (parsedVault.success &&
          [
            "vault.setup",
            "vault.unlock",
            "vault.lock",
            "vault.changePassword",
            "vault.updateLockSettings",
          ].includes(parsedVault.data.kind)) ||
        (parsedMigration.success &&
          ["migration.activate", "migration.retry"].includes(parsedMigration.data.kind)) ||
        (parsedOtp.success &&
          ((response.kind.startsWith("otp.") &&
            shouldPublishOtpState(parsedOtp.data, response as OtpResponse)) ||
            shouldRefreshOtpState(response))) ||
        (parsedImport.success &&
          (response.kind === "otp.importConfirmed" || shouldRefreshOtpState(response))) ||
        (parsedFill.success &&
          (response.kind === "otp.fillConfirmed" || shouldRefreshOtpState(response))) ||
        (parsedItemCrud.success &&
          (response.kind === "item.mutationResult" ||
            response.kind === "item.deleteResult" ||
            shouldRefreshOtpState(response)))
      )
        publisher.publish();
      return response;
    } catch {
      return errorResponse("UNEXPECTED");
    }
  });

  return () => {
    if (disposed) return;
    disposed = true;
    disposeMessage();
    disposeAlarm();
    disposeEnteAlarm();
    void enteScheduler?.dispose();
    enteService.dispose();
    runtimeOwner?.clearSessionHandoffs();
    disposeRoot();
    disposePorts();
    otpFill.dispose();
    otp.dispose();
    backup.dispose();
    unregisterImportCleanup();
    otpImport.dispose();
    credentials.dispose();
    void sessions.lock();
    settings.dispose();
    publisher.dispose();
  };
}

function randomStreamId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const productionEnteRuntime = createProductionEnteRuntimeDependencies();
export const disposeBackground = installBackground(createChromePlatform(), productionEnteRuntime);
