import type { OtpItem, VaultItemKind } from "@shardpass/domain";
import type { OtpEditableInput, OtpResponse } from "@shardpass/messaging";
import { AppHeader, SearchBar, StatusBadge, ThemeToggle, type CategoryKey, type Status } from "@shardpass/ui";
import { useCallback, useState } from "react";

import { useFoundationStatus } from "../foundation/useFoundationStatus";
import type {
  BackupUiExtensionPlatform,
  EnteUiPlatform,
  ExtensionPlatform,
  OtpImportUiExtensionPlatform,
} from "../platform/extension-platform";
import { VaultAccess } from "../vault-access/VaultAccess";
import { EmptyDetailState } from "./components/EmptyDetailState";
import { EmptyVaultState } from "./components/EmptyVaultState";
import { CardForm } from "./components/forms/CardForm";
import { IdentityForm } from "./components/forms/IdentityForm";
import { LoginForm } from "./components/forms/LoginForm";
import { NoteForm } from "./components/forms/NoteForm";
import { SecretForm } from "./components/forms/SecretForm";
import { updateItem } from "./components/forms/submit-item";
import { ItemDetailPanel } from "./components/ItemDetailPanel";
import { ItemListPanel } from "./components/ItemListPanel";
import { NewItemMenu } from "./components/NewItemMenu";
import { VaultSidebar, type VaultSidebarView } from "./components/VaultSidebar";
import { EnteSettings } from "./ente/EnteSettings";
import { useFolders } from "./hooks/useFolders";
import { countByKind, useVaultState } from "./hooks/useVaultState";
import { ImportDialog } from "./import/ImportDialog";
import { countItemsByFolder } from "./item-support";
import { MigrationPanel } from "./migration/MigrationPanel";
import { defaultOtpInput, OtpEditor } from "./otp/OtpEditor";
import styles from "./VaultApp.module.css";

export interface VaultAppProps {
  platform: ExtensionPlatform &
    OtpImportUiExtensionPlatform &
    BackupUiExtensionPlatform &
    EnteUiPlatform;
}

function statusPresentation(state: "loading" | "ready" | "error"): {
  label: string;
  status: Status;
} {
  switch (state) {
    case "loading":
      return { label: "Connecting", status: "neutral" };
    case "ready":
      return { label: "Ready", status: "success" };
    case "error":
      return { label: "Background unavailable", status: "error" };
  }
}

const createOtpError = "Could not create this item. Try again.";

