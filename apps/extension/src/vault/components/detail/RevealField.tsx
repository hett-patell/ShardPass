import { IconButton } from "@shardpass/ui";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { CopyButton } from "./CopyButton";
import styles from "./Detail.module.css";

export interface RevealFieldProps {
  label: string;
  value: string;
  /**
   * Shown instead of the generic dot mask while hidden, e.g. a card number's
   * "•••• •••• •••• 4242". Defaults to a dot mask sized to the value length.
   */
  maskedPreview?: string;
  /** Placeholder shown when `value` is empty (revealed or hidden). Defaults to "—". */
  placeholder?: string;
}

function dotMask(value: string): string {
  return "•".repeat(Math.min(Math.max(value.length, 8), 24));
}

/** A masked value with an eye-icon reveal toggle and a copy button, for secrets. */
export function RevealField({ label, value, maskedPreview, placeholder = "—" }: RevealFieldProps) {
  const [visible, setVisible] = useState(false);
  const isEmpty = value.length === 0;
  const hiddenDisplay = isEmpty ? placeholder : (maskedPreview ?? dotMask(value));

  return (
    <div className={styles.fieldGroup}>
      <span className={styles.label}>{label}</span>
      <div className={styles.row}>
        <span className={`${styles.rowValue} ${styles.mono}`}>
          {isEmpty ? placeholder : visible ? value : hiddenDisplay}
        </span>
        {isEmpty ? null : (
          <>
            <IconButton
              aria-label={visible ? `Hide ${label}` : `Show ${label}`}
              onClick={() => setVisible((current) => !current)}
            >
              {visible ? <EyeOff size={16} /> : <Eye size={16} />}
            </IconButton>
            <CopyButton label={`Copy ${label}`} value={value} />
          </>
        )}
      </div>
    </div>
  );
}
