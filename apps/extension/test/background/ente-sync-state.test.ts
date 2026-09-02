import { describe, expect, it } from "vitest";

import {
  normalizePendingOperations,
  parseEnteOtpSyncState,
} from "../../src/background/ente/sync-state";

const emptyState = {
  version: 1,
  protocolPin: "c69dcf66704ad7ec1f95e32920455be429a566ef",
  origin: "https://api.ente.io",
  accountFingerprint: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  snapshotAccountFingerprint: null,
  initialSnapshotEstablished: false,
  credentialEnvelope: "AQID",
  authKeyEnvelope: "BAUG",
  mappings: [],
  bases: [],
  cursor: 0,
  pending: [],
  uncertain: null,
  conflicts: [],
  scheduler: { connected: true, lastAttemptAt: null, lastSuccessAt: null },
  needsReauth: false,
} as const;

describe("encrypted Ente sync state", () => {
  it("strictly parses an owned bounded state and rejects unknown fields", () => {
    expect(parseEnteOtpSyncState(emptyState)).toEqual(emptyState);
    expect(() => parseEnteOtpSyncState({ ...emptyState, token: "plaintext" })).toThrow();
  });

  it("rejects a cursor or account snapshot binding before an explicit complete snapshot", () => {
    expect(parseEnteOtpSyncState({ ...emptyState, cursor: 1 }).cursor).toBe(1);
    expect(() =>
      parseEnteOtpSyncState({
        ...emptyState,
        initialSnapshotEstablished: true,
        snapshotAccountFingerprint: null,
      }),
    ).toThrow();
    expect(
      parseEnteOtpSyncState({
        ...emptyState,
        initialSnapshotEstablished: true,
        snapshotAccountFingerprint: emptyState.accountFingerprint,
      }).initialSnapshotEstablished,
    ).toBe(true);
  });

  it("rejects non-bijective mapping and orphan bases", () => {
    expect(() =>
      parseEnteOtpSyncState({
        ...emptyState,
        mappings: [
          {
            localId: "00000000-0000-4000-8000-000000000001",
            remoteId: "00000000-0000-4000-8000-000000000010",
          },
          {
            localId: "00000000-0000-4000-8000-000000000002",
            remoteId: "00000000-0000-4000-8000-000000000010",
          },
        ],
      }),
    ).toThrow();
  });

  it("coalesces queue operations without losing attempted creates", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(
      normalizePendingOperations([
        {
          operationId: "00000000-0000-4000-8000-000000000011",
          kind: "create",
          localId: id,
          desired: "AQID",
          attempts: 0,
        },
        {
          operationId: "00000000-0000-4000-8000-000000000012",
          kind: "update",
          localId: id,
          remoteId: "00000000-0000-4000-8000-000000000010",
          baseDigest: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
          desired: "BAUG",
          attempts: 0,
        },
      ]),
    ).toHaveLength(1);
    expect(
      normalizePendingOperations([
        {
          operationId: "00000000-0000-4000-8000-000000000011",
          kind: "create",
          localId: id,
          desired: "AQID",
          attempts: 0,
        },
        {
          operationId: "00000000-0000-4000-8000-000000000013",
          kind: "delete",
          localId: id,
          attempts: 0,
        },
      ]),
    ).toEqual([]);
  });
});