export function VaultApp({ platform }: VaultAppProps) {
  const foundation = useFoundationStatus(platform);
  const presentation = statusPresentation(foundation.state);
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [view, setView] = useState<VaultSidebarView>("vault");
  const [creatingKind, setCreatingKind] = useState<VaultItemKind | null>(null);
  const [otpCreating, setOtpCreating] = useState(false);
  const [otpCreateError, setOtpCreateError] = useState("");

  const folderState = useFolders(platform, vaultUnlocked);
  const vaultState = useVaultState(platform, vaultUnlocked, folderState.folders);
  const selectedItem =
    creatingKind === null ? (vaultState.items.find((item) => item.id === vaultState.selectedId) ?? null) : null;
  const otpItems = vaultState.allItems.filter((item): item is OtpItem => item.kind === "otp");
  const folderCounts = countItemsByFolder(vaultState.allItems);

  const goToVaultView = useCallback(() => {
    setView("vault");
    setCreatingKind(null);
    vaultState.setArchived(false);
  }, [vaultState]);

  const openArchive = useCallback(() => {
    setView("vault");
    setCreatingKind(null);
    vaultState.setSelectedId(null);
    vaultState.setCategory("all");
    vaultState.setFolderId(null);
    vaultState.setArchived(true);
  }, [vaultState]);

  // Deleting a folder un-files its items in the background; the list must catch up.
  const deleteFolder = useCallback(
    async (id: string) => {
      const ok = await folderState.remove(id);
      if (ok) vaultState.refresh();
      return ok;
    },
    [folderState, vaultState],
  );

  const selectItem = useCallback(
    (id: string) => {
      setCreatingKind(null);
      vaultState.setSelectedId(id);
    },
    [vaultState],
  );

  const handleCategoryChange = useCallback(
    (category: CategoryKey) => {
      goToVaultView();
      vaultState.setCategory(category);
    },
    [goToVaultView, vaultState],
  );

  const handleFolderSelect = useCallback(
    (folderId: string | null) => {
      goToVaultView();
      vaultState.setFolderId(folderId);
    },
    [goToVaultView, vaultState],
  );

  const handleUpdate = useCallback(() => vaultState.refresh(), [vaultState]);
  const handleDeleted = useCallback(() => {
    vaultState.setSelectedId(null);
    vaultState.refresh();
  }, [vaultState]);

  const startCreate = useCallback(
    (kind: VaultItemKind) => {
      setView("vault");
      vaultState.setArchived(false);
      vaultState.setSelectedId(null);
      setOtpCreateError("");
      setCreatingKind(kind);
    },
    [vaultState],
  );

  const cancelCreate = useCallback(() => setCreatingKind(null), []);

  // Shared by every non-OTP create form: only `id` is needed to select the new item,
  // and every VaultItem kind carries one, so this is safe to reuse across kinds.
  const handleCreated = useCallback(
    (item: { id: string; revision: number }) => {
      // Created while browsing a folder: file it there, the way a file manager saves into
      // the open directory. The forms know nothing about folders, so it is one update.
      const folderId = vaultState.folderId;
      setCreatingKind(null);
      vaultState.setCategory("all");
      const filed =
        folderId === null
          ? Promise.resolve()
          : updateItem(platform, item.id, item.revision, { folderId }).then(() => undefined);
      void filed.finally(() => {
        vaultState.refresh();
        vaultState.setSelectedId(item.id);
      });
    },
    [platform, vaultState],
  );

  const submitOtpCreate = useCallback(
    async (value: OtpEditableInput) => {
      setOtpCreating(true);
      setOtpCreateError("");
      try {
        const response: OtpResponse = await platform.sendOtpMessage({
          version: 1,
          kind: "otp.create",
          input: value,
        });
        if (response.kind === "otp.mutationResult") {
          handleCreated(response.item);
        } else {
          setOtpCreateError(createOtpError);
        }
      } catch {
        setOtpCreateError(createOtpError);
      } finally {
        setOtpCreating(false);
      }
    },
    [handleCreated, platform],
  );

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#vault-content">
        Skip to vault content
      </a>

      <AppHeader
        title="ShardPass"
        actions={<StatusBadge status={presentation.status}>{presentation.label}</StatusBadge>}
      />

      <main className={styles.main} id="vault-content" tabIndex={-1}>
        {foundation.state !== "ready" ? (
          <EmptyVaultState foundation={foundation} />
        ) : !vaultUnlocked ? (
          <div className={styles.accessRegion}>
            <VaultAccess platform={platform} securityControls onUnlockedChange={setVaultUnlocked} />
          </div>
        ) : (
          <div className={styles.vault}>
            <div className={styles.sidebarColumn}>
              <VaultSidebar
                category={vaultState.category}
                onCategoryChange={handleCategoryChange}
                itemCounts={countByKind(vaultState.allItems)}
                folders={folderState.folders}
                folderCounts={folderCounts}
                selectedFolderId={vaultState.folderId}
                onFolderSelect={handleFolderSelect}
                folderError={folderState.error}
                onCreateFolder={folderState.create}
                onRenameFolder={folderState.rename}
                onDeleteFolder={deleteFolder}
                archived={vaultState.archived}
                onOpenArchive={openArchive}
                view={view}
                onOpenSettings={() => setView("settings")}
                onOpenEnte={() => setView("ente")}
              />
            </div>

            {view === "vault" ? (
              <>
                <div className={styles.list}>
                  <div className={styles.listHeader}>
                    <SearchBar
                      value={vaultState.search}
                      onChange={vaultState.setSearch}
                      placeholder={vaultState.archived ? "Search archive" : "Search vault"}
                    />
                    {vaultState.archived ? null : <NewItemMenu onSelect={startCreate} />}
                  </div>
                  <div className={styles.listBody}>
                    <ItemListPanel
                      items={vaultState.items}
                      selectedId={creatingKind === null ? vaultState.selectedId : null}
                      onSelect={selectItem}
                      status={vaultState.status}
                      search={vaultState.search}
                      category={vaultState.category}
                      archived={vaultState.archived}
                      onRetry={vaultState.refresh}
                      {...(vaultState.archived ? {} : { onCreate: () => startCreate("login") })}
                    />
                  </div>
                </div>

                <div className={styles.detail}>
                  {creatingKind === "otp" ? (
                    <>
                      <OtpEditor
                        mode="create"
                        value={defaultOtpInput}
                        submitting={otpCreating}
                        onSubmit={submitOtpCreate}
                        onCancel={cancelCreate}
                      />
                      {otpCreateError ? (
                        <p role="alert">{otpCreateError}</p>
                      ) : null}
                    </>
                  ) : creatingKind === "login" ? (
                    <LoginForm
                      platform={platform}
                      otpItems={otpItems}
                      onSaved={handleCreated}
                      onCancel={cancelCreate}
                    />
                  ) : creatingKind === "note" ? (
                    <NoteForm platform={platform} onSaved={handleCreated} onCancel={cancelCreate} />
                  ) : creatingKind === "card" ? (
                    <CardForm platform={platform} onSaved={handleCreated} onCancel={cancelCreate} />
                  ) : creatingKind === "identity" ? (
                    <IdentityForm platform={platform} onSaved={handleCreated} onCancel={cancelCreate} />
                  ) : creatingKind === "secret" ? (
                    <SecretForm platform={platform} onSaved={handleCreated} onCancel={cancelCreate} />
                  ) : selectedItem ? (
                    <ItemDetailPanel
                      item={selectedItem}
                      platform={platform}
                      otpItems={otpItems}
                      folders={folderState.folders}
                      onUpdate={handleUpdate}
                      onDeleted={handleDeleted}
                    />
                  ) : (
                    <EmptyDetailState />
                  )}
                </div>
              </>
            ) : (
              <div className={styles.settingsPanel}>
                {view === "settings" ? (
                  <>
                    <section className={styles.settingsCard} aria-labelledby="appearance-heading">
                      <h3 id="appearance-heading" className={styles.settingsCardTitle}>
                        Appearance
                      </h3>
                      <ThemeToggle />
                    </section>
                    <VaultAccess platform={platform} securityControls onUnlockedChange={setVaultUnlocked} />
                    <MigrationPanel platform={platform} active onCompleted={handleUpdate} />
                    <ImportDialog platform={platform} active onImported={handleUpdate} />
                  </>
                ) : (
                  <EnteSettings platform={platform} active onSynced={handleUpdate} />
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
