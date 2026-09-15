import { Monitor, Moon, Sun } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import { getThemePreference, setThemePreference, type ThemePreference } from "../theme";
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
  // One tab stop; arrows move the choice, the way a radio group works.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = OPTIONS[(index + step + OPTIONS.length) % OPTIONS.length]!;
    choose(next.value);
    (
      event.currentTarget.parentElement?.children[OPTIONS.indexOf(next)] as HTMLElement | undefined
    )?.focus();
  };
  return (
    <div className={styles.group} role="radiogroup" aria-label="Appearance">
      {OPTIONS.map(({ value, label, Icon }, index) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={preference === value}
          tabIndex={preference === value ? 0 : -1}
          className={styles.option}
          data-selected={preference === value ? "true" : "false"}
          onClick={() => choose(value)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          <Icon size={14} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}
