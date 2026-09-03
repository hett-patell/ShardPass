import type { VaultItem } from "@shardpass/domain";
import { Button, ItemRow } from "@shardpass/ui";

import { itemDisplayName, itemDisplaySubtitle } from "../item-support";
import styles from "./ItemListPanel.module.css";

export interface ItemListPanelProps {
  items: readonly VaultItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  status?: "idle" | "loading" | "ready" | "error";
  /** The active search text; decides which empty state applies. */
  search?: string;
  /** The active category key; "all" means no category filter. */
  category?: string;
  /** True when listing the archive; changes the empty-state copy. */
  archived?: boolean;
  onRetry?: () => void;
  onCreate?: () => void;
}

const SKELETON_ROWS = 6;

function emptyCopy(search: string, category: string, archived: boolean): { title: string; body: string } {
  if (archived && search === "")
    return { title: "Nothing archived", body: "Archive an item from its detail view to tuck it away without deleting it." };
  if (search.trim() !== "")
    return { title: `No results for “${search.trim()}”`, body: "Check the spelling, or search a different field." };
  if (category !== "all" && category !== "")
    return { title: "Nothing in this category yet", body: "Add one from the New button, or import from another manager." };
  return { title: "Your vault is empty", body: "Add your first item, or import from a browser, KeePass, Bitwarden or 1Password." };
}

/** The item list, with honest loading, error and empty states. */
export function ItemListPanel({
  items,
  selectedId,
  onSelect,
  status = "ready",
  search = "",
  category = "all",
  onRetry,
  onCreate,
  archived = false,
}: ItemListPanelProps) {
  if (status === "loading" && items.length === 0) {
    return (
      <div className={styles.skeleton} role="status" aria-label="Loading items">
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <div key={index} className={styles.skeletonRow} aria-hidden="true">
            <span className={styles.skeletonIcon} />
            <span className={styles.skeletonLines}>
              <span className={styles.skeletonLine} />
              <span className={`${styles.skeletonLine} ${styles.skeletonLineShort}`} />
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (status === "error" && items.length === 0) {
    return (
      <div className={styles.stateBlock} role="alert">
        <strong>Couldn’t load your items</strong>
        <span>The background service didn’t answer. It may be restarting.</span>
        {onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </div>
    );
  }

  if (items.length === 0) {
    const copy = emptyCopy(search, category, archived);
    return (
      <div className={styles.stateBlock}>
        <strong>{copy.title}</strong>
        <span>{copy.body}</span>
        {onCreate && search.trim() === "" ? (
          <Button variant="secondary" onClick={onCreate}>
            New item
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.list}>
      {items.map((item) => {
        const subtitle = itemDisplaySubtitle(item);
        return (
          <ItemRow
            key={item.id}
            kind={item.kind}
            name={itemDisplayName(item)}
            active={item.id === selectedId}
            onClick={() => onSelect(item.id)}
            {...(subtitle === undefined ? {} : { subtitle })}
          />
        );
      })}
    </div>
  );
}
