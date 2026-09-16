import { MousePointerClick } from "lucide-react";

import styles from "./EmptyDetailState.module.css";

export interface EmptyDetailStateProps {
  /** Whether the list beside this panel has anything in it to select. */
  readonly hasItems: boolean;
}

/**
 * Shown in the detail panel when no vault item is selected. With an empty list there is
 * nothing to select, and telling someone to select an item is an instruction they cannot
 * follow: the panel says what the list is instead.
 */
export function EmptyDetailState({ hasItems }: EmptyDetailStateProps) {
  return (
    <div className={styles.state}>
      <MousePointerClick size={28} aria-hidden="true" />
      <p>{hasItems ? "Select an item to view its details." : "Nothing here to open yet."}</p>
    </div>
  );
}
