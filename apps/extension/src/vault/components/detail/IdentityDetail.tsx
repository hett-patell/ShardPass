import type { IdentityItem } from "@shardpass/domain";
import { useState } from "react";

import type { ExtensionPlatform } from "../../../platform/extension-platform";
import { IdentityForm } from "../forms/IdentityForm";
import { CopyButton } from "./CopyButton";
import styles from "./Detail.module.css";
import { DetailActions } from "./DetailActions";

export interface IdentityDetailProps {
  item: IdentityItem;
  platform: ExtensionPlatform;
  onUpdate: () => void;
  onDeleted: () => void;
}

function addressLines(item: IdentityItem): string[] {
  const cityLine = [item.city, item.state, item.zip].filter((part) => part.length > 0).join(", ");
  return [item.street, cityLine, item.country].filter((line) => line.length > 0);
}

export function IdentityDetail({ item, platform, onUpdate, onDeleted }: IdentityDetailProps) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <IdentityForm
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

  const fullName = [item.firstName, item.lastName].filter((part) => part.length > 0).join(" ");
  const address = addressLines(item);

  return (
    <div className={styles.detail}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>IDENTITY</p>
        <h2 className={styles.title}>{fullName || item.name}</h2>
        {fullName ? <p className={styles.valueMuted}>{item.name}</p> : null}
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

      {item.email ? (
        <div className={styles.fieldGroup}>
          <span className={styles.label}>Email</span>
          <div className={styles.row}>
            <span className={styles.rowValue}>{item.email}</span>
            <CopyButton label="Copy email" value={item.email} />
          </div>
        </div>
      ) : null}

      {item.phone ? (
        <div className={styles.fieldGroup}>
          <span className={styles.label}>Phone</span>
          <div className={styles.row}>
            <span className={styles.rowValue}>{item.phone}</span>
            <CopyButton label="Copy phone" value={item.phone} />
          </div>
        </div>
      ) : null}

      {address.length > 0 ? (
        <div className={styles.fieldGroup}>
          <span className={styles.label}>Address</span>
          <div className={styles.row}>
            <address className={`${styles.rowValue} ${styles.address}`}>
              {address.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </address>
            <CopyButton label="Copy address" value={address.join(", ")} />
          </div>
        </div>
      ) : null}

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
