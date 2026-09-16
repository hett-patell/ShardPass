import { describe, expect, it } from "vitest";

import { parseTags, schemaErrors } from "../../src/vault/item-support";

describe("parseTags", () => {
  it("trims, drops empties, and keeps one spelling of a tag repeated in another case", () => {
    expect(parseTags(" work, Work ,, home,WORK, ")).toEqual(["work", "home"]);
    expect(parseTags("")).toEqual([]);
  });
});

describe("schemaErrors", () => {
  it("points at the first failing field the form can show, else the form itself", () => {
    expect(schemaErrors([{ path: ["expMonth"] }], ["name", "expMonth"])).toEqual({
      expMonth: "This value isn’t valid.",
    });
    expect(schemaErrors([{ path: ["tags", 1] }], ["name"])).toEqual({
      form: "Review the highlighted fields.",
    });
    expect(schemaErrors([], ["name"])).toEqual({ form: "Review the highlighted fields." });
  });
});
