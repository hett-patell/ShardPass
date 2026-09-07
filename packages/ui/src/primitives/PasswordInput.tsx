import { Eye, EyeOff } from "lucide-react";
import { useState, type InputHTMLAttributes, type KeyboardEvent, type Ref } from "react";

import styles from "./primitives.module.css";

export interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  ref?: Ref<HTMLInputElement>;
  /** Warn when Caps Lock is on while typing; on by default. */
  capsLockHint?: boolean;
}

/**
 * A password field a person can read back: the eye toggles between hidden and shown, and a
 * quiet note appears while Caps Lock is on. Every password field in ShardPass uses this.
 */
export function PasswordInput({ className, capsLockHint = true, ref, onKeyDown, onKeyUp, ...props }: PasswordInputProps) {
  const [shown, setShown] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const watchCaps = (event: KeyboardEvent<HTMLInputElement>) => {
    if (capsLockHint) setCapsLock(event.getModifierState("CapsLock"));
  };
  return (
    <div className={styles.passwordField}>
      <div className={styles.passwordWrap}>
        <input
          {...props}
          ref={ref}
          type={shown ? "text" : "password"}
          className={[styles.input, styles.passwordInput, className].filter(Boolean).join(" ")}
          onKeyDown={(event) => {
            watchCaps(event);
            onKeyDown?.(event);
          }}
          onKeyUp={(event) => {
            watchCaps(event);
            onKeyUp?.(event);
          }}
        />
        <button
          type="button"
          className={styles.passwordToggle}
          // Sighted-only, like the tab order already says (tabIndex -1): assistive tech gets the
          // plain password field, and the wrapping <label>'s name stays "Master password".
          aria-hidden="true"
          title={shown ? "Hide password" : "Show password"}
          tabIndex={-1}
          onClick={() => setShown((current) => !current)}
        >
          {shown ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      </div>
      {capsLock ? (
        <p className={styles.passwordNote} role="status">
          Caps Lock is on
        </p>
      ) : null}
    </div>
  );
}
