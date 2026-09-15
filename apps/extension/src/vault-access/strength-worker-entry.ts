/// <reference lib="webworker" />

import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import * as common from "@zxcvbn-ts/language-common";
import * as english from "@zxcvbn-ts/language-en";

import type { StrengthWorkerRequest, StrengthWorkerResponse } from "./strength-worker-protocol";

/**
 * zxcvbn with its common-password, English and name dictionaries, kept off the page thread:
 * the dictionaries are large and the matching is quadratic, so the input is capped at 256
 * characters (more adds nothing to the verdict), and the Levenshtein pass, which multiplies
 * the work for little gain, is left off. The password never leaves this worker.
 */
const zxcvbn = new ZxcvbnFactory({
  dictionary: { ...common.dictionary, ...english.dictionary },
  graphs: common.adjacencyGraphs,
  translations: english.translations,
});

const MAX_INPUT_CHARS = 256;
const scope = globalThis as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<unknown>) => {
  const request = event.data as StrengthWorkerRequest | null;
  if (request?.version !== 1 || request.kind !== "estimate" || typeof request.password !== "string")
    return;
  const result = zxcvbn.check(Array.from(request.password).slice(0, MAX_INPUT_CHARS).join(""), [
    "shardpass",
    ...request.userInputs,
  ]);
  const response: StrengthWorkerResponse = {
    version: 1,
    kind: "estimate",
    id: request.id,
    score: result.score,
    guessesLog10: result.guessesLog10,
    crackTime: String(result.crackTimes.offlineSlowHashingXPerSecond.display),
    warning: result.feedback.warning ?? "",
    suggestions: result.feedback.suggestions,
  };
  scope.postMessage(response);
};
