import { Button } from "@shardpass/ui";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import styles from "./detail/Detail.module.css";
import { useModalDialog } from "./useModalDialog";

export interface FolderDeleteDialogProps {
  folderName: string;
  /** Items filed in this folder or one nested beneath it; they stay in the vault. */
  itemCount: number;
  submitting: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Folder deletion never deletes items; the copy says so before asking. */
export function FolderDeleteDialog({
  folderName,
  itemCount,
  submitting,
  error,
  onCancel,
  onConfirm,
}: FolderDeleteDialogProps) {
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
      aria-labelledby="delete-folder-heading"
      aria-describedby="delete-folder-description"
      {...({ closedby: "closerequest" } as Record<string, string>)}
    >
      <h3 id="delete-folder-heading">Delete folder</h3>
      <p id="delete-folder-description">
        Delete <strong>{folderName}</strong> and any folders inside it?{" "}
        {itemCount === 0
          ? "It is empty."
          : `${itemCount} ${itemCount === 1 ? "item" : "items"} inside will stay in the vault, unfiled.`}
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
          Delete folder
        </Button>
      </div>
    </dialog>,
    document.body,
  );
}
