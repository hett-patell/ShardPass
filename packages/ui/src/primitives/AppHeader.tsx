import type { ReactNode } from "react";

import { ShardPassMark } from "../brand/ShardPassMark";
import styles from "./primitives.module.css";

export interface AppHeaderProps {
  actions?: ReactNode;
  className?: string;
  eyebrow?: ReactNode;
  title: string;
}

export function AppHeader({ actions, className, eyebrow, title }: AppHeaderProps) {
  return (
    <header className={[styles.header, className].filter(Boolean).join(" ")} aria-label={title}>
      <div className={styles.headerIdentity}>
        <ShardPassMark className={styles.headerMark} aria-hidden="true" />
        <div className={styles.headerText}>
          <div className={styles.headerTitleRow}>
            <h1 className={styles.headerTitle}>{title}</h1>
          </div>
          {eyebrow ? <p className={styles.headerEyebrow}>{eyebrow}</p> : null}
        </div>
      </div>
      {actions ? <div className={styles.headerActions}>{actions}</div> : null}
    </header>
  );
}
