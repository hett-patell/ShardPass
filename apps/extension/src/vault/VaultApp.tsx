import type { OtpItem, VaultItemKind } from "@shardpass/domain";
import type { OtpEditableInput, OtpResponse } from "@shardpass/messaging";
import { AppHeader, SearchBar, StatusBadge, type CategoryKey, type Status } from "@shardpass/ui";
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
import { ItemDetailPanel } from "./components/ItemDetailPanel";
import { ItemListPanel } from "./components/ItemListPanel";
import { NewItemMenu } from "./components/NewItemMenu";
import { VaultSidebar, type VaultSidebarView } from "./components/VaultSidebar";
import { EnteSettings } from "./ente/EnteSettings";
import { countByKind, useVaultState } from "./hooks/useVaultState";
import { ImportDialog } from "./import/ImportDialog";
import { summarizeFolders } from "./item-support";
import { MigrationPanel } from "./migration/MigrationPanel";
import { defaultOtpInput, OtpEditor } from "./otp/OtpEditor";
import { BackupView } from "./settings/BackupView";
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
      return { label: "Checking foundation", status: "neutral" };
    case "ready":
      return { label: "Foundation ready", status: "success" };
    case "error":
      return { label: "Foundation unavailable", status: "error" };
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

  const vaultState = useVaultState(platform, vaultUnlocked);
  const selectedItem =
    creatingKind === null ? (vaultState.items.find((item) => item.id === vaultState.selectedId) ?? null) : null;
  const otpItems = vaultState.allItems.filter((item): item is OtpItem => item.kind === "otp");
  const folders = summarizeFolders(vaultState.allItems);

  const goToVaultView = useCallback(() => {
    setView("vault");
    setCreatingKind(null);
  }, []);

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
    (item: { id: string }) => {
      setCreatingKind(null);
      vaultState.setCategory("all");
      vaultState.setFolderId(null);
      vaultState.refresh();
      vaultState.setSelectedId(item.id);
    },
    [vaultState],
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
        eyebrow="ENCRYPTED VAULT"
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
                folders={folders}
                selectedFolderId={vaultState.folderId}
                onFolderSelect={handleFolderSelect}
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
                      placeholder="Search vault"
                    />
                    <NewItemMenu onSelect={startCreate} />
                  </div>
                  <div className={styles.listBody}>
                    <ItemListPanel
                      items={vaultState.items}
                      selectedId={creatingKind === null ? vaultState.selectedId : null}
                      onSelect={selectItem}
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
                    <VaultAccess platform={platform} securityControls onUnlockedChange={setVaultUnlocked} />
                    <MigrationPanel platform={platform} active onCompleted={handleUpdate} />
                    <ImportDialog platform={platform} active onImported={handleUpdate} />
                    <BackupView platform={platform} active onImported={handleUpdate} />
                  </>
                ) : (
                  <EnteSettings platform={platform} active />
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
