import { CircleAlert } from "lucide-react";
import { useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";

import styles from "./primitives.module.css";

export interface FieldProps {
  className?: string;
  error?: ReactNode;
  help?: ReactNode;
  id?: string;
  inputProps?: Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "aria-describedby" | "aria-invalid" | "className" | "id"
  >;
  label: ReactNode;
}

export function Field({ className, error, help, id, inputProps, label }: FieldProps) {
  const generatedId = useId();
  const inputId = id ?? `field-${generatedId}`;
  const helpId = help ? `${inputId}-help` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={[styles.field, className].filter(Boolean).join(" ")}>
      <label className={styles.fieldLabel} htmlFor={inputId}>
        {label}
      </label>
      <input
        {...inputProps}
        id={inputId}
        className={styles.input}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
      />
      {help ? (
        <p className={styles.fieldHelp} id={helpId}>
          {help}
        </p>
      ) : null}
      {error ? (
        <p className={styles.fieldError} id={errorId} role="alert">
          <CircleAlert aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
