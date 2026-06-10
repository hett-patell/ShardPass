/** Minimal chrome.* mock sufficient to load and exercise the background
 * service worker in a Node test environment. Install BEFORE importing
 * `@/background/index` (use a dynamic import). */

type MessageListener = (
  msg: unknown,
  sender: unknown,
  sendResponse: (res: unknown) => void,
) => boolean;

export interface ChromeMock {
  local: Map<string, unknown>;
  session: Map<string, unknown>;
  sendMessage<T = unknown>(
    msg: unknown,
  ): Promise<{ ok: true; data: T } | { ok: false; error: string }>;
}

function makeArea(store: Map<string, unknown>) {
  return {
    async get(key: string | string[]) {
      const keys = Array.isArray(key) ? key : [key];
      const out: Record<string, unknown> = {};
      for (const k of keys) if (store.has(k)) out[k] = store.get(k);
      return out;
    },
    async set(items: Record<string, unknown>) {
      for (const [k, v] of Object.entries(items)) store.set(k, v);
    },
    async remove(key: string | string[]) {
      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) store.delete(k);
    },
    async setAccessLevel() {},
  };
}

export function installChromeMock(): ChromeMock {
  const local = new Map<string, unknown>();
  const session = new Map<string, unknown>();
  const messageListeners: MessageListener[] = [];

  (globalThis as Record<string, unknown>).chrome = {
    storage: { local: makeArea(local), session: makeArea(session) },
    alarms: {
      async create() {},
      async clear() {
        return true;
      },
      onAlarm: { addListener() {} },
    },
    idle: { onStateChanged: { addListener() {} } },
    runtime: {
      onMessage: {
        addListener(fn: MessageListener) {
          messageListeners.push(fn);
        },
      },
    },
  };

  return {
    local,
    session,
    sendMessage(msg) {
      return new Promise((resolve) => {
        const listener = messageListeners[0];
        if (!listener) throw new Error("background did not register a message listener");
        listener(msg, { url: "popup" }, (res) => resolve(res as never));
      });
    },
  };
}
