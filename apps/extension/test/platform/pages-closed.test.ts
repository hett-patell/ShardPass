import { afterEach, describe, expect, it, vi } from "vitest";

import { createChromePlatform } from "../../src/platform/chrome-platform";

type Port = {
  name: string;
  sender: { id: string; url: string; documentId: string };
  onMessage: { addListener: (fn: unknown) => void; removeListener: (fn: unknown) => void };
  onDisconnect: { addListener: (fn: () => void) => void; removeListener: (fn: () => void) => void };
  postMessage: (value: unknown) => void;
  disconnect: () => void;
};

function stubChrome() {
  let onConnect: ((port: Port) => void) | undefined;
  const area = () => ({
    get: vi.fn(() => Promise.resolve({})),
    set: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
    getKeys: vi.fn(() => Promise.resolve([])),
    setAccessLevel: vi.fn(() => Promise.resolve()),
  });
  vi.stubGlobal("chrome", {
    runtime: {
      id: "test-extension",
      lastError: undefined,
      getURL: (path: string) => `chrome-extension://test-extension/${path}`,
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      onConnect: {
        addListener: vi.fn((next: (port: Port) => void) => {
          onConnect = next;
        }),
        removeListener: vi.fn(),
      },
      sendMessage: vi.fn(),
      getContexts: vi.fn(() => Promise.resolve([])),
    },
    storage: {
      local: area(),
      session: area(),
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    alarms: {
      create: vi.fn(),
      clear: vi.fn(() => Promise.resolve(true)),
      get: vi.fn(() => Promise.resolve(undefined)),
      onAlarm: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    idle: { onStateChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    commands: { onCommand: { addListener: vi.fn(), removeListener: vi.fn() } },
    tabs: { query: vi.fn(), sendMessage: vi.fn(), create: vi.fn(), update: vi.fn() },
    windows: { update: vi.fn() },
  });
  const connect = (name = "shardpass:v1:vault-state"): (() => void) => {
    let onDisconnect: (() => void) | undefined;
    const port: Port = {
      name,
      sender: {
        id: "test-extension",
        url: "chrome-extension://test-extension/popup/index.html",
        documentId: "doc",
      },
      onMessage: { addListener: () => undefined, removeListener: () => undefined },
      onDisconnect: {
        addListener: (fn) => {
          onDisconnect = fn;
        },
        removeListener: () => undefined,
      },
      postMessage: () => undefined,
      disconnect: () => undefined,
    };
    onConnect?.(port);
    return () => onDisconnect?.();
  };
  return { connect };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("lock when ShardPass closes: page presence", () => {
  it("fires once the last page has been gone for the grace period, not while a page comes straight back", () => {
    vi.useFakeTimers();
    const { connect } = stubChrome();
    const platform = createChromePlatform();
    const closed = vi.fn();
    platform.onVaultPagesClosed?.(closed);
    platform.onVaultStatePort(() => () => undefined);

    const disconnectPopup = connect();
    disconnectPopup();
    // The popup handed over to the vault page within the grace: no lock.
    vi.advanceTimersByTime(500);
    const disconnectVault = connect();
    vi.advanceTimersByTime(2_000);
    expect(closed).not.toHaveBeenCalled();

    disconnectVault();
    vi.advanceTimersByTime(1_499);
    expect(closed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(closed).toHaveBeenCalledTimes(1);
  });
});
