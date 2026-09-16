import type { Folder, VaultItem } from "@shardpass/domain";
import { Button } from "@shardpass/ui";
import { Archive, ArchiveRestore } from "lucide-react";
import { useId, useState } from "react";

import type { ExtensionPlatform } from "../../../platform/extension-platform";
import { folderPath, folderTree } from "../../item-support";
import { updateItem } from "../forms/submit-item";
import styles from "./Detail.module.css";

export interface OrganizeControlsProps {
  item: VaultItem;
  folders: readonly Folder[];
  platform: Pick<ExtensionPlatform, "sendMessage">;
  /** Called after a successful move or archive change; the caller refreshes the list. */
  onUpdate: () => void;
}

const saveFailed = "Could not save this change. Try again.";

/**
 * Folder placement and archive state for any item kind. Both are plain `item.update`
 * calls against the item's current revision, so a concurrent edit is reported as a
 * conflict rather than silently overwritten.
 */
export function OrganizeControls({ item, folders, platform, onUpdate }: OrganizeControlsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selectId = useId();
  const archived = item.archivedAt !== undefined;
  const filedIn = item.folderId;
  const orphaned = filedIn !== undefined && !folders.some((folder) => folder.id === filedIn);

  const save = async (fields: Record<string, unknown>, leavesList = false) => {
    setBusy(true);
    setError("");
    const result = await updateItem(platform, item.id, item.revision, fields);
    setBusy(false);
    if (result.status === "saved") {
      onUpdate();
      // Archiving or restoring takes the item, and this button, out of the list: land on the
      // content region rather than on the page body.
      if (leavesList) document.getElementById("vault-content")?.focus();
    } else if (result.status === "conflict")
      setError("This item changed elsewhere. Reload and try again.");
    else setError(saveFailed);
  };

  return (
    <div className={styles.organize}>
      <label className={styles.organizeField} htmlFor={selectId}>
        <span className={styles.label}>Folder</span>
        <select
          id={selectId}
          className={styles.organizeSelect}
          value={filedIn ?? ""}
          disabled={busy}
          onChange={(event) => {
            const next = event.target.value;
            void save({ folderId: next === "" ? undefined : next });
          }}
        >
          <option value="">No folder</option>
          {orphaned ? <option value={filedIn}>{folderPath(folders, filedIn)}</option> : null}
          {folderTree(folders).map(({ folder, depth }) => (
            <option key={folder.id} value={folder.id}>
              {`${"  ".repeat(depth)}${folder.name}`}
            </option>
          ))}
        </select>
      </label>
      <Button
        variant="ghost"
        disabled={busy}
        onClick={() =>
          void save({ archivedAt: archived ? undefined : new Date().toISOString() }, true)
        }
      >
        {archived ? (
          <ArchiveRestore size={14} aria-hidden="true" />
        ) : (
          <Archive size={14} aria-hidden="true" />
        )}
        {archived ? "Restore from archive" : "Archive"}
      </Button>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
