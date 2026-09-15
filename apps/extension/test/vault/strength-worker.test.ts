import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import * as common from "@zxcvbn-ts/language-common";
import * as english from "@zxcvbn-ts/language-en";
import { describe, expect, it } from "vitest";

// The same configuration the worker entry builds; the entry itself needs a worker scope.
const zxcvbn = new ZxcvbnFactory({
  dictionary: { ...common.dictionary, ...english.dictionary },
  graphs: common.adjacencyGraphs,
  translations: english.translations,
});

describe("strength worker configuration", () => {
  it("rates a dictionary word with the usual decorations as weak, and random text as strong", () => {
    expect(zxcvbn.check("Password123!", ["shardpass"]).score).toBeLessThanOrEqual(1);
    expect(zxcvbn.check("shardpass2026", ["shardpass"]).score).toBeLessThanOrEqual(1);
    expect(zxcvbn.check("Vq7#mZp2!rT9kL4w@Xs6", ["shardpass"]).score).toBe(4);
    expect(zxcvbn.check("Password123!", []).feedback.warning).not.toBe("");
  }, 30_000);
});
