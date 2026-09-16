import { CardBrandMark } from "@shardpass/ui";
import { type CardItem, type Folder, cardBrandFromNumber } from "@shardpass/domain";
import { useState } from "react";

import type { ExtensionPlatform } from "../../../platform/extension-platform";
import { formatCardExpiry, maskCardNumber } from "../../item-support";
import { CARD_BRAND_LABELS, CardForm } from "../forms/CardForm";
import styles from "./Detail.module.css";
import { useFocusAfterEdit } from "./useFocusAfterEdit";
import { DetailActions } from "./DetailActions";
import { RevealField } from "./RevealField";

export interface CardDetailProps {
  item: CardItem;
  platform: ExtensionPlatform;
  folders: readonly Folder[];
  onUpdate: () => void;
  onDeleted: () => void;
}

export function CardDetail({ item, platform, folders, onUpdate, onDeleted }: CardDetailProps) {
  const [editing, setEditing] = useState(false);
  const titleRef = useFocusAfterEdit(editing);

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

  const brand = item.brand ?? cardBrandFromNumber(item.number);
  return (
    <div className={styles.detail}>
      <header className={styles.header}>
        <h2 ref={titleRef} tabIndex={-1} className={styles.title}>
          {item.name}
        </h2>
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

      {brand !== undefined ? (
        <div className={styles.fieldGroup}>
          <span className={styles.label}>Brand</span>
          <span className={`${styles.value} ${styles.brandRow}`}>
            <CardBrandMark brand={brand} size={20} />
            {CARD_BRAND_LABELS[brand]}
            {item.brand === undefined ? (
              <span className={styles.hint}>(from the number)</span>
            ) : null}
          </span>
        </div>
      ) : null}

      <div className={styles.fieldGroup}>
        <span className={styles.label}>Cardholder</span>
        <span className={styles.value}>{item.cardholderName || "—"}</span>
      </div>

      <RevealField
        label="Card number"
        value={item.number}
        maskedPreview={maskCardNumber(item.number)}
      />

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
        item={item}
        folders={folders}
        onUpdate={onUpdate}
        platform={platform}
        onEdit={() => setEditing(true)}
        onDeleted={onDeleted}
      />
    </div>
  );
}
