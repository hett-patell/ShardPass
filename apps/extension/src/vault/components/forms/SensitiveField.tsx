import { IconButton } from "@shardpass/ui";
import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import styles from "./Form.module.css";

export interface SensitiveFieldProps {
  label: string;
  value: string;
  error?: string;
  help?: string;
  maxLength?: number;
  autoComplete?: string;
  onChange: (value: string) => void;
  /** Extra control rendered next to the reveal toggle, e.g. a password generator button. */
  extraAction?: ReactNode;
}

/**
 * A masked text field (password-style input with an eye-icon reveal toggle), used
 * for password/CVV/PIN/secret-value inputs. Built directly on a plain input+label
 * pair — rather than the shared `Field` primitive — so the reveal toggle can sit as
 * a sibling of the input instead of nesting an interactive control inside `Field`'s
 * `<label>`.
 */
export function SensitiveField({
  label,
  value,
  error,
  help,
  maxLength,
  autoComplete = "off",
  onChange,
  extraAction,
}: SensitiveFieldProps) {
  const [visible, setVisible] = useState(false);
  const inputId = `sensitive-field-${useId()}`;
  const helpId = help ? `${inputId}-help` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      <div className={styles.row}>
        <input
          id={inputId}
          className={styles.textInput}
          type={visible ? "text" : "password"}
          value={value}
          maxLength={maxLength}
          autoComplete={autoComplete}
          spellCheck={false}
          aria-describedby={[helpId, errorId].filter(Boolean).join(" ") || undefined}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        {extraAction}
        <IconButton
          aria-label={visible ? `Hide ${label}` : `Show ${label}`}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </IconButton>
      </div>
      {help ? (
        <p className={styles.fieldHelp} id={helpId}>
          {help}
        </p>
      ) : null}
      {error ? (
        <p className={styles.fieldError} id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
