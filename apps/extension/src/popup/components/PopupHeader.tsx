import {
  IconButton,
  ShardPassMark,
  getThemePreference,
  nextThemePreference,
  setThemePreference,
  type ThemePreference,
} from "@shardpass/ui";
import { Lock, Monitor, Moon, Settings, Sun } from "lucide-react";
import { useState } from "react";

import styles from "./PopupHeader.module.css";

export interface PopupHeaderProps {
  onLock: () => void;
  onSettings: () => void;
}

const THEME_ICON: Record<ThemePreference, typeof Sun> = { system: Monitor, light: Sun, dark: Moon };
const THEME_LABEL: Record<ThemePreference, string> = {
  system: "Theme: follows system",
  light: "Theme: light",
  dark: "Theme: dark",
};

export function PopupHeader({ onLock, onSettings }: PopupHeaderProps) {
  const [theme, setTheme] = useState<ThemePreference>(() => getThemePreference());
  const ThemeIcon = THEME_ICON[theme];
  const cycleTheme = () => {
    const next = nextThemePreference(theme);
    setThemePreference(next);
    setTheme(next);
  };
  return (
    <header className={styles.header}>
      <div className={styles.identity}>
        <ShardPassMark className={styles.mark} />
        <span className={styles.title}>ShardPass</span>
      </div>
      <div className={styles.actions}>
        <IconButton aria-label={`${THEME_LABEL[theme]}. Switch theme`} onClick={cycleTheme}>
          <ThemeIcon size={16} />
        </IconButton>
        <IconButton aria-label="Lock vault" onClick={onLock}>
          <Lock size={16} />
        </IconButton>
        <IconButton aria-label="Open vault settings" onClick={onSettings}>
          <Settings size={16} />
        </IconButton>
      </div>
    </header>
  );
}
