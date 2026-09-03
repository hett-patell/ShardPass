import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";

import {
  getThemePreference,
  setThemePreference,
  type ThemePreference,
} from "../theme";
import styles from "./ThemeToggle.module.css";

const OPTIONS: readonly { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

/** Segmented control for the colour theme. Applies immediately and persists per browser. */
export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>(() => getThemePreference());
  const choose = (value: ThemePreference) => {
    setThemePreference(value);
    setPreference(value);
  };
  return (
    <div className={styles.group} role="radiogroup" aria-label="Appearance">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={preference === value}
          className={styles.option}
          data-selected={preference === value ? "true" : "false"}
          onClick={() => choose(value)}
        >
          <Icon size={14} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}
