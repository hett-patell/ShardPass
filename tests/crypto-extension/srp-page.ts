async function run(): Promise<void> {
  const worker = new Worker(new URL("./ente-srp-worker.ts", import.meta.url), { type: "module" });
  try {
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (
          typeof event.data === "object" &&
          event.data !== null &&
          Reflect.get(event.data, "kind") === "ente-srp-passed"
        )
          resolve();
        else
          reject(
            new Error(
              `Ente SRP harness failed: ${String(Reflect.get(event.data as object, "reason"))}`,
            ),
          );
      };
      worker.onerror = (event) => reject(new Error(`Ente SRP harness failed: ${event.message}`));
    });
    document.body.dataset.srpStatus = "passed";
  } finally {
    worker.terminate();
  }
}

void run().catch((error: unknown) => {
  document.body.dataset.srpStatus = "failed";
  document.body.dataset.srpReason = error instanceof Error ? error.message : "unknown failure";
});
