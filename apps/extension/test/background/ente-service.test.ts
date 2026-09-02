import { describe, expect, it, vi } from "vitest";

import type { SenderContext } from "@shardpass/messaging";
import type { EnteSyncCoordinator } from "../../src/background/ente/coordinator";
import { EnteService } from "../../src/background/ente/ente-service";

const sender = {
  extensionId: "extension-id",
  contextKind: "vault",
  senderUrl: "chrome-extension://extension-id/vault/index.html",
  documentId: "vault-document",
} as SenderContext;

describe("Ente conflict service path", () => {
  it("passes only request capability, public choice, and bound sender to the configured resolver", async () => {
    const trigger = vi.fn(() => Promise.resolve());
    const resolve = vi.fn(() => Promise.resolve());
    const service = new EnteService({ trigger } as unknown as EnteSyncCoordinator, resolve);
    await service.handle(
      {
        version: 1,
        kind: "ente.resolveConflict",
        capability: "capability-000000000000000000000000",
        choice: "keep-both",
      },
      sender,
    );
    expect(resolve).toHaveBeenCalledWith(
      "capability-000000000000000000000000",
      "keep-both",
      sender,
    );
    expect(trigger).not.toHaveBeenCalled();
  });

  it("exposes only opaque conflict capability metadata in status", async () => {
    const preview = vi.fn(() =>
      Promise.resolve([{ capability: "opaque-capability-0000000000000000", canKeepBoth: true }]),
    );
    const service = new EnteService({} as EnteSyncCoordinator, undefined, preview);
    (service as unknown as { state: { connected: boolean } }).state.connected = true;
    const result = await service.handle({ version: 1, kind: "ente.status" }, sender);
    expect(result.conflicts).toEqual([
      { capability: "opaque-capability-0000000000000000", canKeepBoth: true },
    ]);
    expect(JSON.stringify(result)).not.toContain("secretBase32");
  });

  it("cancels runtime work and invokes one atomic local disconnect", async () => {
    const cancel = vi.fn();
    const disconnect = vi.fn(() => Promise.resolve());
    const setConnected = vi.fn(() => Promise.resolve());
    const service = new EnteService(
      { cancel } as unknown as EnteSyncCoordinator,
      undefined,
      undefined,
      setConnected,
      undefined,
      undefined,
      disconnect,
    );
    (service as unknown as { state: { connected: boolean } }).state.connected = true;
    const result = await service.handle(
      {
        version: 1,
        kind: "ente.disconnectConfirm",
      },
      sender,
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(setConnected).not.toHaveBeenCalled();
    expect(result).toMatchObject({ state: "disconnected", connected: false });
  });

  it("fails closed when no capability resolver is installed", async () => {
    const service = new EnteService({} as EnteSyncCoordinator);
    await expect(
      service.handle(
        {
          version: 1,
          kind: "ente.resolveConflict",
          capability: "capability-000000000000000000000000",
          choice: "keep-local",
        },
        sender,
      ),
    ).rejects.toMatchObject({ code: "ENTE_UNAVAILABLE" });
  });
});
