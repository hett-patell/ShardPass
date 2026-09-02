import {
  BACKUP_V2_LIMITS,
  exportPortableBackup,
  importLegacyBackup,
  importPortableBackup,
  type ImportedPortableBackup,
  type PortableBackupPayload,
} from "@shardpass/importers";
import type { KdfExecutor } from "@shardpass/crypto";
import type { BackupResponse, SafeBackupDescriptor } from "@shardpass/messaging";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type { BackupUiExtensionPlatform } from "../../platform/extension-platform";

export type BackupCryptoPort = Readonly<{
  exportPortableBackup: typeof exportPortableBackup;
  importPortableBackup: typeof importPortableBackup;
  importLegacyBackup: typeof importLegacyBackup;
  canonicalPayload(payload: PortableBackupPayload): Uint8Array;
}>;

export const defaultBackupCrypto: BackupCryptoPort = Object.freeze({
  exportPortableBackup,
  importPortableBackup,
  importLegacyBackup,
  canonicalPayload(payload) {
    return new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: payload.schemaVersion,
        exportedAt: payload.exportedAt,
        items: payload.items,
        settings: payload.settings,
        history: payload.history,
      }),
    );
  },
});

type SafePreview = Readonly<{
  previewToken: string;
  accepted: number;
  duplicate: number;
  conflict: number;
  rejected: number;
  settings: "unchanged" | "replace";
  journalAdded: number;
  tombstonesAdded: number;
}>;

type BackupState = Readonly<{
  exportPhase: "idle" | "working" | "ready";
  downloadUrl: string | null;
  importPhase: "idle" | "reading" | "preview" | "confirming" | "complete";
  preview: SafePreview | null;
  reviewed: boolean;
  error: string | null;
  status: string | null;
}>;

type OwnedJob = {
  id: number;
  controller: AbortController;
  bytes: Uint8Array | null;
  password: Uint8Array | null;
  payload: PortableBackupPayload | null;
  disposed: boolean;
  dispose(): void;
};

const INITIAL_STATE: BackupState = Object.freeze({
  exportPhase: "idle",
  downloadUrl: null,
  importPhase: "idle",
  preview: null,
  reviewed: false,
  error: null,
  status: null,
});
const FILE_READ_TIMEOUT_MS = 15_000;
const encoder = new TextEncoder();

function createJob(id: number): OwnedJob {
  return {
    id,
    controller: new AbortController(),
    bytes: null,
    password: null,
    payload: null,
    disposed: false,
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.controller.abort();
      this.bytes?.fill(0);
      this.password?.fill(0);
      this.bytes = null;
      this.password = null;
      this.payload = null;
    },
  };
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1)
    difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

function fixedError(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : error instanceof Error
        ? error.message
        : "";
  switch (code) {
    case "BACKUP_AUTH_FAILED":
      return "The current vault password is incorrect.";
    case "BACKUP_EXPIRED":
      return "Backup authorization expired. Start again.";
    case "BACKUP_CHANGED":
      return "Backup summary changed. Review it again before importing.";
    case "BACKUP_CAPACITY":
      return "The vault does not have capacity for this backup.";
    case "BACKUP_LIMIT":
      return "Backup exceeds the safe local limit.";
    case "VAULT_LOCKED":
      return "Unlock the vault before using backups.";
    default:
      return "Backup could not be processed safely.";
  }
}

function previewFrom(
  response: Extract<
    BackupResponse,
    { kind: "backup.importPreview" | "backup.importPreviewChanged" }
  >,
): SafePreview {
  return {
    previewToken: response.previewToken,
    accepted: response.accepted,
    duplicate: response.duplicate,
    conflict: response.conflict,
    rejected: response.rejected,
    settings: response.settings,
    journalAdded: response.history.journalAdded,
    tombstonesAdded: response.history.tombstonesAdded,
  };
}

function descriptorFrom(imported: ImportedPortableBackup): SafeBackupDescriptor {
  return {
    sourceFormat: imported.sourceFormat,
    exportedAt: imported.payload.exportedAt,
    settings: { ...imported.payload.settings },
    history: {
      journal: imported.payload.history.journal.map((entry) => ({ ...entry })),
      tombstones: imported.payload.history.tombstones.map((entry) => ({ ...entry })),
    },
  };
}

function encodeBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function boundedRead(file: File, signal: AbortSignal): Promise<Uint8Array> {
  if (file.size === 0 || file.size > BACKUP_V2_LIMITS.maxEnvelopeBytes)
    throw new Error("BACKUP_LIMIT");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error("BACKUP_LIMIT")), FILE_READ_TIMEOUT_MS);
  });
  const aborted = new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("BACKUP_CANCELLED")), { once: true });
  });
  try {
    const buffer = await Promise.race([file.arrayBuffer(), timedOut, aborted]);
    if (signal.aborted || buffer.byteLength !== file.size) throw new Error("BACKUP_INVALID");
    return new Uint8Array(buffer);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function useBackup({
  platform,
  active,
  kdfExecutor,
  crypto,
  onImported,
}: Readonly<{
  platform: BackupUiExtensionPlatform;
  active: boolean;
  kdfExecutor: KdfExecutor;
  crypto: BackupCryptoPort;
  onImported?: () => void;
}>) {
  const [state, setState] = useState<BackupState>(INITIAL_STATE);
  const currentPasswordRef = useRef<HTMLInputElement>(null);
  const backupPasswordRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const importPasswordRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const exportJobRef = useRef<OwnedJob | null>(null);
  const importJobRef = useRef<OwnedJob | null>(null);
  const ownerRef = useRef(0);
  const mountedRef = useRef(true);
  const activeRef = useRef(active);
  const downloadUrlRef = useRef<string | null>(null);
  const previewTokenRef = useRef<string | null>(null);

  const revokeDownload = useCallback(() => {
    const url = downloadUrlRef.current;
    downloadUrlRef.current = null;
    if (url !== null) URL.revokeObjectURL(url);
  }, []);

  const clearControls = useCallback(() => {
    if (currentPasswordRef.current !== null) currentPasswordRef.current.value = "";
    if (backupPasswordRef.current !== null) backupPasswordRef.current.value = "";
    if (confirmationRef.current !== null) confirmationRef.current.value = "";
    if (importPasswordRef.current !== null) importPasswordRef.current.value = "";
    if (fileRef.current !== null) fileRef.current.value = "";
  }, []);

  const disposeOwned = useCallback(() => {
    ownerRef.current += 1;
    exportJobRef.current?.dispose();
    importJobRef.current?.dispose();
    exportJobRef.current = null;
    importJobRef.current = null;
    clearControls();
    revokeDownload();
  }, [clearControls, revokeDownload]);

  useLayoutEffect(() => {
    activeRef.current = active;
    if (!active) {
      const token = previewTokenRef.current;
      previewTokenRef.current = null;
      disposeOwned();
      setState(INITIAL_STATE);
      if (token !== null)
        void platform
          .sendBackupMessage({ version: 1, kind: "backup.cancelImport", previewToken: token })
          .catch(() => undefined);
    }
  }, [active, disposeOwned, platform]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const token = previewTokenRef.current;
      previewTokenRef.current = null;
      disposeOwned();
      if (token !== null)
        void platform
          .sendBackupMessage({ version: 1, kind: "backup.cancelImport", previewToken: token })
          .catch(() => undefined);
    };
  }, [disposeOwned, platform]);

  const isOwner = (job: OwnedJob) =>
    mountedRef.current &&
    activeRef.current &&
    !job.disposed &&
    (exportJobRef.current === job || importJobRef.current === job);

  const prepareExport = useCallback(() => {
    if (!activeRef.current) return;
    const currentPassword = currentPasswordRef.current?.value ?? "";
    const backupPassword = backupPasswordRef.current?.value ?? "";
    const confirmation = confirmationRef.current?.value ?? "";
    clearControls();
    revokeDownload();
    exportJobRef.current?.dispose();
    const job = createJob(++ownerRef.current);
    exportJobRef.current = job;
    if (
      currentPassword.length === 0 ||
      backupPassword.length === 0 ||
      backupPassword !== confirmation
    ) {
      job.dispose();
      setState((value) => ({
        ...value,
        exportPhase: "idle",
        error: "Enter matching backup passwords and your current vault password.",
      }));
      return;
    }
    const currentBytes = encoder.encode(currentPassword);
    job.password = encoder.encode(backupPassword);
    setState((value) => ({
      ...value,
      exportPhase: "working",
      downloadUrl: null,
      error: null,
      status: null,
    }));
    void (async () => {
      let proof: Uint8Array | undefined;
      let verifiedCanonical: Uint8Array | undefined;
      let expectedCanonical: Uint8Array | undefined;
      let backupBytes: Uint8Array | undefined;
      try {
        const challenge = await platform.sendBackupMessage({
          version: 1,
          kind: "backup.beginExportStepUp",
        });
        if (!isOwner(job) || challenge.kind !== "backup.exportStepUpChallenge") return;
        proof = await kdfExecutor.derive({
          password: currentBytes,
          salt: Uint8Array.from(atob(challenge.kdf.salt), (character) => character.charCodeAt(0)),
          parameters: {
            algorithm: "argon2id",
            memoryKiB: challenge.kdf.memoryKiB,
            iterations: challenge.kdf.iterations,
            parallelism: challenge.kdf.parallelism,
          },
          signal: job.controller.signal,
        });
        if (!isOwner(job)) return;
        const authorized = await platform.sendBackupMessage({
          version: 1,
          kind: "backup.finishExportStepUp",
          challengeId: challenge.challengeId,
          keyEncryptionKey: encodeBase64(proof),
        });
        proof.fill(0);
        proof = undefined;
        if (!isOwner(job) || authorized.kind !== "backup.exportAuthorized") return;
        const snapshot = await platform.sendBackupMessage({
          version: 1,
          kind: "backup.readPortableSnapshot",
          capability: authorized.capability,
        });
        if (!isOwner(job) || snapshot.kind !== "backup.portableSnapshot") return;
        job.payload = snapshot.payload;
        backupBytes = await crypto.exportPortableBackup(
          snapshot.payload,
          job.password!,
          kdfExecutor,
        );
        if (!isOwner(job)) return;
        const verified = await crypto.importPortableBackup(
          backupBytes,
          job.password!,
          kdfExecutor,
          { signal: job.controller.signal },
        );
        if (!isOwner(job) || verified.sourceFormat !== "v2") return;
        expectedCanonical = crypto.canonicalPayload(snapshot.payload);
        verifiedCanonical = crypto.canonicalPayload(verified.payload);
        if (!equalBytes(expectedCanonical, verifiedCanonical)) throw new Error("BACKUP_INVALID");
        const blobBytes = backupBytes.slice().buffer;
        const url = URL.createObjectURL(new Blob([blobBytes], { type: "application/x-shardpass" }));
        if (!isOwner(job)) {
          URL.revokeObjectURL(url);
          return;
        }
        downloadUrlRef.current = url;
        setState((value) => ({
          ...value,
          exportPhase: "ready",
          downloadUrl: url,
          error: null,
          status: "Encrypted backup verified locally.",
        }));
      } catch (error) {
        if (isOwner(job))
          setState((value) => ({
            ...value,
            exportPhase: "idle",
            error: fixedError(error),
            status: null,
          }));
      } finally {
        currentBytes.fill(0);
        proof?.fill(0);
        verifiedCanonical?.fill(0);
        expectedCanonical?.fill(0);
        backupBytes?.fill(0);
        job.password?.fill(0);
        job.password = null;
        job.payload = null;
      }
    })();
  }, [clearControls, crypto, kdfExecutor, platform, revokeDownload]);

  const selectFile = useCallback(
    (file?: File) => {
      const password = importPasswordRef.current?.value ?? "";
      clearControls();
      importJobRef.current?.dispose();
      const job = createJob(++ownerRef.current);
      importJobRef.current = job;
      if (file === undefined || password.length === 0) {
        job.dispose();
        setState((value) => ({
          ...value,
          importPhase: "idle",
          error: "Enter the backup file password before choosing a local backup.",
        }));
        return;
      }
      if (file.size === 0 || file.size > BACKUP_V2_LIMITS.maxEnvelopeBytes) {
        job.dispose();
        setState((value) => ({
          ...value,
          importPhase: "idle",
          error: fixedError(new Error("BACKUP_LIMIT")),
        }));
        return;
      }
      job.password = encoder.encode(password);
      const oldToken = previewTokenRef.current;
      previewTokenRef.current = null;
      if (oldToken !== null)
        void platform
          .sendBackupMessage({ version: 1, kind: "backup.cancelImport", previewToken: oldToken })
          .catch(() => undefined);
      setState((value) => ({
        ...value,
        importPhase: "reading",
        preview: null,
        reviewed: false,
        error: null,
        status: null,
      }));
      void (async () => {
        try {
          job.bytes = await boundedRead(file, job.controller.signal);
          if (!isOwner(job)) return;
          let imported: ImportedPortableBackup;
          try {
            imported = await crypto.importPortableBackup(job.bytes, job.password!, kdfExecutor, {
              signal: job.controller.signal,
            });
          } catch {
            if (!isOwner(job)) return;
            imported = await crypto.importLegacyBackup(job.bytes, job.password!);
          }
          if (!isOwner(job)) return;
          job.payload = imported.payload;
          const response = await platform.sendBackupMessage({
            version: 1,
            kind: "backup.previewImport",
            descriptor: descriptorFrom(imported),
            items: imported.payload.items.map((item) => ({ ...item, tags: [...item.tags] })),
          });
          if (!isOwner(job) || response.kind !== "backup.importPreview") return;
          previewTokenRef.current = response.previewToken;
          job.dispose();
          importJobRef.current = null;
          setState((value) => ({
            ...value,
            importPhase: "preview",
            preview: previewFrom(response),
            reviewed: false,
            error: null,
          }));
        } catch (error) {
          if (isOwner(job))
            setState((value) => ({
              ...value,
              importPhase: "idle",
              preview: null,
              error: fixedError(error),
            }));
          job.dispose();
          if (importJobRef.current === job) importJobRef.current = null;
        }
      })();
    },
    [clearControls, crypto, kdfExecutor, platform],
  );

  const cancel = useCallback(() => {
    const token = previewTokenRef.current;
    previewTokenRef.current = null;
    disposeOwned();
    setState(INITIAL_STATE);
    if (token !== null)
      void platform
        .sendBackupMessage({ version: 1, kind: "backup.cancelImport", previewToken: token })
        .catch(() => undefined);
  }, [disposeOwned, platform]);

  const confirm = useCallback(() => {
    const token = previewTokenRef.current;
    if (token === null || !state.reviewed) return;
    const operation = ++ownerRef.current;
    setState((value) => ({ ...value, importPhase: "confirming", error: null }));
    void platform
      .sendBackupMessage({ version: 1, kind: "backup.confirmImport", previewToken: token })
      .then(
        (response) => {
          if (!mountedRef.current || !activeRef.current || operation !== ownerRef.current) return;
          if (response.kind === "backup.importPreviewChanged") {
            previewTokenRef.current = response.previewToken;
            setState((value) => ({
              ...value,
              importPhase: "preview",
              preview: previewFrom(response),
              reviewed: false,
              error: "Backup summary changed. Review it again before importing.",
            }));
            return;
          }
          if (response.kind !== "backup.importConfirmed") throw new Error("BACKUP_UNAVAILABLE");
          previewTokenRef.current = null;
          setState((value) => ({
            ...value,
            importPhase: "complete",
            preview: null,
            reviewed: false,
            error: null,
            status: `Backup import complete. ${response.imported.toLocaleString("en-US")} imported.`,
          }));
          onImported?.();
        },
        (error) => {
          if (mountedRef.current && activeRef.current && operation === ownerRef.current)
            setState((value) => ({
              ...value,
              importPhase: "preview",
              reviewed: false,
              error: fixedError(error),
            }));
        },
      );
  }, [onImported, platform, state.reviewed]);

  const downloadConsumed = useCallback(() => {
    setTimeout(() => {
      revokeDownload();
      if (mountedRef.current)
        setState((value) => ({
          ...value,
          exportPhase: "idle",
          downloadUrl: null,
          status: "Backup download started.",
        }));
    }, 0);
  }, [revokeDownload]);

  return {
    state,
    currentPasswordRef,
    backupPasswordRef,
    confirmationRef,
    importPasswordRef,
    fileRef,
    prepareExport,
    selectFile,
    confirm,
    cancel,
    downloadConsumed,
    setReviewed: (reviewed: boolean) => setState((value) => ({ ...value, reviewed })),
  };
}
