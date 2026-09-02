import { describe, expect, it, vi } from "vitest";

import { executeQueueHead, reconcileUncertain } from "../../src/background/ente/write-engine";

const operation = {
  operationId: "00000000-0000-4000-8000-000000000001",
  kind: "delete",
  localId: "00000000-0000-4000-8000-000000000002",
  remoteId: "00000000-0000-4000-8000-000000000003",
  baseDigest: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  attempts: 0,
} as const;

describe("durable Ente write state machine", () => {
  it("requires durable attempt marking before network dispatch", async () => {
    const events: string[] = [];
    const result = await executeQueueHead({
      snapshot: {
        unlocked: true,
        connected: true,
        needsReauth: false,
        conflicts: [],
        pending: [operation],
        uncertain: null,
      },
      persistAttempt: () => {
        events.push("persist");
        return Promise.resolve();
      },
      client: {
        deleteEntity: vi.fn(() => {
          events.push("network");
          return Promise.resolve();
        }),
      },
      token: "token",
      authKey: new Uint8Array(32),
      signal: new AbortController().signal,
    });
    expect(events).toEqual(["persist", "network"]);
    expect(result.kind).toBe("provisional");
  });

  it("never blindly retries an uncertain create", () => {
    expect(
      reconcileUncertain({
        operation: {
          operationId: operation.operationId,
          kind: "create",
          localId: operation.localId,
          desired: "AQID",
          attempts: 1,
        },
        beforeSnapshot: new Map(),
        fullSnapshot: new Map(),
      }),
    ).toBe("blocked-create-uncertain");
  });
});
