import type { ItemListItemProjection } from "@shardpass/messaging";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { KindIcon } from "./KindIcon";
import styles from "./PopupRow.module.css";

export interface PopupRowProps {
  item: ItemListItemProjection;
  onOpen: (item: ItemListItemProjection) => void;
  /** Quick actions rendered beside the row's button, never inside it. */
  actions?: ReactNode;
  /** Passive content on the right of the row itself (a live code, a hint). */
  trailing?: ReactNode;
}

/** One vault item in a list: opens its detail screen; quick actions sit beside it. */
export function PopupRow({ item, onOpen, actions, trailing }: PopupRowProps) {
  return (
    <div className={styles.shell}>
      <button type="button" className={styles.row} onClick={() => onOpen(item)}>
        <KindIcon kind={item.kind} />
        <span className={styles.text}>
          <span className={styles.name}>{item.name}</span>
          {item.subtitle ? <span className={styles.subtitle}>{item.subtitle}</span> : null}
        </span>
        {trailing ? <span className={styles.trailing}>{trailing}</span> : null}
        <ChevronRight size={16} className={styles.chevron} aria-hidden="true" />
      </button>
      {actions ? <span className={styles.actions}>{actions}</span> : null}
    </div>
  );
}
