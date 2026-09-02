import type { VaultItem } from "@shardpass/domain";
import { ItemRow } from "@shardpass/ui";

import { itemDisplayName, itemDisplaySubtitle } from "../item-support";
import styles from "./ItemListPanel.module.css";

export interface ItemListPanelProps {
  items: readonly VaultItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Renders the filtered item set as ItemRow entries, highlighting the active selection. */
export function ItemListPanel({ items, selectedId, onSelect }: ItemListPanelProps) {
  if (items.length === 0) {
    return <p className={styles.empty}>No items match the current filters.</p>;
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
