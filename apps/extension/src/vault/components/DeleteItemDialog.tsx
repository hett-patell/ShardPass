import { Button } from "@shardpass/ui";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import styles from "./detail/Detail.module.css";
import { useModalDialog } from "./useModalDialog";

export interface DeleteItemDialogProps {
  itemName: string;
  submitting: boolean;
  error?: string;
  /** Heading, question and confirm label. Default to deleting the whole item. */
  title?: string;
  description?: ReactNode;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Destructive confirmation for every item kind, and for removing part of one (a passkey).
 * A native dialog: focus, inertness and Escape come from the element.
 */
export function DeleteItemDialog({
  itemName,
  submitting,
  error,
  title = "Delete item",
  description,
  confirmLabel = "Delete",
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
      <h3 id="delete-item-heading">{title}</h3>
      <p id="delete-item-description">
        {description ?? (
          <>
            Delete <strong>{itemName}</strong>? This removes it from the vault.
          </>
        )}
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
          {confirmLabel}
        </Button>
      </div>
    </dialog>,
    document.body,
  );
}
