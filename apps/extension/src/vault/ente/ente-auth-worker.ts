/// <reference lib="webworker" />
import {
  EnteAuthWorkerRequestSchema,
  type EnteAuthWorkerResponse,
} from "./ente-auth-worker-protocol";

type WorkerErrorCode = Extract<EnteAuthWorkerResponse, { kind: "ente.auth.error" }>["code"];
const FORWARDED_CODES: ReadonlySet<string> = new Set<WorkerErrorCode>([
  "ENTE_INVALID",
  "ENTE_UNAVAILABLE",
  "ENTE_AUTH_FAILED",
  "ENTE_SRP_UNSUPPORTED",
  "ENTE_PROTOCOL_DRIFT",
  "ENTE_LIMIT_REACHED",
  "ENTE_REAUTH_REQUIRED",
]);

function describeFailure(jobId: string, failure: unknown): EnteAuthWorkerResponse {
  const code = (failure as { code?: unknown } | null)?.code;
  const detail = (failure as { detail?: unknown } | null)?.detail;
  const message = failure instanceof Error ? failure.message : "";
  return {
    version: 1,
    kind: "ente.auth.error",
    jobId,
    code:
      typeof code === "string" && FORWARDED_CODES.has(code)
        ? (code as WorkerErrorCode)
        : "ENTE_AUTH_FAILED",
    ...(typeof detail === "string" && detail !== ""
      ? { detail: detail.slice(0, 160) }
      : message !== "" && message !== "Ente protocol response rejected"
        ? { detail: message.slice(0, 160) }
        : {}),
  };
}

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
        (result) => {
          scope.postMessage(result);
          // The sign-in is complete; a failed code, by contrast, keeps the worker for a retry.
          if (current.kind === "ente.auth.totp") scope.close();
        },
        (failure: unknown) => {
          // Forward the real code and where it failed. Flattening everything to
          // ENTE_AUTH_FAILED made a network error, a rejected proof and a malformed
          // response indistinguishable from a wrong password.
          scope.postMessage(describeFailure(current.jobId, failure));
        },
      )
      .finally(() => {
        if (current.kind === "ente.auth.password") {
          current.emailUtf8.fill(0);
          current.passwordUtf8.fill(0);
        } else current.codeUtf8.fill(0);
      });
  });
}
