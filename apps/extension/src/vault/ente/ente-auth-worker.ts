/// <reference lib="webworker" />
import {
  EnteAuthWorkerRequestSchema,
  type EnteAuthWorkerResponse,
} from "./ente-auth-worker-protocol";

export function installEnteAuthWorker(
  scope: Pick<DedicatedWorkerGlobalScope, "addEventListener" | "postMessage" | "close">,
  execute: (
    request: ReturnType<typeof EnteAuthWorkerRequestSchema.parse>,
  ) => Promise<Exclude<EnteAuthWorkerResponse, { kind: "ente.auth.error" }>>,
): void {
  let usedPassword = false;
  scope.addEventListener("message", (event: MessageEvent<unknown>) => {
    let request: ReturnType<typeof EnteAuthWorkerRequestSchema.parse> | undefined;
    try {
      request = EnteAuthWorkerRequestSchema.parse(event.data);
    } catch {
      scope.postMessage({
        version: 1,
        kind: "ente.auth.error",
        jobId: crypto.randomUUID(),
        code: "ENTE_INVALID",
      } satisfies EnteAuthWorkerResponse);
      scope.close();
      return;
    }
    const current = request;
    if (current.kind === "ente.auth.password") {
      if (usedPassword) return;
      usedPassword = true;
    } else if (!usedPassword) return;
    void execute(current)
      .then(
        (result) => scope.postMessage(result),
        () => {
          scope.postMessage({
            version: 1,
            kind: "ente.auth.error",
            jobId: current.jobId,
            code: "ENTE_AUTH_FAILED",
          } satisfies EnteAuthWorkerResponse);
        },
      )
      .finally(() => {
        if (current.kind === "ente.auth.password") {
          current.emailUtf8.fill(0);
          current.passwordUtf8.fill(0);
        } else current.codeUtf8.fill(0);
        if (current.kind === "ente.auth.totp") scope.close();
      });
  });
}
