import type { ItemListItemProjection } from "@shardpass/messaging";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import { PopupRow } from "../components/PopupRow";
import { RowActions } from "../components/RowActions";
import styles from "./ListScreen.module.css";

export interface ListScreenProps {
  items: readonly ItemListItemProjection[];
  emptyText: string;
  platform: Pick<ExtensionPlatform, "sendOtpMessage">;
  onOpenItem: (item: ItemListItemProjection) => void;
  onCopyPassword: (item: ItemListItemProjection) => void;
  onCopyCode: (item: ItemListItemProjection, code: string) => void;
}

/** A category's items. Logins copy their password from the row; codes are live in the row. */
export function ListScreen({ items, emptyText, platform, onOpenItem, onCopyPassword, onCopyCode }: ListScreenProps) {
  if (items.length === 0) return <p className={styles.empty}>{emptyText}</p>;
  return (
    <ul className={styles.list}>
      {items.map((item) => (
        <li key={item.id}>
          <PopupRow
            item={item}
            onOpen={onOpenItem}
            actions={<RowActions item={item} platform={platform} onCopyPassword={onCopyPassword} onCopyCode={onCopyCode} />}
          />
        </li>
      ))}
    </ul>
  );
}
