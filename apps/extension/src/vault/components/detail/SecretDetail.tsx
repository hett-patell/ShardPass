import type { SecretItem, Folder } from "@shardpass/domain";
import { StatusBadge } from "@shardpass/ui";
import { useState } from "react";

import type { ExtensionPlatform } from "../../../platform/extension-platform";
import { secretTypeLabel } from "../../item-support";
import { SecretForm } from "../forms/SecretForm";
import { CopyButton } from "./CopyButton";
import styles from "./Detail.module.css";
import { useFocusAfterEdit } from "./useFocusAfterEdit";
import { DetailActions } from "./DetailActions";
import { RevealField } from "./RevealField";

export interface SecretDetailProps {
  item: SecretItem;
  platform: ExtensionPlatform;
  folders: readonly Folder[];
  onUpdate: () => void;
  onDeleted: () => void;
}

export function SecretDetail({ item, platform, folders, onUpdate, onDeleted }: SecretDetailProps) {
  const [editing, setEditing] = useState(false);
  const titleRef = useFocusAfterEdit(editing);

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

  const ssh = item.secretType === "ssh_key";
  const SSH_LABELS: Record<string, string> = {
    publicKey: "Public key",
    fingerprint: "Fingerprint",
    keyType: "Key type",
  };
  const sshEntries = ssh
    ? Object.entries(item.metadata).filter(([key]) => Object.hasOwn(SSH_LABELS, key))
    : [];
  const metadataEntries = Object.entries(item.metadata).filter(
    ([key]) => !ssh || !Object.hasOwn(SSH_LABELS, key),
  );

  return (
    <div className={styles.detail}>
      <header className={styles.header}>
        <h2 ref={titleRef} tabIndex={-1} className={styles.title}>
          {item.name}
        </h2>
      </header>

      <div className={styles.tagRow}>
        <StatusBadge status="neutral">{secretTypeLabel(item.secretType)}</StatusBadge>
        {item.tags.map((tag) => (
          <span key={tag} className={styles.tag}>
            {tag}
          </span>
        ))}
      </div>

      {sshEntries.length > 0 ? (
        <div className={styles.fieldGroup}>
          <div className={styles.table}>
            {sshEntries.map(([key, value]) => (
              <div key={key} className={styles.tableRow}>
                <span className={styles.tableLabel}>{SSH_LABELS[key]}</span>
                <span className={styles.tableValue}>{value}</span>
                <CopyButton label={`Copy ${SSH_LABELS[key]?.toLowerCase() ?? key}`} value={value} />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <RevealField label={ssh ? "Private key" : "Value"} value={item.value} />

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
