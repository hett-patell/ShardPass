import type { ItemListItemProjection } from "@shardpass/messaging";
import { KeyRound } from "lucide-react";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import { LiveCode } from "../components/LiveCode";
import { PopupRow } from "../components/PopupRow";
import { QuickAction } from "../components/QuickAction";
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
            {...(item.kind === "otp"
              ? {
                  actions: (
                    <LiveCode platform={platform} itemId={item.id} onCopy={(code) => onCopyCode(item, code)} />
                  ),
                }
              : item.kind === "login"
                ? {
                    actions: (
                      <QuickAction
                        aria-label={`Copy password for ${item.name}`}
                        title="Copy password"
                        onClick={() => onCopyPassword(item)}
                      >
                        <KeyRound size={15} />
                      </QuickAction>
                    ),
                  }
                : {})}
          />
        </li>
      ))}
    </ul>
  );
}
