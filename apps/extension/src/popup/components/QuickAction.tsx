import type { ButtonHTMLAttributes } from "react";

import styles from "./QuickAction.module.css";

/** A 32 px icon button for a row's quick action; labelled for screen readers, titled for hover. */
export function QuickAction({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={[styles.action, className].filter(Boolean).join(" ")}
    />
  );
}
