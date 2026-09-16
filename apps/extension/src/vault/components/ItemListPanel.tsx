import { memo, type ReactNode } from "react";
import { cardBrandFromNumber, type VaultItem } from "@shardpass/domain";
import { Button, ItemRow, CardBrandMark } from "@shardpass/ui";

import { itemDisplayName, itemDisplaySubtitle } from "../item-support";
import { faviconUrl } from "../../platform/favicon";
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
  /** The active folder's display path, when a folder filter is on; changes the empty-state copy. */
  folderName?: string;
  onRetry?: () => void;
  onCreate?: () => void;
  /** Opens the import flow; shown beside "add" when the vault is empty. */
  onImport?: () => void;
}

const SKELETON_ROWS = 6;

function emptyCopy(
  search: string,
  category: string,
  archived: boolean,
  folderName: string | undefined,
): { title: string; body: string } {
  if (archived && search === "")
    return {
      title: "Nothing archived",
      body: "Archive an item from its detail view to tuck it away without deleting it.",
    };
  if (search.trim() !== "")
    return {
      title: `No results for “${search.trim()}”`,
      body: "Check the spelling, or search a different field.",
    };
  if (folderName !== undefined)
    return {
      title: `Nothing in “${folderName}” yet`,
      body: "Move items here from their Folder control, or add one from New item.",
    };
  if (category !== "all" && category !== "")
    return {
      title: "Nothing in this category yet",
      body: "Add one from the New button, or import from another manager.",
    };
  return {
    title: "Your vault is empty",
    body: "Add a login, or bring everything over from your browser, 1Password, Bitwarden or KeePass.",
  };
}

/** The empty state's button names what the open category holds. */
const ADD_LABELS: Partial<Record<string, string>> = {
  all: "Add a login",
  login: "Add a login",
  otp: "Add a one-time code",
  note: "Add a note",
  card: "Add a card",
  identity: "Add an identity",
  secret: "Add a secret",
  api_key: "Add an API credential",
  ssh_key: "Add an SSH key",
};

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
  onImport,
  archived = false,
  folderName,
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
    const copy = emptyCopy(search, category, archived, folderName);
    return (
      <div className={styles.stateBlock}>
        <strong>{copy.title}</strong>
        <span>{copy.body}</span>
        {search.trim() === "" ? (
          <div className={styles.emptyActions}>
            {onCreate ? (
              <Button variant="secondary" onClick={onCreate}>
                {ADD_LABELS[category] ?? "Add a login"}
              </Button>
            ) : null}
            {onImport &&
            (category === "all" || category === "") &&
            !archived &&
            folderName === undefined ? (
              <Button variant="secondary" onClick={onImport}>
                Import passwords
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.list}>
      {items.map((item) => {
        const subtitle = itemDisplaySubtitle(item);
        return (
          <ListRow
            key={item.id}
            id={item.id}
            kind={item.kind}
            name={itemDisplayName(item)}
            active={item.id === selectedId}
            onSelect={onSelect}
            {...(subtitle === undefined ? {} : { subtitle })}
            iconUrl={item.kind === "login" ? faviconUrl(item.urls[0]) : undefined}
            icon={
              item.kind === "card" ? (
                <CardBrandMark
                  brand={item.brand ?? cardBrandFromNumber(item.number) ?? "other"}
                  size={18}
                />
              ) : undefined
            }
          />
        );
      })}
    </div>
  );
}

/** One row with a stable click handler, so the memoised ItemRow only redraws when its own props change. */
const ListRow = memo(function ListRow({
  id,
  onSelect,
  ...rest
}: Readonly<{
  id: string;
  onSelect: (id: string) => void;
  kind: VaultItem["kind"];
  name: string;
  active: boolean;
  subtitle?: string;
  iconUrl?: string | undefined;
  icon?: ReactNode;
}>) {
  return <ItemRow {...rest} onClick={() => onSelect(id)} />;
});
