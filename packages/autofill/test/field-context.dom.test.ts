import { beforeEach, describe, expect, it } from "vitest";

import { labelTextFor } from "../src/field-context";

describe("labelTextFor", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("collects labels, aria-labelledby targets, preceding text through lone wrappers, and the previous cell", () => {
    document.body.innerHTML = `
      <p id="hint">Work email</p>
      <div class="row">
        <div class="label"><span>Email address</span></div>
        <div class="control"><div class="inner"><input id="a" type="text" aria-labelledby="hint" /></div></div>
      </div>
      <label for="b">Username</label><input id="b" type="text" />
      <table><tr><td>Member ID</td><td><input id="c" type="text" /></td></tr></table>
      <div><button>Sign in</button><input id="d" type="text" /></div>
    `;
    expect(labelTextFor(document.getElementById("a")!)).toContain("Work email");
    expect(labelTextFor(document.getElementById("a")!)).toContain("Email address");
    expect(labelTextFor(document.getElementById("b")!)).toContain("Username");
    expect(labelTextFor(document.getElementById("c")!)).toContain("Member ID");
    // A control before the field is a boundary: its text is not the field's label.
    expect(labelTextFor(document.getElementById("d")!)).not.toContain("Sign in");
  });
});
