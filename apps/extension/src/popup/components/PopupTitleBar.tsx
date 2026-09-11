import { IconButton, ShardPassMark } from "@shardpass/ui";
import { ArrowLeft, Lock, Settings } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import styles from "./PopupTitleBar.module.css";

export interface PopupTitleBarProps {
  /** Present on pushed screens; renders the back arrow and the screen's title. */
  back?: Readonly<{ label: string; onBack: () => void }>;
  title?: string;
  trailing?: ReactNode;
  onLock?: () => void;
  onSettings?: () => void;
}

export function PopupTitleBar({ back, title, trailing, onLock, onSettings }: PopupTitleBarProps) {
  // A pushed screen replaces the whole body; the title takes focus so keyboard and screen
  // reader users land on what just opened instead of on nothing.
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Keyed on whether a back control exists, not on the object (rebuilt every render): a
  // copy or a fill must not pull focus off the button that was just used.
  const hasBack = back !== undefined;
  useEffect(() => {
    if (hasBack) titleRef.current?.focus();
  }, [hasBack, title]);
  return (
    <header className={styles.bar}>
      {back ? (
        <>
          <IconButton aria-label={back.label} onClick={back.onBack}>
            <ArrowLeft size={18} />
          </IconButton>
          <h1 ref={titleRef} className={styles.screenTitle} tabIndex={-1}>
            {title}
          </h1>
        </>
      ) : (
        <div className={styles.identity}>
          <ShardPassMark className={styles.mark} />
          <span className={styles.wordmark}>ShardPass</span>
        </div>
      )}
      <div className={styles.actions}>
        {trailing}
        {onLock ? (
          <IconButton aria-label="Lock vault" onClick={onLock}>
            <Lock size={16} />
          </IconButton>
        ) : null}
        {onSettings ? (
          <IconButton aria-label="Open vault settings" onClick={onSettings}>
            <Settings size={16} />
          </IconButton>
        ) : null}
      </div>
    </header>
  );
}
