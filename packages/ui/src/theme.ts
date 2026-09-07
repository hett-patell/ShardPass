export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "shardpass:theme";
const PREFERENCES: readonly ThemePreference[] = ["dark", "light", "system"];

function isPreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (PREFERENCES as readonly string[]).includes(value);
}

/**
 * The stored preference. Dark when nothing is stored: the graphite theme is the identity, and
 * a person who wants their OS to decide picks "system" from the toggle.
 */
export function getThemePreference(): ThemePreference {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isPreference(stored) ? stored : "dark";
  } catch {
    return "dark";
  }
}

/**
 * Stamps the preference onto the document root, where the tokens read it: an explicit
 * choice sets data-theme, "system" removes it so prefers-color-scheme decides. Call once
 * before first paint and again whenever the preference changes.
 */
export function applyThemePreference(preference: ThemePreference = getThemePreference()): void {
  const root = globalThis.document?.documentElement;
  if (root === undefined) return;
  // The tokens are dark by default and light under data-theme="light"; "system" resolves the
  // OS preference here so the stylesheet needs no media query of its own.
  const light =
    preference === "light" ||
    (preference === "system" &&
      globalThis.matchMedia?.("(prefers-color-scheme: light)").matches === true);
  root.dataset["theme"] = light ? "light" : "dark";
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, preference);
  } catch {
    // Storage can be unavailable (private mode, quota); the choice still applies for this page.
  }
  applyThemePreference(preference);
}

/** The next preference in the cycle, for a single-button toggle. */
export function nextThemePreference(current: ThemePreference): ThemePreference {
  return PREFERENCES[(PREFERENCES.indexOf(current) + 1) % PREFERENCES.length] ?? "dark";
}
