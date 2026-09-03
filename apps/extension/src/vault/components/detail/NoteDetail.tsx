import type { NoteItem, Folder } from "@shardpass/domain";
import { useState } from "react";

import type { ExtensionPlatform } from "../../../platform/extension-platform";
import { NoteForm } from "../forms/NoteForm";
import styles from "./Detail.module.css";
import { DetailActions } from "./DetailActions";

export interface NoteDetailProps {
  item: NoteItem;
  platform: ExtensionPlatform;
  folders: readonly Folder[];
  onUpdate: () => void;
  onDeleted: () => void;
}

export function NoteDetail({ item, platform, folders, onUpdate, onDeleted }: NoteDetailProps) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <NoteForm
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

  return (
    <div className={styles.detail}>
      <header className={styles.header}>
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

      <div className={styles.fieldGroup}>
        <span className={styles.label}>Content</span>
        <pre className={styles.content}>{item.content || "—"}</pre>
      </div>

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
