import sodium from "libsodium-wrappers-sumo";

export type EnteSodiumWorkerResponse = Readonly<{
  kind: "ready" | "rejected";
}>;

/**
 * Dormant production-shaped entry with no manifest registration or runtime owner.
 * Phase 1 packages the exact sodium runtime solely for identity/output scanning.
 */
self.onmessage = (): void => {
  void sodium.ready.then(
    () => self.postMessage({ kind: "ready" } satisfies EnteSodiumWorkerResponse),
    () => self.postMessage({ kind: "rejected" } satisfies EnteSodiumWorkerResponse),
  );
};
