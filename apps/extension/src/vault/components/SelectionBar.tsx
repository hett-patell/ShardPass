import type { Folder } from "@shardpass/domain";
import type { ItemBulkAction } from "@shardpass/messaging";
import { Button } from "@shardpass/ui";
import { useState } from "react";

import { folderPath } from "../item-support";
import { DeleteItemDialog } from "./DeleteItemDialog";
import styles from "./SelectionBar.module.css";

export type SelectionScope = "live" | "archived" | "deleted";

export interface SelectionBarProps {
  scope: SelectionScope;
  /** How many items are ticked. */
  count: number;
  /** How many items the list shows: what "Select all" would tick. */
  total: number;
  folders: readonly Folder[];
  busy: boolean;
  /** The outcome of the last action, or why it failed. */
  message: string;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onDone: () => void;
  onAction: (action: ItemBulkAction, folderId?: string | null) => void;
}

const NO_FOLDER = "__none__";

function itemsLabel(count: number): string {
  return `${count.toLocaleString("en-US")} item${count === 1 ? "" : "s"}`;
}

/**
 * What can be done to several items at once. Each action is one commit in the background;
 * the ones that remove something ask first, the rest act straight away.
 */
export function SelectionBar({
  scope,
  count,
  total,
  folders,
  busy,
  message,
  onSelectAll,
  onSelectNone,
  onDone,
  onAction,
}: SelectionBarProps) {
  const [confirm, setConfirm] = useState<"delete" | "purge" | null>(null);
  const none = count === 0;

  return (
    <div className={styles.bar} role="toolbar" aria-label="Selected items">
      <div className={styles.summary}>
        <span className={styles.count} aria-live="polite">
          {none ? "Select items" : `${itemsLabel(count)} selected`}
        </span>
        {count < total ? (
          <button type="button" className={styles.link} onClick={onSelectAll} disabled={busy}>
            Select all {total.toLocaleString("en-US")}
          </button>
        ) : (
          <button type="button" className={styles.link} onClick={onSelectNone} disabled={busy}>
            Select none
          </button>
        )}
        <button type="button" className={styles.link} onClick={onDone} disabled={busy}>
          Done
        </button>
      </div>

      <div className={styles.actions}>
        {scope === "live" ? (
          <>
            <Button
              variant="secondary"

              disabled={none || busy}
              onClick={() => onAction("favorite")}
            >
              Favourite
            </Button>
            <select
              className={styles.move}
              aria-label="Move selected items to a folder"
              disabled={none || busy}
              value=""
              onChange={(event) => {
                const value = event.target.value;
                if (value === "") return;
                onAction("move", value === NO_FOLDER ? null : value);
              }}
            >
              <option value="">Move to…</option>
              <option value={NO_FOLDER}>No folder</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folderPath(folders, folder.id)}
                </option>
              ))}
            </select>
            <Button
              variant="secondary"

              disabled={none || busy}
              onClick={() => onAction("archive")}
            >
              Archive
            </Button>
          </>
        ) : null}
        {scope === "archived" ? (
          <Button
            variant="secondary"

            disabled={none || busy}
            onClick={() => onAction("unarchive")}
          >
            Restore from archive
          </Button>
        ) : null}
        {scope === "deleted" ? (
          <Button
            variant="secondary"

            disabled={none || busy}
            onClick={() => onAction("restore")}
          >
            Restore
          </Button>
        ) : null}
        <Button
          variant="ghost"

          className={styles.danger}
          disabled={none || busy}
          onClick={() => setConfirm(scope === "deleted" ? "purge" : "delete")}
        >
          {scope === "deleted" ? "Delete for good" : "Delete"}
        </Button>
      </div>

      {message !== "" ? (
        <p className={styles.message} role="status">
          {message}
        </p>
      ) : null}

      {confirm !== null ? (
        <DeleteItemDialog
          itemName={itemsLabel(count)}
          title={confirm === "purge" ? "Delete for good?" : "Delete these items?"}
          description={
            confirm === "purge" ? (
              <>
                <strong>{itemsLabel(count)}</strong> will be removed from this device now. They
                cannot be restored afterwards.
              </>
            ) : (
              <>
                <strong>{itemsLabel(count)}</strong> will move to Recently deleted, where you can
                restore them for 30 days.
              </>
            )
          }
          confirmLabel={confirm === "purge" ? "Delete for good" : "Delete"}
          submitting={busy}
          onCancel={() => {
            if (!busy) setConfirm(null);
          }}
          onConfirm={() => {
            onAction(confirm);
            setConfirm(null);
          }}
        />
      ) : null}
    </div>
  );
}
