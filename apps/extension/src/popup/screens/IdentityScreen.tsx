import type { ItemListItemProjection } from "@shardpass/messaging";
import { Button } from "@shardpass/ui";
import { Check, Plus } from "lucide-react";

import styles from "./IdentityScreen.module.css";

export interface IdentityScreenProps {
  identities: readonly ItemListItemProjection[];
  pinnedId: string | null;
  onPick: (id: string) => void;
  onCreate: () => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}` : (parts[0] ?? "").slice(0, 2);
  return letters.toUpperCase();
}

/** Which identity sits at the top of the popup. One tap pins it; "Create" opens the vault form. */
export function IdentityScreen({ identities, pinnedId, onPick, onCreate }: IdentityScreenProps) {
  return (
    <div className={styles.screen}>
      <p className={styles.help}>The identity pinned at the top of the popup, with its details a tap away.</p>
      {identities.length === 0 ? (
        <p className={styles.quiet}>No identities yet.</p>
      ) : (
        <ul className={styles.list}>
          {identities.map((item) => {
            const pinned = item.id === pinnedId;
            return (
              <li key={item.id}>
                <button type="button" className={styles.row} aria-pressed={pinned} onClick={() => onPick(item.id)}>
                  <span className={styles.avatar} aria-hidden="true">
                    {initials(item.name)}
                  </span>
                  <span className={styles.text}>
                    <span className={styles.name}>{item.name}</span>
                    {item.subtitle ? <span className={styles.subtitle}>{item.subtitle}</span> : null}
                  </span>
                  {pinned ? <Check size={16} className={styles.check} aria-label="Pinned" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Button variant="secondary" onClick={onCreate}>
        <Plus size={14} aria-hidden="true" /> Create identity
      </Button>
    </div>
  );
}
