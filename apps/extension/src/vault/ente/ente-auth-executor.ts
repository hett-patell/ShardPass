import { EnteProtocolError } from "../../background/ente/protocol";
import {
  EnteAuthWorkerResponseSchema,
  type EnteAuthWorkerRequest,
  type EnteAuthWorkerResponse,
} from "./ente-auth-worker-protocol";

export type EnteAuthWorkerPort = Pick<
  Worker,
  "postMessage" | "terminate" | "onmessage" | "onerror"
>;

export function createEnteAuthWorker(): Worker {
  return new Worker("/assets/ente-auth-worker-entry.js", { type: "module" });
}

export async function executeEnteAuthWorker(input: {
  readonly worker: EnteAuthWorkerPort;
  readonly request: EnteAuthWorkerRequest;
  readonly signal: AbortSignal;
  readonly keepAliveOnTotp?: boolean;
}): Promise<EnteAuthWorkerResponse> {
  const transferred: Transferable[] = [];
  if (input.request.kind === "ente.auth.password")
    transferred.push(input.request.emailUtf8.buffer, input.request.passwordUtf8.buffer);
  else transferred.push(input.request.codeUtf8.buffer);
  return new Promise((resolve, reject) => {
    const cleanup = (terminate = true) => {
      input.signal.removeEventListener("abort", abort);
      if (terminate) input.worker.terminate();
    };
    const abort = () => {
      cleanup();
      reject(new EnteProtocolError("ENTE_UNAVAILABLE"));
    };
    input.signal.addEventListener("abort", abort, { once: true });
    input.worker.onmessage = (event) => {
      try {
        const parsed = EnteAuthWorkerResponseSchema.parse(event.data);
        if (parsed.jobId !== input.request.jobId) throw new Error();
        cleanup(!(input.keepAliveOnTotp && parsed.kind === "ente.auth.totp-required"));
        if (parsed.kind === "ente.auth.error") reject(new EnteProtocolError(parsed.code));
        else resolve(parsed);
      } catch {
        cleanup();
        reject(new EnteProtocolError("ENTE_INVALID"));
      }
    };
    input.worker.onerror = () => {
      cleanup();
      reject(new EnteProtocolError("ENTE_AUTH_FAILED"));
    };
    input.worker.postMessage(input.request, transferred);
  });
}
