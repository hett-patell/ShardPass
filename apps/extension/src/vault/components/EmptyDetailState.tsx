import { MousePointerClick } from "lucide-react";

import styles from "./EmptyDetailState.module.css";

/** Shown in the detail panel when no vault item is selected. */
export function EmptyDetailState() {
  return (
    <div className={styles.state}>
      <MousePointerClick size={28} aria-hidden="true" />
      <p>Select an item to view its details.</p>
    </div>
  );
}
