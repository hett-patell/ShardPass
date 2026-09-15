import { describe, expect, it } from "vitest";

import { createStrengthEstimator } from "../../src/vault-access/strength-estimator";
import type {
  StrengthWorkerRequest,
  StrengthWorkerResponse,
} from "../../src/vault-access/strength-worker-protocol";

function fakeWorker(
  answer: (request: StrengthWorkerRequest) => Partial<StrengthWorkerResponse>,
): Worker {
  const worker = {
    onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    postMessage(message: StrengthWorkerRequest) {
      const response: StrengthWorkerResponse = {
        version: 1,
        kind: "estimate",
        id: message.id,
        score: 4,
        guessesLog10: 12,
        crackTime: "centuries",
        warning: "",
        suggestions: [],
        ...answer(message),
      };
      queueMicrotask(() => worker.onmessage?.({ data: response } as MessageEvent<unknown>));
    },
    terminate() {
      // nothing to stop
    },
  };
  return worker as unknown as Worker;
}

describe("strength estimator", () => {
  it("turns the worker's verdict into the meter's levels, with its advice", async () => {
    const estimator = createStrengthEstimator(() =>
      fakeWorker((request) =>
        request.password === "Password123!"
          ? {
              score: 1,
              guessesLog10: 4.2,
              warning: "This is similar to a commonly used password.",
              suggestions: ["Add another word or two."],
            }
          : {},
      ),
    );
    expect(await estimator.estimate("Password123!")).toMatchObject({
      level: 0,
      label: "Too weak",
      source: "full",
      advice: "This is similar to a commonly used password. Add another word or two.",
    });
    expect(await estimator.estimate("correct horse battery staple")).toMatchObject({
      level: 3,
      label: "Strong",
      source: "full",
    });
    estimator.dispose();
  });

  it("falls back to the quick estimate without a worker, and for an empty password", async () => {
    const estimator = createStrengthEstimator(() => null);
    expect(await estimator.estimate("")).toMatchObject({ level: 0, source: "quick" });
    expect(await estimator.estimate("correct horse battery staple")).toMatchObject({
      source: "quick",
    });
  });
});
