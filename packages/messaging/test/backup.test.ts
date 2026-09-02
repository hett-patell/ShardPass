import { describe, expect, it } from "vitest";

import {
  BackupRequestSchema,
  BackupResponseSchema,
  backupSenderPolicy,
  parseBackupResponseForRequest,
} from "../src/backup";

const challengeId = "0123456789abcdef0123456789abcdef";
const capability = "01234567-89ab-4def-8123-456789abcdef";
const previewToken = "fedcba98-7654-4abc-9234-fedcba987654";
const keyEncryptionKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const item = {
  id: "10000000-0000-4000-8000-000000000001",
  kind: "otp" as const,
  schemaVersion: 1 as const,
  revision: 1,
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
  issuer: "Synthetic",
  label: "account",
  secret: "JBSWY3DPEHPK3PXP",
  otpType: "totp" as const,
  algorithm: "SHA1" as const,
  digits: 6,
  period: 30,
  favorite: false,
  tags: [],
  note: "",
};
const descriptor = {
  sourceFormat: "v2" as const,
  exportedAt: "2026-08-12T00:00:00.000Z",
  settings: { autoLockMinutes: 15 as const, lockOnScreenLock: true },
  history: { journal: [], tombstones: [] },
};

const begin = { version: 1 as const, kind: "backup.beginExportStepUp" as const };
const challenge = {
  version: 1 as const,
  kind: "backup.exportStepUpChallenge" as const,
  challengeId,
  kdf: {
    algorithm: "argon2id" as const,
    salt: "AAAAAAAAAAAAAAAAAAAAAA==",
    memoryKiB: 65_536,
    iterations: 3,
    parallelism: 1,
  },
  expiresAt: 300_000,
};
const previewRequest = {
  version: 1 as const,
  kind: "backup.previewImport" as const,
  descriptor,
  items: [item],
};
const previewResult = {
  version: 1 as const,
  kind: "backup.importPreview" as const,
  previewToken,
  rows: [{ ordinal: 1, status: "accepted" as const, reason: "BACKUP_IMPORT_ACCEPTED" as const }],
  accepted: 1,
  duplicate: 0,
  conflict: 0,
  rejected: 0,
  settings: "replace" as const,
  history: { journalAdded: 0, tombstonesAdded: 0 },
  expiresAt: 300_000,
};

describe("backup runtime messaging", () => {
  it("accepts strict version-one requests without any raw password field", () => {
    const requests = [
      begin,
      {
        version: 1,
        kind: "backup.finishExportStepUp",
        challengeId,
        keyEncryptionKey,
      },
      { version: 1, kind: "backup.readPortableSnapshot", capability },
      previewRequest,
      { version: 1, kind: "backup.confirmImport", previewToken },
      { version: 1, kind: "backup.cancelImport", previewToken },
    ];
    for (const request of requests) {
      expect(BackupRequestSchema.safeParse(request).success).toBe(true);
      expect(JSON.stringify(request).toLowerCase()).not.toContain("password");
    }
    expect(
      BackupRequestSchema.safeParse({ ...begin, password: "never-cross-runtime" }).success,
    ).toBe(false);
    expect(
      BackupRequestSchema.safeParse({
        version: 1,
        kind: "backup.finishExportStepUp",
        challengeId,
        keyEncryptionKey,
        derivedKey: new Uint8Array(32),
      }).success,
    ).toBe(false);
    expect(BackupRequestSchema.safeParse({ ...begin, version: 2 }).success).toBe(false);
  });

  it("bounds imported portable items and rejects storage authority or raw backup bodies", () => {
    expect(BackupRequestSchema.safeParse(previewRequest).success).toBe(true);
    expect(BackupRequestSchema.safeParse({ ...previewRequest, items: [] }).success).toBe(true);
    expect(
      BackupRequestSchema.safeParse({ ...previewRequest, items: Array(10_001).fill(item) }).success,
    ).toBe(false);
    for (const forbidden of [
      { root: { generationId: "private" } },
      { repository: {} },
      { callback: () => undefined },
      { backupBytes: new Uint8Array([1, 2, 3]) },
    ]) {
      expect(BackupRequestSchema.safeParse({ ...previewRequest, ...forbidden }).success).toBe(
        false,
      );
    }
  });

  it("strictly parses safe responses and pairs each response to its request", () => {
    const responses = [
      challenge,
      {
        version: 1,
        kind: "backup.exportAuthorized",
        capability,
        expiresAt: 300_000,
      },
      {
        version: 1,
        kind: "backup.portableSnapshot",
        capability,
        payload: {
          schemaVersion: 1,
          exportedAt: descriptor.exportedAt,
          items: [item],
          settings: descriptor.settings,
          history: descriptor.history,
        },
      },
      previewResult,
      { version: 1, kind: "backup.importConfirmed", imported: 1, duplicate: 0, conflict: 0 },
      { ...previewResult, kind: "backup.importPreviewChanged" as const },
      { version: 1, kind: "backup.importCancelled", cancelled: true },
    ];
    for (const response of responses)
      expect(BackupResponseSchema.safeParse(response).success).toBe(true);

    expect(parseBackupResponseForRequest(begin, challenge).success).toBe(true);
    expect(parseBackupResponseForRequest(begin, previewResult).success).toBe(false);
    expect(parseBackupResponseForRequest(previewRequest, previewResult).success).toBe(true);
    expect(
      BackupResponseSchema.safeParse({ ...previewResult, item, root: "private-root" }).success,
    ).toBe(false);
  });

  it("makes every backup command document-bound and vault-only", () => {
    expect(backupSenderPolicy).toEqual({
      "backup.beginExportStepUp": { allowedContexts: ["vault"], requireDocument: true },
      "backup.finishExportStepUp": { allowedContexts: ["vault"], requireDocument: true },
      "backup.readPortableSnapshot": { allowedContexts: ["vault"], requireDocument: true },
      "backup.previewImport": { allowedContexts: ["vault"], requireDocument: true },
      "backup.confirmImport": { allowedContexts: ["vault"], requireDocument: true },
      "backup.cancelImport": { allowedContexts: ["vault"], requireDocument: true },
    });
  });
});
