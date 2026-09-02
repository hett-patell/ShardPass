import type { SecretItem } from "@shardpass/domain";
import { StatusBadge } from "@shardpass/ui";
import { useState } from "react";

import type { ExtensionPlatform } from "../../../platform/extension-platform";
import { secretTypeLabel } from "../../item-support";
import { SecretForm } from "../forms/SecretForm";
import { CopyButton } from "./CopyButton";
import styles from "./Detail.module.css";
import { DetailActions } from "./DetailActions";
import { RevealField } from "./RevealField";

export interface SecretDetailProps {
  item: SecretItem;
  platform: ExtensionPlatform;
  onUpdate: () => void;
  onDeleted: () => void;
}

export function SecretDetail({ item, platform, onUpdate, onDeleted }: SecretDetailProps) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <SecretForm
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

  const metadataEntries = Object.entries(item.metadata);

  return (
    <div className={styles.detail}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>SECRET</p>
        <h2 className={styles.title}>{item.name}</h2>
      </header>

      <div className={styles.tagRow}>
        <StatusBadge status="neutral">{secretTypeLabel(item.secretType)}</StatusBadge>
        {item.tags.map((tag) => (
          <span key={tag} className={styles.tag}>
            {tag}
          </span>
        ))}
      </div>

      <RevealField label="Value" value={item.value} />

      {metadataEntries.length > 0 ? (
        <div className={styles.fieldGroup}>
          <span className={styles.label}>Metadata</span>
          <div className={styles.table}>
            {metadataEntries.map(([key, value]) => (
              <div key={key} className={styles.tableRow}>
                <span className={styles.tableLabel}>{key}</span>
                <span className={styles.tableValue}>{value}</span>
                <CopyButton label={`Copy ${key}`} value={value} />
              </div>
            ))}
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
