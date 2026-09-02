import type { ButtonHTMLAttributes, ReactElement, Ref } from "react";

import styles from "./primitives.module.css";

type LabeledIconButton = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "children"
> & {
  "aria-label": string;
  children: ReactElement;
  ref?: Ref<HTMLButtonElement>;
};

export type IconButtonProps = LabeledIconButton;

export function IconButton({
  "aria-label": accessibleLabel,
  children,
  className,
  disabled = false,
  ref,
  type = "button",
  ...props
}: IconButtonProps) {
  if (accessibleLabel.trim().length === 0) {
    throw new Error("IconButton requires a non-empty accessible label.");
  }

  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={[styles.iconButton, className].filter(Boolean).join(" ")}
      disabled={disabled}
      aria-label={accessibleLabel}
      data-state={disabled ? "disabled" : "default"}
    >
      {children}
    </button>
  );
}
