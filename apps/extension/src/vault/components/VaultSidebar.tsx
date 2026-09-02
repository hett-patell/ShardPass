import { CategoryNav, type CategoryKey } from "@shardpass/ui";
import { Cloud, Folder, Settings } from "lucide-react";

import type { FolderSummary } from "../item-support";
import styles from "./VaultSidebar.module.css";

export type VaultSidebarView = "vault" | "settings" | "ente";

export interface VaultSidebarProps {
  category: CategoryKey;
  onCategoryChange: (category: CategoryKey) => void;
  itemCounts: Partial<Record<CategoryKey, number>>;
  folders: readonly FolderSummary[];
  selectedFolderId: string | null;
  onFolderSelect: (folderId: string | null) => void;
  view: VaultSidebarView;
  onOpenSettings: () => void;
  onOpenEnte: () => void;
}

/** Category and folder navigation, with Settings and Ente sync entry points at the bottom. */
export function VaultSidebar({
  category,
  onCategoryChange,
  itemCounts,
  folders,
  selectedFolderId,
  onFolderSelect,
  view,
  onOpenSettings,
  onOpenEnte,
}: VaultSidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.scroll}>
        <CategoryNav active={category} counts={itemCounts} onSelect={onCategoryChange} />

        <div>
          <p className={styles.sectionLabel}>Folders</p>
          {folders.length === 0 ? (
            <p className={styles.emptyFolders}>No folders yet.</p>
          ) : (
            <div className={styles.folderList}>
              {folders.map((folder) => {
                const active = view === "vault" && selectedFolderId === folder.id;
                return (
                  <button
                    key={folder.id}
                    type="button"
                    className={`${styles.folderItem} ${active ? styles.folderItemActive : ""}`}
                    aria-current={active ? "true" : undefined}
                    onClick={() => onFolderSelect(active ? null : folder.id)}
                  >
                    <Folder size={14} aria-hidden="true" />
                    <span className={styles.folderLabel}>{folder.label}</span>
                    <span className={styles.folderCount}>{folder.count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className={styles.footer}>
        <button
          type="button"
          className={`${styles.footerButton} ${view === "ente" ? styles.footerButtonActive : ""}`}
          aria-current={view === "ente" ? "true" : undefined}
          onClick={onOpenEnte}
        >
          <Cloud size={16} aria-hidden="true" />
          <span>Ente sync</span>
        </button>
        <button
          type="button"
          className={`${styles.footerButton} ${view === "settings" ? styles.footerButtonActive : ""}`}
          aria-current={view === "settings" ? "true" : undefined}
          onClick={onOpenSettings}
        >
          <Settings size={16} aria-hidden="true" />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}
