// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { findProviderButton } from "../../../src/content/login/provider-button";

function rendered(): void {
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
    return [{ width: 10, height: 10 }] as unknown as DOMRectList;
  });
}

describe("findProviderButton", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    rendered();
  });

  it("finds the sign-in phrase, or a link to the provider's OAuth endpoint", () => {
    document.body.innerHTML = `
      <button type="button">Continue with Google</button>
      <a href="/auth/github">
        <img alt="GitHub logo" />
      </a>
    `;
    expect(findProviderButton(document, "google")?.textContent).toContain("Continue with Google");
    expect(findProviderButton(document, "github")?.getAttribute("href")).toBe("/auth/github");
  });

  it("does not take a bare mention of the provider for its button", () => {
    document.body.innerHTML = `
      <a href="https://policies.google.com/privacy">Google Privacy Policy</a>
      <a href="https://play.google.com/store">Get it on Google Play</a>
      <button type="button" aria-label="Close">X</button>
    `;
    expect(findProviderButton(document, "google")).toBeNull();
    expect(findProviderButton(document, "twitter")).toBeNull();
  });
});
