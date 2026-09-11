import type { Folder } from "@shardpass/domain";
import { CategoryNav, type CategoryKey } from "@shardpass/ui";
import {
  Archive,
  Cloud,
  Folder as FolderIcon,
  FolderPlus,
  Pencil,
  Plus,
  Settings,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { folderSubtreeIds, folderTree } from "../item-support";
import { FolderDeleteDialog } from "./FolderDeleteDialog";
import styles from "./VaultSidebar.module.css";

export type VaultSidebarView = "vault" | "settings" | "ente";

export interface VaultSidebarProps {
  category: CategoryKey;
  onCategoryChange: (category: CategoryKey) => void;
  itemCounts: Partial<Record<CategoryKey, number>>;
  folders: readonly Folder[];
  /** Items filed directly in each folder. */
  folderCounts: ReadonlyMap<string, number>;
  selectedFolderId: string | null;
  onFolderSelect: (folderId: string | null) => void;
  folderError: string | null;
  /** Called when a create/rename/delete attempt is abandoned, so a stale error does not linger. */
  onClearFolderError?: () => void;
  onCreateFolder: (name: string, parentId?: string) => Promise<boolean>;
  onRenameFolder: (id: string, name: string) => Promise<boolean>;
  onDeleteFolder: (id: string) => Promise<boolean>;
  /** True while the list shows archived items instead of the everyday vault. */
  archived: boolean;
  onOpenArchive: () => void;
  view: VaultSidebarView;
  onOpenSettings: () => void;
  onOpenEnte: () => void;
}

type FolderEdit =
  | { mode: "create"; parentId: string | undefined }
  | { mode: "rename"; id: string; initial: string };

const MAX_VISIBLE_DEPTH = 2;

/** Category and folder navigation, with Archive, Settings and Ente sync entry points at the bottom. */
export function VaultSidebar({
  category,
  onCategoryChange,
  itemCounts,
  folders,
  folderCounts,
  selectedFolderId,
  onFolderSelect,
  folderError,
  onClearFolderError,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  archived,
  onOpenArchive,
  view,
  onOpenSettings,
  onOpenEnte,
}: VaultSidebarProps) {
  const [edit, setEdit] = useState<FolderEdit | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Folder | null>(null);
  const [busy, setBusy] = useState(false);
  const tree = folderTree(folders);
  const browsing = view === "vault" && !archived;

  const newFolderRef = useRef<HTMLButtonElement>(null);
  const cancelEdit = () => {
    setEdit(null);
    onClearFolderError?.();
  };
  // The native <dialog> returns focus to its opener, but the row's trash button is only
  // rendered while the row is hovered or focused; land on the folder itself, or on "New
  // folder" once the folder is gone.
  const focusAfterDialog = (folderId: string) => {
    setTimeout(() => {
      const row = document.getElementById(folderButtonId(folderId));
      (row ?? newFolderRef.current)?.focus();
    }, 0);
  };
  const submitEdit = async (name: string) => {
    if (edit === null) return;
    const trimmed = name.trim();
    if (trimmed === "") {
      cancelEdit();
      return;
    }
    setBusy(true);
    const ok =
      edit.mode === "create"
        ? await onCreateFolder(trimmed, edit.parentId)
        : await onRenameFolder(edit.id, trimmed);
    setBusy(false);
    if (ok) setEdit(null);
  };

  const confirmDelete = async () => {
    if (pendingDelete === null) return;
    setBusy(true);
    const ok = await onDeleteFolder(pendingDelete.id);
    setBusy(false);
    if (ok) {
      if (
        selectedFolderId !== null &&
        folderSubtreeIds(folders, pendingDelete.id).has(selectedFolderId)
      )
        onFolderSelect(null);
      setPendingDelete(null);
      focusAfterDialog(pendingDelete.id);
    }
  };

  const subtreeCount = (folderId: string) => {
    let total = 0;
    for (const id of folderSubtreeIds(folders, folderId)) total += folderCounts.get(id) ?? 0;
    return total;
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.scroll}>
        <CategoryNav
          active={browsing ? category : "all"}
          counts={itemCounts}
          onSelect={onCategoryChange}
        />

        <div>
          <div className={styles.sectionHeading}>
            <p className={styles.sectionLabel}>Folders</p>
            <button
              type="button"
              className={styles.iconButton}
              ref={newFolderRef}
              aria-label="New folder"
              title="New folder"
              disabled={edit !== null}
              onClick={() => setEdit({ mode: "create", parentId: undefined })}
            >
              <Plus size={14} aria-hidden="true" />
            </button>
          </div>

          {folders.length === 0 && edit === null ? (
            <p className={styles.emptyFolders}>No folders yet. Use + to add one.</p>
          ) : null}

          <div className={styles.folderList} role="tree" aria-label="Folders">
            {tree.map(({ folder, depth }) => {
              const active = browsing && selectedFolderId === folder.id;
              const renaming = edit?.mode === "rename" && edit.id === folder.id;
              return (
                <div key={folder.id} role="none">
                  {renaming ? (
                    <FolderNameInput
                      initial={edit.initial}
                      depth={depth}
                      busy={busy}
                      label={`Rename ${folder.name}`}
                      onSubmit={submitEdit}
                      onCancel={cancelEdit}
                    />
                  ) : (
                    <div
                      className={`${styles.folderRow} ${active ? styles.folderRowActive : ""}`}
                      style={{ paddingInlineStart: `calc(var(--space-2) + ${depth} * 14px)` }}
                      role="treeitem"
                      aria-selected={active}
                      aria-level={depth + 1}
                    >
                      <button
                        type="button"
                        id={folderButtonId(folder.id)}
                        className={styles.folderItem}
                        aria-current={active ? "true" : undefined}
                        onClick={() => onFolderSelect(active ? null : folder.id)}
                      >
                        <FolderIcon size={14} aria-hidden="true" />
                        <span className={styles.folderLabel}>{folder.name}</span>
                        <span className={styles.folderCount}>{subtreeCount(folder.id)}</span>
                      </button>
                      <span className={styles.rowTools}>
                        {depth < MAX_VISIBLE_DEPTH ? (
                          <button
                            type="button"
                            className={styles.iconButton}
                            aria-label={`New folder inside ${folder.name}`}
                            title="New sub-folder"
                            disabled={edit !== null}
                            onClick={() => setEdit({ mode: "create", parentId: folder.id })}
                          >
                            <FolderPlus size={13} aria-hidden="true" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={styles.iconButton}
                          aria-label={`Rename ${folder.name}`}
                          title="Rename"
                          disabled={edit !== null}
                          onClick={() =>
                            setEdit({ mode: "rename", id: folder.id, initial: folder.name })
                          }
                        >
                          <Pencil size={13} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className={`${styles.iconButton} ${styles.iconButtonDanger}`}
                          aria-label={`Delete ${folder.name}`}
                          title="Delete"
                          disabled={edit !== null}
                          onClick={() => {
                            onClearFolderError?.();
                            setPendingDelete(folder);
                          }}
                        >
                          <Trash2 size={13} aria-hidden="true" />
                        </button>
                      </span>
                    </div>
                  )}
                  {edit?.mode === "create" && edit.parentId === folder.id ? (
                    <FolderNameInput
                      initial=""
                      depth={depth + 1}
                      busy={busy}
                      label={`New folder inside ${folder.name}`}
                      onSubmit={submitEdit}
                      onCancel={cancelEdit}
                    />
                  ) : null}
                </div>
              );
            })}
            {edit?.mode === "create" && edit.parentId === undefined ? (
              <FolderNameInput
                initial=""
                depth={0}
                busy={busy}
                label="New folder name"
                onSubmit={submitEdit}
                onCancel={cancelEdit}
              />
            ) : null}
          </div>

          {folderError ? (
            <p className={styles.folderError} role="alert">
              {folderError}
            </p>
          ) : null}
        </div>
      </div>

      <div className={styles.footer}>
        <button
          type="button"
          className={`${styles.footerButton} ${view === "vault" && archived ? styles.footerButtonActive : ""}`}
          aria-current={view === "vault" && archived ? "true" : undefined}
          onClick={onOpenArchive}
        >
          <Archive size={16} aria-hidden="true" />
          <span>Archive</span>
        </button>
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

      {pendingDelete ? (
        <FolderDeleteDialog
          folderName={pendingDelete.name}
          itemCount={subtreeCount(pendingDelete.id)}
          submitting={busy}
          error={folderError}
          onCancel={() => {
            if (busy) return;
            setPendingDelete(null);
            focusAfterDialog(pendingDelete.id);
          }}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </aside>
  );
}

const folderButtonId = (folderId: string) => `vault-folder-${folderId}`;

interface FolderNameInputProps {
  initial: string;
  depth: number;
  busy: boolean;
  label: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}

/** Inline name editor: Enter saves, Escape or blur cancels, an empty name is a cancel. */
function FolderNameInput({
  initial,
  depth,
  busy,
  label,
  onSubmit,
  onCancel,
}: FolderNameInputProps) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy) void onSubmit(value);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <form
      className={styles.folderEditor}
      style={{ paddingInlineStart: `calc(var(--space-2) + ${depth} * 14px)` }}
      onSubmit={submit}
    >
      <FolderIcon size={14} aria-hidden="true" />
      <input
        ref={inputRef}
        className={styles.folderInput}
        aria-label={label}
        value={value}
        maxLength={80}
        disabled={busy}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // A click on Save moves focus before the submit lands; let that path win.
          if (!busy && value.trim() === "") onCancel();
        }}
      />
      <button
        type="submit"
        className={styles.iconButton}
        aria-label="Save folder name"
        disabled={busy}
      >
        <Plus size={13} aria-hidden="true" />
      </button>
    </form>
  );
}
