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
/**
 * Judgements already made, shared by every estimator on the page and keyed by the password
 * that produced them. The health page and the dashboard each mount their own estimator and
 * each unmounts on the way out, so without this a vault of a thousand logins is judged again
 * from scratch on every visit -- about ten seconds of worker time for an answer that has not
 * changed. Only estimators created with `remember: true` read or write it, and only the views
 * judging stored vault passwords ask for that: those passwords are already in this page's
 * memory as vault items, so holding them here adds no secret. The setup and change-password
 * forms never remember -- a master password, and every prefix typed on the way to it, must not
 * outlive the form. `clearStrengthCache` drops everything on lock.
 */
const judged = new Map<string, StrengthEstimate>();
/** Enough for a large vault; past it the oldest judgement goes first. */
const MAX_JUDGED = 5_000;

function remember(key: string, estimate: StrengthEstimate): void {
  judged.delete(key);
  judged.set(key, estimate);
  while (judged.size > MAX_JUDGED) {
    const oldest = judged.keys().next();
    if (oldest.done === true) break;
    judged.delete(oldest.value);
  }
}

function cacheKey(password: string, userInputs: readonly string[]): string {
  return `${password}\u0000${userInputs.join("\u0001")}`;
}

/** Forgets every judgement. Called when the vault locks. */
export function clearStrengthCache(): void {
  judged.clear();
}

export interface StrengthEstimatorOptions {
  /** Share judgements through the page-wide cache. For stored vault passwords only. */
  readonly remember?: boolean;
}

export function createStrengthEstimator(
  startWorker: () => Worker | null = () =>
    typeof Worker === "undefined"
      ? null
      : new Worker("/assets/strength-worker-entry.js", { type: "module" }),
  options: StrengthEstimatorOptions = {},
): StrengthEstimator {
  const remembers = options.remember === true;
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
      // The cache stands in for the worker, never in front of the fallback: without a worker
      // the answer is the quick estimate, as it has always been.
      if (target === null) return Promise.resolve(quick);
      const key = cacheKey(password, userInputs);
      const remembered = remembers ? judged.get(key) : undefined;
      if (remembered !== undefined) return Promise.resolve(remembered);
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
          const estimate: StrengthEstimate = {
            bits: Math.round(response.guessesLog10 * Math.log2(10)),
            level,
            label: LABELS[level],
            ...(advice === "" ? {} : { advice }),
            crackTime: response.crackTime,
            source: "full",
          };
          if (remembers) remember(key, estimate);
          resolve(estimate);
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
