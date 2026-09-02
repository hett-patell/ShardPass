import { Button } from "@shardpass/ui";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import styles from "./OtpVaultView.module.css";

export function DeleteOtpDialog({
  label,
  submitting,
  onCancel,
  onConfirm,
}: Readonly<{
  label: string;
  submitting: boolean;
  onCancel(): void;
  onConfirm(): void;
}>) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return createPortal(
    <div className={styles.dialogBackdrop}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-otp-heading"
        aria-describedby="delete-otp-description"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !submitting) {
            event.preventDefault();
            onCancel();
          }
          if (event.key !== "Tab") return;
          const focusable =
            dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
          if (!focusable?.length) return;
          const first = focusable[0]!;
          const last = focusable[focusable.length - 1]!;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <p className={styles.kicker}>DESTRUCTIVE / REVISION BOUND</p>
        <h3 id="delete-otp-heading">Delete OTP item</h3>
        <p id="delete-otp-description">
          Delete <strong>{label}</strong>? This removes the current encrypted item revision.
        </p>
        <div className={styles.dialogActions}>
          <Button ref={cancelRef} variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} loading={submitting}>
            Confirm delete
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
