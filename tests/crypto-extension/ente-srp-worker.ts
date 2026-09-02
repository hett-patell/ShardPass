import "../../apps/extension/src/background/ente/srp-compat/install-buffer-global";

void import("./ente-srp-runner")
  .then(({ runEnteSrpChecks }) => {
    runEnteSrpChecks();
    self.postMessage({ kind: "ente-srp-passed" });
  })
  .catch((error: unknown) => {
    self.postMessage({
      kind: "ente-srp-failed",
      reason: error instanceof Error ? error.message : "unknown failure",
    });
  });
