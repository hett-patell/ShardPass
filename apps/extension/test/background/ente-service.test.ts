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

  it("surfaces the last background failure and backs restarts off until a success", async () => {
    let lastAttemptAt: number | null = null;
    const service = new EnteService(
      {} as EnteSyncCoordinator,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => Promise.resolve({ connected: true, lastAttemptAt } as never),
    );
    await expect(service.shouldRunOnRestart(1_000_000)).resolves.toBe(true);
    service.noteFailure(
      Object.assign(new Error("x"), { code: "ENTE_UNAVAILABLE", detail: "/authenticator/key" }),
      1_000_000,
    );
    expect(service.snapshot().lastFailure).toEqual({
      code: "ENTE_UNAVAILABLE",
      detail: "/authenticator/key",
      at: 1_000_000,
    });
    await expect(service.shouldRunOnRestart(1_000_000 + 30_000)).resolves.toBe(false);
    await expect(service.shouldRunOnRestart(1_000_000 + 61_000)).resolves.toBe(true);
    service.noteFailure(new Error("again"), 1_100_000);
    await expect(service.shouldRunOnRestart(1_100_000 + 90_000)).resolves.toBe(false);
    service.noteSuccess();
    expect(service.snapshot().lastFailure).toBeUndefined();
    lastAttemptAt = 2_000_000;
    await expect(service.shouldRunOnRestart(2_000_000 + 5 * 60_000)).resolves.toBe(false);
    await expect(service.shouldRunOnRestart(2_000_000 + 16 * 60_000)).resolves.toBe(true);
  });

  it("answers connect as soon as the session is active, with the first sync running on its own", async () => {
    let finish: () => void = () => undefined;
    const trigger = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const activate = vi.fn(() => Promise.resolve());
    const service = new EnteService(
      { trigger } as unknown as EnteSyncCoordinator,
      undefined,
      undefined,
      () => Promise.resolve(),
      undefined,
      activate,
    );
    const sender = {
      extensionId: "x",
      contextKind: "vault",
      tabId: -1,
      frameId: -1,
      documentId: "d",
      senderUrl: "chrome-extension://x/vault/index.html",
    } as never;
    const reply = await service.handle(
      {
        version: 1,
        kind: "ente.connect",
        capability: "c".repeat(32),
        ciphertext: [1, 2, 3],
      } as never,
      sender,
    );
    expect(reply).toMatchObject({ connected: true, state: "syncing" });
    expect(trigger).toHaveBeenCalledWith("connected");
    finish();
  });

  it("reports syncing when a manual sync arrives during a running cycle", async () => {
    const trigger = vi.fn(() => Promise.resolve());
    const service = new EnteService({
      trigger,
      isRunning: () => true,
    } as unknown as EnteSyncCoordinator);
    const sender = {
      extensionId: "x",
      contextKind: "vault",
      tabId: -1,
      frameId: -1,
      documentId: "d",
      senderUrl: "chrome-extension://x/vault/index.html",
    } as never;
    const reply = await service.handle({ version: 1, kind: "ente.manualSync" } as never, sender);
    expect(reply.state).toBe("syncing");
    expect(trigger).toHaveBeenCalledWith("manual");
  });
});
