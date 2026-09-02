import { Button } from "@shardpass/ui";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import styles from "./detail/Detail.module.css";

export interface DeleteItemDialogProps {
  itemName: string;
  submitting: boolean;
  error?: string;
  onCancel(): void;
  onConfirm(): void;
}

/** Generic delete confirmation for the non-OTP item kinds (OTP keeps its own DeleteOtpDialog). */
export function DeleteItemDialog({
  itemName,
  submitting,
  error,
  onCancel,
  onConfirm,
}: DeleteItemDialogProps) {
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
        aria-labelledby="delete-item-heading"
        aria-describedby="delete-item-description"
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
        <h3 id="delete-item-heading">Delete item</h3>
        <p id="delete-item-description">
          Delete <strong>{itemName}</strong>? This removes the item from the vault.
        </p>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.dialogActions}>
          <Button ref={cancelRef} variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} loading={submitting}>
            Delete
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
