import { Button } from "@shardpass/ui";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import styles from "../components/detail/Detail.module.css";
import { useModalDialog } from "../components/useModalDialog";

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
      aria-labelledby="delete-otp-heading"
      aria-describedby="delete-otp-description"
      {...({ closedby: "closerequest" } as Record<string, string>)}
    >
      <h3 id="delete-otp-heading">Delete one-time code</h3>
      <p id="delete-otp-description">
        Delete <strong>{label}</strong>? It moves to Recently deleted, where you can restore it for
        30 days. If it syncs with Ente, it is removed there when it leaves Recently deleted.
      </p>
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
