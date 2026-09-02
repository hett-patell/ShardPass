import { describe, expect, it } from "vitest";

describe("DOM test project", () => {
  it("provides document and Shadow DOM APIs", () => {
    const host = document.createElement("div");
    const shadowRoot = host.attachShadow({ mode: "closed" });

    expect(host.ownerDocument).toBe(document);
    expect(shadowRoot).toBeInstanceOf(ShadowRoot);
  });
});
