import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { normalizeSenderContext, type BackupRequest } from "@shardpass/messaging";
import type {
  BackupUiExtensionPlatform,
  ExtensionPlatform,
  LoginFillContentPlatform,
  OtpFillContentPlatform,
  OtpImportUiExtensionPlatform,
} from "../../src/platform/extension-platform";

import { routeMessage } from "../../src/background/router";
import { createChromePlatform } from "../../src/platform/chrome-platform";

type RuntimeListener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("Chrome extension platform", () => {
  let listener: RuntimeListener | undefined;
  const addListener = vi.fn((next: RuntimeListener) => {
    listener = next;
  });
  const removeListener = vi.fn();
  const sendMessage = vi.fn();
  const tabsCreate = vi.fn();
  const localValues: Record<string, unknown> = {};
  const sessionValues: Record<string, unknown> = {};
  const localSetAccessLevel = vi.fn().mockResolvedValue(undefined);
  const sessionSetAccessLevel = vi.fn().mockResolvedValue(undefined);
  let runtimeStub: {
    id: string;
    lastError: { message: string } | undefined;
    getURL(path: string): string;
    onMessage: { addListener: typeof addListener; removeListener: typeof removeListener };
    sendMessage: typeof sendMessage;
  };

  beforeEach(() => {
    listener = undefined;
    addListener.mockClear();
    removeListener.mockClear();
    sendMessage.mockReset();
    tabsCreate.mockReset();

    runtimeStub = {
      id: "runtime-owned-extension-id",
      lastError: undefined,
      getURL: (path: string) => `chrome-extension://runtime-owned-extension-id/${path}`,
      onMessage: { addListener, removeListener },
      sendMessage,
    };
    for (const key of Object.keys(localValues)) delete localValues[key];
    for (const key of Object.keys(sessionValues)) delete sessionValues[key];
    localSetAccessLevel.mockClear();
    sessionSetAccessLevel.mockClear();
    const area = (values: Record<string, unknown>) => ({
      get: vi.fn((keys: string[] | null) =>
        Promise.resolve(
          keys === null
            ? structuredClone(values)
            : Object.fromEntries(
                keys
                  .filter((key) => key in values)
                  .map((key) => [key, structuredClone(values[key])]),
              ),
        ),
      ),
      set: vi.fn((input: Record<string, unknown>) => {
        Object.assign(values, structuredClone(input));
        return Promise.resolve();
      }),
      remove: vi.fn((keys: string[]) => {
        keys.forEach((key) => delete values[key]);
        return Promise.resolve();
      }),
    });
    vi.stubGlobal("chrome", {
      runtime: runtimeStub,
      tabs: { create: tabsCreate },
      storage: {
        local: { ...area(localValues), setAccessLevel: localSetAccessLevel },
        session: { ...area(sessionValues), setAccessLevel: sessionSetAccessLevel },
      },
      alarms: {
        create: vi.fn(() => Promise.resolve()),
        clear: vi.fn(() => Promise.resolve(true)),
        onAlarm: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      idle: { onStateChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restricts session storage and exposes bounded local/session ports", async () => {
    const platform = createChromePlatform();
    await platform.initializeTrustedStorage();
    expect(localSetAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });
    expect(sessionSetAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });
    await platform.localStorage.set({ alpha: "one", beta: 2 });
    await expect(platform.localStorage.get(["alpha"])).resolves.toEqual({ alpha: "one" });
    await expect(platform.localStorage.listKeys("a")).resolves.toEqual({
      keys: ["alpha"],
      complete: true,
    });
  });

  it("returns true synchronously, replies asynchronously, and removes the same listener", async () => {
    const platform = createChromePlatform();
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const dispose = platform.onMessage(handler);
    const sendResponse = vi.fn();

    expect(
      listener?.(
        { version: 1, kind: "foundation.getStatus" },
        {
          id: "browser-sender-id",
          url: "https://example.test/login",
          tab: { id: 7 } as chrome.tabs.Tab,
          frameId: 0,
          documentId: "document-id",
        },
        sendResponse,
      ),
    ).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });
    expect(handler).toHaveBeenCalledWith(
      { version: 1, kind: "foundation.getStatus" },
      {
        extensionId: "browser-sender-id",
        senderUrl: "https://example.test/login",
        tabId: 7,
        frameId: 0,
        documentId: "document-id",
      },
    );

    dispose();
    dispose();
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith(listener);
  });

  it("passes null instead of inventing sender metadata when browser identity is incomplete", async () => {
    const platform = createChromePlatform();
    const handler = vi.fn().mockResolvedValue({ ok: false });
    platform.onMessage(handler);

    listener?.({}, { url: "https://example.test/login" }, vi.fn());

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledWith({}, null);
    });
  });

  it.each([
    [
      "vault with complete tab identity",
      {
        id: "runtime-owned-extension-id",
        url: "chrome-extension://runtime-owned-extension-id/vault/index.html",
        tab: { id: 7 } as chrome.tabs.Tab,
        frameId: 0,
        documentId: "vault-document-id",
      },
    ],
    [
      "popup with document identity",
      {
        id: "runtime-owned-extension-id",
        url: "chrome-extension://runtime-owned-extension-id/popup/index.html",
        documentId: "popup-document-id",
      },
    ],
  ] as const)(
    "authorizes %s from Chrome sender extraction through routing",
    async (_label, sender) => {
      const platform = createChromePlatform();
      platform.onMessage(async (payload, metadata) =>
        routeMessage(
          payload,
          normalizeSenderContext(metadata, platform.extensionId),
          platform.extensionId,
        ),
      );
      const sendResponse = vi.fn();

      listener?.({ version: 1, kind: "foundation.getStatus" }, sender, sendResponse);

      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalledWith({
          version: 1,
          kind: "foundation.status",
          phase: "foundation",
          vaultAvailable: false,
        });
      });
    },
  );

  it.each([
    [
      "foreign extension ID",
      {
        id: "foreign-extension-id",
        url: "chrome-extension://runtime-owned-extension-id/vault/index.html",
        tab: { id: 7 } as chrome.tabs.Tab,
        frameId: 0,
        documentId: "document-id",
      },
    ],
    [
      "unapproved extension URL",
      {
        id: "runtime-owned-extension-id",
        url: "chrome-extension://runtime-owned-extension-id/settings/index.html",
        tab: { id: 7 } as chrome.tabs.Tab,
        frameId: 0,
        documentId: "document-id",
      },
    ],
    [
      "malformed optional identity",
      {
        id: "runtime-owned-extension-id",
        url: "chrome-extension://runtime-owned-extension-id/popup/index.html",
        frameId: -1,
        documentId: "document-id",
      },
    ],
  ] as const)(
    "rejects %s from Chrome sender extraction through routing",
    async (_label, sender) => {
      const platform = createChromePlatform();
      platform.onMessage(async (payload, metadata) =>
        routeMessage(
          payload,
          normalizeSenderContext(metadata, platform.extensionId),
          platform.extensionId,
        ),
      );
      const sendResponse = vi.fn();

      listener?.({ version: 1, kind: "foundation.getStatus" }, sender, sendResponse);

      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalledWith({
          version: 1,
          kind: "error",
          error: {
            code: "UNAUTHORIZED_SENDER",
            message: "This action is not allowed here.",
          },
        });
      });
    },
  );

  it("bridges callback runtime messages to promises and rejects lastError safely", async () => {
    const platform = createChromePlatform();
    sendMessage.mockImplementationOnce((_payload: unknown, callback: (value: unknown) => void) => {
      callback({ ok: true });
    });

    await expect(platform.sendMessage({ request: true })).resolves.toEqual({ ok: true });

    sendMessage.mockImplementationOnce((_payload: unknown, callback: (value: unknown) => void) => {
      runtimeStub.lastError = { message: "runtime failed" };
      callback(undefined);
      runtimeStub.lastError = undefined;
    });
    await expect(platform.sendMessage({ request: false })).rejects.toThrow("runtime failed");
  });

  it("clones an import request synchronously before the caller clears candidate ownership", async () => {
    const platform = createChromePlatform();
    let transportReference: unknown;
    let complete!: (value: unknown) => void;
    sendMessage.mockImplementationOnce((payload: unknown, callback: (value: unknown) => void) => {
      transportReference = payload;
      complete = callback;
    });
    const candidates = [
      {
        sourceOrdinal: 1,
        issuer: "Synthetic",
        label: "Account",
        secret: "JBSWY3DPEHPK3PXP",
        otpType: "totp" as const,
        algorithm: "SHA1" as const,
        digits: 6,
        period: 30,
        favorite: false,
        tags: [],
        note: "",
      },
    ];
    const request = {
      version: 1 as const,
      kind: "otp.importPreview" as const,
      format: "otpauth" as const,
      candidates,
    };
    const pending = platform.sendOtpImportMessage(request);
    candidates.splice(0);
    expect((transportReference as { candidates: unknown[] }).candidates).toHaveLength(1);
    expect(transportReference).not.toBe(request);
    complete({
      version: 1,
      kind: "otp.importPreviewResult",
      previewToken: "01234567-89ab-4def-8123-456789abcdef",
      format: "otpauth",
      rows: [
        {
          rowId: "fedcba98-7654-4abc-9234-fedcba987654",
          ordinal: 1,
          status: "accepted",
          reason: "IMPORT_ACCEPTED",
          metadata: {
            issuer: "Synthetic",
            label: "Account",
            otpType: "totp",
            algorithm: "SHA1",
            digits: 6,
            period: 30,
          },
        },
      ],
      accepted: 1,
      duplicate: 0,
      rejected: 0,
      expiresAt: 300000,
    });
    await expect(pending).resolves.toMatchObject({ kind: "otp.importPreviewResult" });
  });

  it("sends strict typed OTP import requests and reparses command-bound responses", async () => {
    const platform = createChromePlatform();
    const request = {
      version: 1,
      kind: "otp.importConfirm",
      previewToken: "01234567-89ab-4def-8123-456789abcdef",
    } as const;
    sendMessage.mockImplementationOnce((_payload: unknown, callback: (value: unknown) => void) => {
      callback({ version: 1, kind: "otp.importConfirmed", imported: 2, duplicate: 1 });
    });
    await expect(platform.sendOtpImportMessage(request)).resolves.toEqual({
      version: 1,
      kind: "otp.importConfirmed",
      imported: 2,
      duplicate: 1,
    });
    sendMessage.mockImplementationOnce((_payload: unknown, callback: (value: unknown) => void) => {
      callback({ version: 1, kind: "otp.importCancelled", cancelled: true });
    });
    await expect(platform.sendOtpImportMessage(request)).rejects.toMatchObject({
      code: "OTP_IMPORT_UNAVAILABLE",
    });
  });

  it("sends typed OTP requests and rejects malformed or background-error responses safely", async () => {
    const platform = createChromePlatform();
    const request = { version: 1, kind: "otp.list", query: "" } as const;
    sendMessage.mockImplementationOnce((_payload: unknown, callback: (value: unknown) => void) => {
      callback({ version: 1, kind: "otp.listResult", items: [] });
    });
    await expect(platform.sendOtpMessage(request)).resolves.toEqual({
      version: 1,
      kind: "otp.listResult",
      items: [],
    });
    expect(sendMessage).toHaveBeenCalledWith(request, expect.any(Function));

    sendMessage.mockImplementationOnce((_payload: unknown, callback: (value: unknown) => void) => {
      callback({
        version: 1,
        kind: "otp.editorResult",
        item: {
          id: "01234567-89ab-4def-8123-456789abcdef",
          revision: 1,
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
      });
    });
    await expect(platform.sendOtpMessage(request)).rejects.toMatchObject({
      code: "VAULT_UNAVAILABLE",
      message: "The vault could not be verified.",
    });

    sendMessage.mockImplementationOnce((_payload: unknown, callback: (value: unknown) => void) => {
      callback({ version: 1, kind: "otp.listResult", items: [], arbitrary: "forbidden" });
    });
    await expect(platform.sendOtpMessage(request)).rejects.toMatchObject({
      code: "VAULT_UNAVAILABLE",
      message: "The vault could not be verified.",
    });

    sendMessage.mockImplementationOnce((_payload: unknown, callback: (value: unknown) => void) => {
      callback({
        version: 1,
        kind: "error",
        error: { code: "VAULT_LOCKED", message: "forged" },
      });
    });
    await expect(platform.sendOtpMessage(request)).rejects.toMatchObject({
      code: "VAULT_LOCKED",
      message: "Unlock the vault to continue.",
    });
  });

  it("keeps the code and detail of a background Ente failure, and names a lost reply", async () => {
    const platform = createChromePlatform();
    const request = { version: 1, kind: "ente.manualSync" } as const;

    sendMessage.mockImplementationOnce((_payload: unknown, callback: (value: unknown) => void) => {
      callback({
        version: 1,
        kind: "error",
        error: {
          code: "ENTE_PROTOCOL_DRIFT",
          message: "fixed copy",
          detail: "GET /authenticator/entity/diff -> unexpected response shape",
        },
      });
    });
    await expect(platform.sendEnteMessage(request)).rejects.toMatchObject({
      code: "ENTE_PROTOCOL_DRIFT",
      detail: "GET /authenticator/entity/diff -> unexpected response shape",
    });

    sendMessage.mockImplementationOnce(() => {
      throw new Error("The message port closed before a response was received.");
    });
    await expect(platform.sendEnteMessage(request)).rejects.toMatchObject({
      code: "ENTE_UNAVAILABLE",
      detail: expect.stringContaining("no reply from the background") as unknown,
    });

    sendMessage.mockImplementationOnce((_payload: unknown, callback: (value: unknown) => void) => {
      callback({ version: 1, kind: "ente.state", state: "idle" });
    });
    await expect(platform.sendEnteMessage(request)).rejects.toMatchObject({
      code: "ENTE_UNAVAILABLE",
      detail: "unexpected reply shape from the background",
    });
  });

  it("sends typed backup messages with exact response pairing and fixed failures", async () => {
    const platform = createChromePlatform();
    const request: BackupRequest = { version: 1, kind: "backup.beginExportStepUp" };
    sendMessage.mockImplementationOnce((_payload: unknown, callback: (value: unknown) => void) => {
      callback({
        version: 1,
        kind: "backup.exportStepUpChallenge",
        challengeId: "0123456789abcdef0123456789abcdef",
        kdf: {
          algorithm: "argon2id",
          salt: "AQEBAQEBAQEBAQEBAQEBAQ==",
          memoryKiB: 65_536,
          iterations: 3,
          parallelism: 1,
        },
        expiresAt: 300_000,
      });
    });
    await expect(platform.sendBackupMessage(request)).resolves.toMatchObject({
      kind: "backup.exportStepUpChallenge",
    });
    expect(sendMessage).toHaveBeenCalledWith(request, expect.any(Function));

    sendMessage.mockImplementationOnce((_payload: unknown, callback: (value: unknown) => void) => {
      callback({ version: 1, kind: "backup.importCancelled", cancelled: true });
    });
    await expect(platform.sendBackupMessage(request)).rejects.toMatchObject({
      code: "BACKUP_UNAVAILABLE",
      message: "The backup could not be verified. Try again.",
    });

    sendMessage.mockImplementationOnce((_payload: unknown, callback: (value: unknown) => void) => {
      callback({ version: 1, kind: "error", error: { code: "BACKUP_EXPIRED", message: "forged" } });
    });
    await expect(platform.sendBackupMessage(request)).rejects.toMatchObject({
      code: "BACKUP_EXPIRED",
      message: "That backup authorization expired. Try again.",
    });
  });

  it("does not widen popup or OTP-import platform authority with backup transport", () => {
    type PopupAuthority = "sendBackupMessage" extends keyof ExtensionPlatform ? true : false;
    type ImportAuthority = "sendBackupMessage" extends keyof OtpImportUiExtensionPlatform
      ? true
      : false;
    const popupAuthority: PopupAuthority = false;
    const importAuthority: ImportAuthority = false;
    expect(popupAuthority).toBe(false);
    expect(importAuthority).toBe(false);
    expectTypeOf<BackupUiExtensionPlatform>().toHaveProperty("sendBackupMessage");
  });

  it("starts a promise-backed authoritative clipboard write synchronously without retaining values", async () => {
    const authoritative = deferred<string>();
    const payloads: string[] = [];
    const write = vi.fn((items: ClipboardItem[]) =>
      items[0]!.getType("text/plain").then(async (blob) => {
        payloads.push(await blob.text());
      }),
    );
    class TestClipboardItem {
      readonly types = ["text/plain"];
      constructor(private readonly values: Record<string, Promise<Blob>>) {}
      getType(type: string): Promise<Blob> {
        return this.values[type]!;
      }
    }
    vi.stubGlobal("ClipboardItem", TestClipboardItem);
    vi.stubGlobal("navigator", { clipboard: { write } });
    const platform = createChromePlatform();

    const operation = platform.writeAuthoritativeClipboardText(authoritative.promise);
    expect(write).toHaveBeenCalledTimes(1);
    expect(payloads).toEqual([]);
    authoritative.resolve("temporary-value");
    await expect(operation).resolves.toBeUndefined();
    expect(payloads).toEqual(["temporary-value"]);
  });

  it("fails closed when deferred clipboard write support is absent or rejects", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    vi.stubGlobal("navigator", { clipboard: { write: vi.fn() } });
    const platform = createChromePlatform();
    await expect(
      platform.writeAuthoritativeClipboardText(Promise.resolve("temporary-value")),
    ).rejects.toMatchObject({
      code: "CLIPBOARD_UNAVAILABLE",
      message: "Copy failed. Try again.",
    });

    const write = vi.fn().mockRejectedValue(new Error("forbidden detail"));
    vi.stubGlobal("ClipboardItem", class TestClipboardItem {});
    vi.stubGlobal("navigator", { clipboard: { write } });
    await expect(
      platform.writeAuthoritativeClipboardText(Promise.resolve("temporary-value")),
    ).rejects.toMatchObject({
      code: "CLIPBOARD_UNAVAILABLE",
      message: "Copy failed. Try again.",
    });
  });

  it("exposes a typed OTP fill transport that reparses exact paired responses", async () => {
    const platform: OtpFillContentPlatform = createChromePlatform();
    const request = {
      version: 1 as const,
      kind: "otp.fillSuggestions" as const,
      requestId: "request_0123456789abcdef",
      fieldHandle: "field_0123456789abcdef",
    };
    sendMessage.mockImplementation((_payload: unknown, callback: (response: unknown) => void) =>
      callback({
        version: 1,
        kind: "otp.fillSuggestionsResult",
        capability: "capability_0123456789abcdef",
        expiresAt: 301_000,
        suggestions: [],
      }),
    );
    await expect(platform.sendOtpFillMessage(request)).resolves.toMatchObject({
      kind: "otp.fillSuggestionsResult",
    });
    expect(sendMessage).toHaveBeenCalledWith(request, expect.any(Function));

    sendMessage.mockImplementation((_payload: unknown, callback: (response: unknown) => void) =>
      callback({ version: 1, kind: "otp.fillCancelled", cancelled: true }),
    );
    await expect(platform.sendOtpFillMessage(request)).rejects.toMatchObject({
      code: "OTP_FILL_UNAVAILABLE",
    });
  });

  it("exposes a typed login fill transport that reparses exact paired responses", async () => {
    const platform: LoginFillContentPlatform = createChromePlatform();
    const request = {
      version: 1 as const,
      kind: "login.fillSuggestions" as const,
      domain: "example.test",
    };
    sendMessage.mockImplementation((_payload: unknown, callback: (response: unknown) => void) =>
      callback({ version: 1, kind: "login.fillSuggestionsResult", suggestions: [] }),
    );
    await expect(platform.sendLoginFillMessage(request)).resolves.toMatchObject({
      kind: "login.fillSuggestionsResult",
    });
    expect(sendMessage).toHaveBeenCalledWith(request, expect.any(Function));

    sendMessage.mockImplementation((_payload: unknown, callback: (response: unknown) => void) =>
      callback({ version: 1, kind: "login.fillAck", ok: true }),
    );
    await expect(platform.sendLoginFillMessage(request)).rejects.toMatchObject({
      code: "LOGIN_FILL_UNAVAILABLE",
    });
  });

  it("opens the exact vault URL through a callback and rejects lastError", async () => {
    const platform = createChromePlatform();
    tabsCreate.mockImplementationOnce(
      (_properties: chrome.tabs.CreateProperties, callback: () => void) => {
        callback();
      },
    );

    await expect(platform.openVaultPage()).resolves.toBeUndefined();
    expect(tabsCreate).toHaveBeenCalledWith(
      { url: "chrome-extension://runtime-owned-extension-id/vault/index.html" },
      expect.any(Function),
    );

    tabsCreate.mockImplementationOnce(
      (_properties: chrome.tabs.CreateProperties, callback: () => void) => {
        runtimeStub.lastError = { message: "tab failed" };
        callback();
        runtimeStub.lastError = undefined;
      },
    );
    await expect(platform.openVaultPage()).rejects.toThrow("tab failed");
  });

  it("finds the vault tab through runtime.getContexts and only activates it when there is no target", async () => {
    const platform = createChromePlatform();
    const getContexts = vi.fn((_filter: unknown, callback: (contexts: unknown[]) => void) =>
      callback([
        { contextType: "POPUP", documentUrl: "chrome-extension://runtime-owned-extension-id/popup/index.html", tabId: -1, windowId: 1 },
        { contextType: "TAB", documentUrl: "chrome-extension://runtime-owned-extension-id/vault/index.html", tabId: 4, windowId: 3 },
      ]),
    );
    (runtimeStub as unknown as Record<string, unknown>).getContexts = getContexts;
    const tabsUpdate = vi.fn((_id: number, _properties: unknown, callback: () => void) => callback());
    (chrome.tabs as unknown as Record<string, unknown>).update = tabsUpdate;
    try {
      await expect(platform.openVaultPage()).resolves.toBeUndefined();
      expect(getContexts).toHaveBeenCalledWith(
        { contextTypes: ["TAB"], documentOrigins: ["chrome-extension://runtime-owned-extension-id"] },
        expect.any(Function),
      );
      // No target: the tab is focused, never navigated, so nothing in it is lost to a reload.
      expect(tabsUpdate).toHaveBeenCalledWith(4, { active: true }, expect.any(Function));
      expect(tabsCreate).not.toHaveBeenCalled();
    } finally {
      delete (runtimeStub as unknown as Record<string, unknown>).getContexts;
    }
  });

  it("moves an already-open vault tab to the target instead of opening a second one", async () => {
    const platform = createChromePlatform();
    const tabsQuery = vi.fn((_query: unknown, callback: (tabs: chrome.tabs.Tab[]) => void) => {
      callback([{ id: 9, windowId: 2 } as chrome.tabs.Tab]);
    });
    const tabsUpdate = vi.fn((_id: number, _properties: unknown, callback: () => void) => callback());
    const windowsUpdate = vi.fn((_id: number, _properties: unknown, callback: () => void) => callback());
    const tabs = chrome.tabs as unknown as Record<string, unknown>;
    tabs.query = tabsQuery;
    tabs.update = tabsUpdate;
    (chrome as unknown as Record<string, unknown>).windows = { update: windowsUpdate };

    await expect(platform.openVaultPage({ view: "settings" })).resolves.toBeUndefined();
    expect(tabsQuery).toHaveBeenCalledWith(
      { url: "chrome-extension://runtime-owned-extension-id/vault/index.html*" },
      expect.any(Function),
    );
    expect(tabsUpdate).toHaveBeenCalledWith(
      9,
      { url: "chrome-extension://runtime-owned-extension-id/vault/index.html#/settings", active: true },
      expect.any(Function),
    );
    expect(windowsUpdate).toHaveBeenCalledWith(2, { focused: true }, expect.any(Function));
    expect(tabsCreate).not.toHaveBeenCalled();

    tabsQuery.mockImplementationOnce((_query: unknown, callback: (tabs: chrome.tabs.Tab[]) => void) => callback([]));
    tabsCreate.mockImplementationOnce((_properties: chrome.tabs.CreateProperties, callback: () => void) => callback());
    await expect(platform.openVaultPage({ newItem: "login" })).resolves.toBeUndefined();
    expect(tabsCreate).toHaveBeenCalledWith(
      { url: "chrome-extension://runtime-owned-extension-id/vault/index.html#/new/login" },
      expect.any(Function),
    );
  });
});
