import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

import styles from "./primitives.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
  variant?: ButtonVariant;
}

export function Button({
  children,
  className,
  disabled = false,
  loading = false,
  ref,
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  const state = loading ? "loading" : disabled ? "disabled" : "default";
  const classes = [styles.button, styles[variant], loading ? styles.loading : undefined, className]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-state={state}
    >
      {loading ? (
        <>
          <span className={styles.spinner} aria-hidden="true" />
          <span className={styles.visuallyHidden}>Loading</span>
        </>
      ) : null}
      <span className={styles.buttonContent}>{children}</span>
    </button>
  );
}
