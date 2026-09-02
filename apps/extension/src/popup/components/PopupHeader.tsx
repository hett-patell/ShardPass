import { IconButton, ShardPassMark } from "@shardpass/ui";
import { Lock, Settings } from "lucide-react";

import styles from "./PopupHeader.module.css";

export interface PopupHeaderProps {
  onLock: () => void;
  onSettings: () => void;
}

export function PopupHeader({ onLock, onSettings }: PopupHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.identity}>
        <ShardPassMark className={styles.mark} />
        <span className={styles.title}>ShardPass</span>
      </div>
      <div className={styles.actions}>
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
