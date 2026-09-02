import "./srp-compat/install-buffer-global";

export type EnteSrpWorkerRequest = Readonly<{
  kind: "construct";
  usernameUtf8: Uint8Array;
  passwordKey: Uint8Array;
  salt: Uint8Array;
}>;

export type EnteSrpWorkerResponse =
  Readonly<{ kind: "constructed"; clientPublicA: Uint8Array }> | Readonly<{ kind: "rejected" }>;

/**
 * Dormant production-shaped entry: it has no registration, network, storage,
 * Chrome API, or import path from a runtime authority. Phase 2 may later add a
 * bounded owner; Phase 1 only proves the exact emitted cryptographic graph.
 */
self.onmessage = (event: MessageEvent<EnteSrpWorkerRequest>): void => {
  if (event.data.kind !== "construct") {
    self.postMessage({ kind: "rejected" } satisfies EnteSrpWorkerResponse);
    return;
  }
  void import("./srp-adapter")
    .then(({ createEnteSrpClient }) => {
      const client = createEnteSrpClient(event.data);
      try {
        self.postMessage({
          kind: "constructed",
          clientPublicA: client.clientPublicA(),
        } satisfies EnteSrpWorkerResponse);
      } finally {
        client.dispose();
      }
    })
    .catch(() => {
      self.postMessage({ kind: "rejected" } satisfies EnteSrpWorkerResponse);
    });
};
