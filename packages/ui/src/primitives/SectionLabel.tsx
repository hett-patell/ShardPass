import type { HTMLAttributes, ReactNode } from "react";

import styles from "./primitives.module.css";

export interface SectionLabelProps extends HTMLAttributes<HTMLParagraphElement> {
  children: ReactNode;
  /** Something small on the right of the label: a count, an action. */
  trailing?: ReactNode;
}

/** The mono-caps heading that introduces a list section. One per section, never decorative. */
export function SectionLabel({ children, className, trailing, ...props }: SectionLabelProps) {
  return (
    <p {...props} className={[styles.sectionLabel, className].filter(Boolean).join(" ")}>
      <span>{children}</span>
      {trailing ? <span>{trailing}</span> : null}
    </p>
  );
}
