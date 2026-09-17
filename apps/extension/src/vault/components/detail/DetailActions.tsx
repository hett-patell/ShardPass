import type { Folder, VaultItem } from "@shardpass/domain";
import { parseItemCrudResponseForRequest } from "@shardpass/messaging";
import { Button } from "@shardpass/ui";
import { useState } from "react";

import type { ExtensionPlatform } from "../../../platform/extension-platform";
import { itemDisplayName } from "../../item-support";
import { DeleteItemDialog } from "../DeleteItemDialog";
import styles from "./Detail.module.css";
import { OrganizeControls } from "./OrganizeControls";

export interface DetailActionsProps {
  item: VaultItem;
  folders: readonly Folder[];
  platform: Pick<ExtensionPlatform, "sendMessage">;
  onEdit: () => void;
  /** After a move or archive change. */
  onUpdate: () => void;
  onDeleted: () => void;
}

const deleteUnavailable = "Could not delete this item. Try again.";

/** Names the background's refusal so a failed delete is diagnosable, not just reported. */
function describeFailure(candidate: unknown): string {
  if (typeof candidate !== "object" || candidate === null || !("error" in candidate))
    return deleteUnavailable;
  const error = (candidate as { error?: { code?: unknown } }).error;
  const code = typeof error?.code === "string" ? error.code : undefined;
  switch (code) {
    case "ITEM_CONFLICT":
      return "This item changed elsewhere. Reload and try again.";
    case "ITEM_NOT_FOUND":
      return "This item no longer exists. Reload the list.";
    case "VAULT_LOCKED":
      return "The vault is locked. Unlock it and try again.";
    case undefined:
      return deleteUnavailable;
    default:
      return `${deleteUnavailable} (${code})`;
  }
}

/**
 * Shared folder/archive controls plus the Edit/Delete row for the non-OTP detail views.
 * Deletes through the generic item.delete message (OTP items keep their own otp.delete +
 * DeleteOtpDialog flow, since otp.delete additionally requires an expectedRevision).
 */
export function DetailActions({
  item,
  folders,
  platform,
  onEdit,
  onUpdate,
  onDeleted,
}: DetailActionsProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const confirmDelete = () => {
    setDeleting(true);
    setError("");
    const request = { version: 1 as const, kind: "item.delete" as const, itemId: item.id };
    platform.sendMessage(request).then(
      (candidate) => {
        const parsed = parseItemCrudResponseForRequest(request, candidate);
        setDeleting(false);
        if (parsed.success && parsed.data.kind === "item.deleteResult") {
          setConfirming(false);
          onDeleted();
        } else {
          setError(describeFailure(candidate));
        }
      },
      () => {
        setDeleting(false);
        setError(deleteUnavailable);
      },
    );
  };

  return (
    <>
      <OrganizeControls item={item} folders={folders} platform={platform} onUpdate={onUpdate} />
      <div className={styles.actions}>
        <Button onClick={onEdit}>Edit</Button>
        <Button variant="ghost" className={styles.delete} onClick={() => setConfirming(true)}>
          Delete
        </Button>
        {confirming ? (
          <DeleteItemDialog
            itemName={itemDisplayName(item)}
            submitting={deleting}
            error={error}
            onCancel={() => {
              if (deleting) return;
              setConfirming(false);
              setError("");
            }}
            onConfirm={confirmDelete}
          />
        ) : null}
      </div>
    </>
  );
}
