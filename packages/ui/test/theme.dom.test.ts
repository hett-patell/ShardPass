import { afterEach, describe, expect, it, vi } from "vitest";

import { applyThemePreference } from "../src/theme";

type Listener = (event: { matches: boolean }) => void;

function stubMatchMedia(initialLight: boolean) {
  const listeners = new Set<Listener>();
  const query = {
    matches: initialLight,
    addEventListener: vi.fn((_type: string, listener: Listener) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: Listener) => listeners.delete(listener)),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => query),
  );
  return {
    query,
    flip(light: boolean) {
      query.matches = light;
      for (const listener of listeners) listener({ matches: light });
    },
    listenerCount: () => listeners.size,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset["theme"];
});

describe("applyThemePreference", () => {
  it("follows the OS scheme while the preference is system, and stops when it is not", () => {
    const media = stubMatchMedia(true);
    applyThemePreference("system");
    expect(document.documentElement.dataset["theme"]).toBe("light");
    media.flip(false);
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    media.flip(true);
    expect(document.documentElement.dataset["theme"]).toBe("light");

    applyThemePreference("dark");
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(media.listenerCount()).toBe(0);
    media.flip(true);
    expect(document.documentElement.dataset["theme"]).toBe("dark");
  });
});
