export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "shardpass:theme";
const PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

function isPreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (PREFERENCES as readonly string[]).includes(value);
}

/** The stored preference; "system" when nothing is stored or storage is unavailable. */
export function getThemePreference(): ThemePreference {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isPreference(stored) ? stored : "system";
  } catch {
    return "system";
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
  if (preference === "system") delete root.dataset["theme"];
  else root.dataset["theme"] = preference;
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    if (preference === "system") globalThis.localStorage?.removeItem(STORAGE_KEY);
    else globalThis.localStorage?.setItem(STORAGE_KEY, preference);
  } catch {
    // Storage can be unavailable (private mode, quota); the choice still applies for this page.
  }
  applyThemePreference(preference);
}

/** The next preference in the cycle, for a single-button toggle. */
export function nextThemePreference(current: ThemePreference): ThemePreference {
  return PREFERENCES[(PREFERENCES.indexOf(current) + 1) % PREFERENCES.length] ?? "system";
}
