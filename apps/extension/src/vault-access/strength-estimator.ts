import { passwordStrength, type PasswordStrength, type StrengthLevel } from "./password-strength";
import type { StrengthWorkerRequest, StrengthWorkerResponse } from "./strength-worker-protocol";

export interface StrengthEstimate extends PasswordStrength {
  /** What an attacker's dictionaries and patterns make of it, when the estimator has run. */
  readonly advice?: string;
  readonly crackTime?: string;
  /** "quick" is the on-page arithmetic; "full" is zxcvbn in its worker. */
  readonly source: "quick" | "full";
}

export interface StrengthEstimator {
  estimate(password: string, userInputs?: readonly string[]): Promise<StrengthEstimate>;
  dispose(): void;
}

/** The same four levels the meter draws, from zxcvbn's five scores. */
function levelOf(score: StrengthWorkerResponse["score"]): StrengthLevel {
  return score <= 1 ? 0 : score === 2 ? 1 : score === 3 ? 2 : 3;
}

const LABELS = ["Too weak", "Weak", "Fair", "Strong"] as const;

/**
 * Estimates on a worker built as its own entry (assets/strength-worker-entry.js), started
 * once per page and reused. Where workers are not available (tests), the quick estimate
 * stands in, so a meter is never blank.
 */
export function createStrengthEstimator(
  startWorker: () => Worker | null = () =>
    typeof Worker === "undefined"
      ? null
      : new Worker("/assets/strength-worker-entry.js", { type: "module" }),
): StrengthEstimator {
  let worker: Worker | null | undefined;
  let nextId = 1;
  const pending = new Map<number, (response: StrengthWorkerResponse) => void>();
  const ensure = (): Worker | null => {
    if (worker !== undefined) return worker;
    try {
      worker = startWorker();
    } catch {
      worker = null;
    }
    if (worker !== null) {
      worker.onmessage = (event: MessageEvent<unknown>) => {
        const response = event.data as StrengthWorkerResponse | null;
        if (response?.version !== 1 || response.kind !== "estimate") return;
        const settle = pending.get(response.id);
        pending.delete(response.id);
        settle?.(response);
      };
      worker.onerror = () => {
        for (const settle of pending.values()) settle(null as unknown as StrengthWorkerResponse);
        pending.clear();
        worker?.terminate();
        worker = null;
      };
    }
    return worker;
  };
  return {
    estimate(password, userInputs = []) {
      const quick: StrengthEstimate = { ...passwordStrength(password), source: "quick" };
      if (password === "") return Promise.resolve(quick);
      const target = ensure();
      if (target === null) return Promise.resolve(quick);
      return new Promise<StrengthEstimate>((resolve) => {
        const id = nextId++;
        pending.set(id, (response) => {
          if (!response) {
            resolve(quick);
            return;
          }
          const level = levelOf(response.score);
          const advice = [response.warning, ...response.suggestions]
            .filter((part) => part !== "")
            .join(" ");
          resolve({
            bits: Math.round(response.guessesLog10 * Math.log2(10)),
            level,
            label: LABELS[level],
            ...(advice === "" ? {} : { advice }),
            crackTime: response.crackTime,
            source: "full",
          });
        });
        const request: StrengthWorkerRequest = {
          version: 1,
          kind: "estimate",
          id,
          password,
          userInputs,
        };
        target.postMessage(request);
      });
    },
    dispose() {
      worker?.terminate();
      worker = null;
      pending.clear();
    },
  };
}
