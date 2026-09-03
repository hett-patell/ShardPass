import type { CardItem } from "@shardpass/domain";
import { useState } from "react";

import type { ExtensionPlatform } from "../../../platform/extension-platform";
import { formatCardExpiry, maskCardNumber } from "../../item-support";
import { CARD_BRAND_LABELS, CardForm } from "../forms/CardForm";
import styles from "./Detail.module.css";
import { DetailActions } from "./DetailActions";
import { RevealField } from "./RevealField";

export interface CardDetailProps {
  item: CardItem;
  platform: ExtensionPlatform;
  onUpdate: () => void;
  onDeleted: () => void;
}

export function CardDetail({ item, platform, onUpdate, onDeleted }: CardDetailProps) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <CardForm
        item={item}
        platform={platform}
        onSaved={() => {
          setEditing(false);
          onUpdate();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const expiry = formatCardExpiry(item.expMonth, item.expYear);

  return (
    <div className={styles.detail}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>CARD</p>
        <h2 className={styles.title}>{item.name}</h2>
      </header>

      {item.tags.length > 0 ? (
        <div className={styles.tagRow}>
          {item.tags.map((tag) => (
            <span key={tag} className={styles.tag}>
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      {item.brand ? (
        <div className={styles.fieldGroup}>
          <span className={styles.label}>Brand</span>
          <span className={styles.value}>{CARD_BRAND_LABELS[item.brand]}</span>
        </div>
      ) : null}

      <div className={styles.fieldGroup}>
        <span className={styles.label}>Cardholder</span>
        <span className={styles.value}>{item.cardholderName || "—"}</span>
      </div>

      <RevealField label="Card number" value={item.number} maskedPreview={maskCardNumber(item.number)} />

      <div className={styles.fieldGroup}>
        <span className={styles.label}>Expires</span>
        <span className={`${styles.value} ${styles.mono}`}>{expiry || "—"}</span>
      </div>

      <RevealField label="CVV" value={item.cvv} />
      <RevealField label="PIN" value={item.pin} />

      {item.notes ? (
        <div className={styles.fieldGroup}>
          <span className={styles.label}>Notes</span>
          <p className={styles.value}>{item.notes}</p>
        </div>
      ) : null}

      <DetailActions
        itemId={item.id}
        itemName={item.name}
        platform={platform}
        onEdit={() => setEditing(true)}
        onDeleted={onDeleted}
      />
    </div>
  );
}
