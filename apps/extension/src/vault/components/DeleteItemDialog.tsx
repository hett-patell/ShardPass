import { Button } from "@shardpass/ui";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import styles from "./detail/Detail.module.css";
import { useModalDialog } from "./useModalDialog";

export interface DeleteItemDialogProps {
  itemName: string;
  submitting: boolean;
  error?: string;
  onCancel(): void;
  onConfirm(): void;
}

/** Delete confirmation for every item kind. A native dialog: focus, inertness and Escape come from the element. */
export function DeleteItemDialog({
  itemName,
  submitting,
  error,
  onCancel,
  onConfirm,
}: DeleteItemDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useModalDialog(dialogRef, { onCancel, locked: submitting });

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="delete-item-heading"
      aria-describedby="delete-item-description"
      // Destructive: dismiss on Escape only, never by an outside click.
      {...({ closedby: "closerequest" } as Record<string, string>)}
    >
      <h3 id="delete-item-heading">Delete item</h3>
      <p id="delete-item-description">
        Delete <strong>{itemName}</strong>? This removes it from the vault.
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
    </dialog>,
    document.body,
  );
}
