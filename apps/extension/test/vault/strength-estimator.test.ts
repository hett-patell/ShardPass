import { describe, expect, it } from "vitest";

import {
  clearStrengthCache,
  createStrengthEstimator,
} from "../../src/vault-access/strength-estimator";
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

describe("judgements already made", () => {
  it("answers a repeated password from the cache instead of the worker, until the vault locks", async () => {
    let asked = 0;
    const worker = {
      onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
      onerror: null,
      postMessage(message: unknown) {
        asked += 1;
        const { id } = message as { id: number };
        queueMicrotask(() =>
          this.onmessage?.({
            data: {
              version: 1,
              kind: "estimate",
              id,
              score: 1,
              guessesLog10: 6,
              crackTime: "minutes",
              warning: "",
              suggestions: [],
            },
          } as MessageEvent<unknown>),
        );
      },
      terminate() {},
    };
    const estimator = createStrengthEstimator(() => worker as unknown as Worker);
    const first = await estimator.estimate("repeated-password", ["alice"]);
    const second = await estimator.estimate("repeated-password", ["alice"]);
    expect(second).toEqual(first);
    expect(asked).toBe(1);

    // A different set of user inputs is a different judgement.
    await estimator.estimate("repeated-password", ["bob"]);
    expect(asked).toBe(2);

    clearStrengthCache();
    await estimator.estimate("repeated-password", ["alice"]);
    expect(asked).toBe(3);
  });
});
