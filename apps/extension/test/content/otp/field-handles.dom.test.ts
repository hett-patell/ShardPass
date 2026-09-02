import { afterEach, describe, expect, it, vi } from "vitest";

import { createOtpFieldHandleRegistry } from "../../../src/content/otp/field-handles";

function field(markup = "same"): HTMLInputElement {
  const element = document.createElement("input");
  element.id = markup;
  element.name = markup;
  element.value = markup;
  document.body.append(element);
  return element;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("opaque field handles", () => {
  it("is stable for one object, opaque, random, and never derived from page data", () => {
    const randomUUID = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("11111111-2222-4333-8444-555555555555");
    const registry = createOtpFieldHandleRegistry();
    const element = field("page-derived-marker");
    const first = registry.handleFor(element);
    expect(registry.handleFor(element)).toBe(first);
    expect(first).toBe("11111111-2222-4333-8444-555555555555");
    expect(first).not.toContain("page-derived-marker");
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it("assigns distinct handles to same-markup replacement objects", () => {
    const registry = createOtpFieldHandleRegistry();
    const original = field();
    const first = registry.handleFor(original);
    original.remove();
    const replacement = field();
    expect(registry.handleFor(replacement)).not.toBe(first);
  });

  it("resolves only the exact active object and clears the bounded reverse lookup", () => {
    const registry = createOtpFieldHandleRegistry();
    const first = field("first");
    const second = field("second");
    const firstHandle = registry.activate(first);
    expect(registry.resolveActive(firstHandle)).toBe(first);
    const secondHandle = registry.activate(second);
    expect(registry.resolveActive(firstHandle)).toBeNull();
    expect(registry.resolveActive(secondHandle)).toBe(second);
    second.remove();
    expect(registry.resolveActive(secondHandle)).toBeNull();
    registry.clearActive();
    expect(registry.resolveActive(secondHandle)).toBeNull();
  });
});
