import { VAULT_SORTS, type OtpItem, type VaultItemKind, type VaultSort } from "@shardpass/domain";
import type { OtpEditableInput, OtpResponse } from "@shardpass/messaging";
import {
  AppHeader,
  SearchBar,
  StatusBadge,
  ThemeToggle,
  type CategoryKey,
  type Status,
} from "@shardpass/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useFoundationStatus } from "../foundation/useFoundationStatus";
import { clearClipboardIfDue, clearClipboardNow } from "./components/detail/clipboard";
import type {
  BackupUiExtensionPlatform,
  EnteUiPlatform,
  ExtensionPlatform,
  OtpImportUiExtensionPlatform,
} from "../platform/extension-platform";
import { RepromptPrompt } from "../vault-access/RepromptPrompt";
import { computeHealth } from "./health/health-report";
import { HealthView, type HealthFocus } from "./health/HealthView";
import { VaultAccess } from "../vault-access/VaultAccess";
import { BreachCheckSettings } from "./settings/BreachCheckSettings";
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
import { VaultSidebar, type GeneratorTool, type VaultSidebarView } from "./components/VaultSidebar";
import { AboutView } from "./about/AboutView";
import { OverviewView } from "./overview/OverviewView";
import { EmailAliasView } from "./tools/EmailAliasView";
import { GeneratorView } from "./tools/GeneratorView";
import { EnteSettings } from "./ente/EnteSettings";
import { useFolders } from "./hooks/useFolders";
import { countByKind, useVaultState } from "./hooks/useVaultState";
import { ImportDialog } from "./import/ImportDialog";
import { DeleteItemDialog } from "./components/DeleteItemDialog";
import { countItemsByFolder, folderPath, folderSubtreeIds } from "./item-support";
import { MigrationPanel } from "./migration/MigrationPanel";
import { defaultOtpInput, OtpEditor } from "./otp/OtpEditor";
import styles from "./VaultApp.module.css";
import { parseVaultPageHash, type VaultPageTarget } from "../platform/vault-route";

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

/** What "add one" means in the open category: a login for "all", the category's kind otherwise. */
function kindForCategory(category: CategoryKey): VaultItemKind {
  if (category === "all") return "login";
  if (category === "api_key" || category === "ssh_key") return "secret";
  return category;
}

export function VaultApp({ platform }: VaultAppProps) {
  const foundation = useFoundationStatus(platform);
  const presentation = statusPresentation(foundation.state);
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [view, setView] = useState<VaultSidebarView>("vault");
  // Which finding the health page should open at, when the dashboard sent the reader there.
  const [healthFocus, setHealthFocus] = useState<HealthFocus | undefined>(undefined);
  const [generatorTool, setGeneratorTool] = useState<GeneratorTool>("random");
  const [creatingKind, setCreatingKind] = useState<VaultItemKind | null>(null);
  const [otpCreating, setOtpCreating] = useState(false);
  const [otpCreateError, setOtpCreateError] = useState("");
  /** A newly created item that could not be filed into the folder being browsed. */
  const [filingError, setFilingError] = useState("");
  /** What to do once the person has said the half-filled create form may go. */
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  // A just-created item is selected before the list has re-fetched it; the detail pane
  // stays blank for that beat instead of flashing "Select an item".
  const [pendingId, setPendingId] = useState<string | null>(null);

  const folderState = useFolders(platform, vaultUnlocked);
  const vaultState = useVaultState(platform, vaultUnlocked, folderState.folders);
  // From every loaded item, not the filtered list: a search that excludes the selected item
  // must not unmount its detail (and any edit in progress) under the person.
  const selectedItem =
    creatingKind === null
      ? (vaultState.allItems.find((item) => item.id === vaultState.selectedId) ?? null)
      : null;
  const otpItems = vaultState.allItems.filter((item): item is OtpItem => item.kind === "otp");
  const folderCounts = countItemsByFolder(vaultState.liveItems);
  // The findings the vault can count on its own: shared passwords and unencrypted sites.
  const healthCount = useMemo(() => {
    const report = computeHealth(vaultState.liveItems, vaultState.redactedIds);
    return (
      report.reused.reduce((sum, group) => sum + group.logins.length, 0) + report.unsecured.length
    );
  }, [vaultState.liveItems, vaultState.redactedIds]);

  /**
   * What a create form looked like when it opened. The forms do not report their own state,
   * and asking every kind to would be a wide change; what a person would lose is what is in
   * the fields, so the fields are what gets compared.
   */
  const draftOpenedWith = useRef<string[]>([]);
  const readDraftFields = useCallback((): string[] => {
    const region = document.getElementById("vault-content");
    if (region === null) return [];
    return [...region.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")]
      .filter(
        (field) =>
          !(field instanceof HTMLInputElement) ||
          (field.type !== "checkbox" && field.type !== "radio"),
      )
      .map((field) => field.value);
  }, []);

  useEffect(() => {
    draftOpenedWith.current = creatingKind === null ? [] : readDraftFields();
  }, [creatingKind, readDraftFields]);

  /** Whether the open create form holds anything the person typed into it. */
  const createFormHasInput = useCallback((): boolean => {
    const opened = draftOpenedWith.current;
    return readDraftFields().some(
      (value, index) => value.trim() !== "" && value !== (opened[index] ?? ""),
    );
  }, [readDraftFields]);

  /** Runs `next`, first asking about a create form that would be discarded by it. */
  const leavingCreate = useCallback(
    (next: () => void): void => {
      if (creatingKind === null || !createFormHasInput()) {
        next();
        return;
      }
      setPendingLeave(() => next);
    },
    [createFormHasInput, creatingKind],
  );

  const goToVaultView = useCallback(() => {
    leavingCreate(() => {
      setView("vault");
      setCreatingKind(null);
      vaultState.setArchived(false);
    });
  }, [leavingCreate, vaultState]);

  const openArchive = useCallback(() => {
    leavingCreate(() => {
      setView("vault");
      setCreatingKind(null);
      vaultState.setSelectedId(null);
      vaultState.setCategory("all");
      vaultState.setFolderId(null);
      vaultState.setArchived(true);
    });
  }, [leavingCreate, vaultState]);

  // Deleting a folder un-files its items in the background; the list must catch up.
  const deleteFolder = useCallback(
    async (id: string) => {
      const affected = folderSubtreeIds(folderState.folders, id);
      const ok = await folderState.remove(id);
      if (!ok) return false;
      // The filter went with the folder. Clearing it here, rather than through the sidebar's
      // own selection, keeps whoever was reading Settings or Health where they were.
      if (vaultState.folderId !== null && affected.has(vaultState.folderId))
        vaultState.setFolderId(null);
      vaultState.refresh();
      return true;
    },
    [folderState, vaultState],
  );

  const selectItem = useCallback(
    (id: string) => {
      leavingCreate(() => {
        setCreatingKind(null);
        vaultState.setSelectedId(id);
      });
    },
    [leavingCreate, vaultState],
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

  // A copy made in the popup is cleared by whichever ShardPass document is focused when the
  // delay runs out; this page is one, so it finishes the job on every return to it.
  useEffect(() => {
    void clearClipboardIfDue();
    const onFocus = () => void clearClipboardIfDue();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // A lock ends the session; anything copied during it leaves the clipboard with it.
  useEffect(() => {
    if (!vaultUnlocked) void clearClipboardNow();
  }, [vaultUnlocked]);

  useEffect(() => {
    if (pendingId === null) return;
    if (
      vaultState.selectedId !== pendingId ||
      vaultState.allItems.some((item) => item.id === pendingId)
    )
      setPendingId(null);
  }, [pendingId, vaultState.allItems, vaultState.selectedId]);

  const handleUpdate = useCallback(() => vaultState.refresh(), [vaultState]);
  // An import can create folders too; the sidebar must learn about them.
  const handleImported = useCallback(() => {
    folderState.refresh();
    vaultState.refresh();
  }, [folderState, vaultState]);
  const handleDeleted = useCallback(() => {
    vaultState.setSelectedId(null);
    vaultState.refresh();
    // The button that was pressed is gone with the item; land on the vault content region.
    document.getElementById("vault-content")?.focus();
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

  const cancelCreate = useCallback(() => {
    setCreatingKind(null);
    // The form and its buttons are gone; land on the content region, not the page body.
    document.getElementById("vault-content")?.focus();
  }, []);

  // From Health or the Overview: the item must be visible once selected, so the filters that
  // could hide it are cleared the way a deep link clears them.
  const openItemFromElsewhere = useCallback(
    (itemId: string) => {
      goToVaultView();
      vaultState.setCategory("all");
      vaultState.setFolderId(null);
      vaultState.setSearch("");
      vaultState.setSelectedId(itemId);
    },
    [goToVaultView, vaultState],
  );

  // Deep links from the popup and the save prompt ride in the URL hash; they apply once the
  // vault is unlocked (a locked page keeps them until then) and are then cleared, so a
  // reload does not replay "new login" or reopen an item.
  const [route, setRoute] = useState<VaultPageTarget | null>(() =>
    parseVaultPageHash(window.location.hash),
  );
  useEffect(() => {
    const onHashChange = () => {
      const next = parseVaultPageHash(window.location.hash);
      if (next !== null) setRoute(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  useEffect(() => {
    if (route === null || !vaultUnlocked) return;
    if ("view" in route) {
      setCreatingKind(null);
      if (route.view === "generator" || route.view === "usernames") {
        setGeneratorTool(route.view === "usernames" ? "username" : "random");
        setView("generator");
      } else setView(route.view === "import" ? "settings" : route.view);
    } else if ("newItem" in route) startCreate(route.newItem);
    else {
      goToVaultView();
      vaultState.setCategory("all");
      vaultState.setFolderId(null);
      vaultState.setSelectedId(route.item);
    }
    setRoute(null);
    if (window.location.hash !== "")
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, [route, vaultUnlocked, startCreate, goToVaultView, vaultState]);

  // Shared by every non-OTP create form: only `id` is needed to select the new item,
  // and every VaultItem kind carries one, so this is safe to reuse across kinds.
  const handleCreated = useCallback(
    (item: { id: string; revision: number }) => {
      // Created while browsing a folder: file it there, the way a file manager saves into
      // the open directory. The forms know nothing about folders, so it is one update.
      const folderId = vaultState.folderId;
      setCreatingKind(null);
      setFilingError("");
      setPendingId(item.id);
      vaultState.setSelectedId(item.id);
      vaultState.setCategory("all");
      vaultState.setSearch("");
      const filed =
        folderId === null
          ? Promise.resolve()
          : updateItem(platform, item.id, item.revision, { folderId }).then(() => undefined);
      // The item exists either way; only the filing can fail, and it says so instead of
      // becoming an unhandled rejection with the item silently outside the open folder.
      void filed
        .catch(() => setFilingError("Saved, but it could not be filed in this folder."))
        .finally(() => {
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
        actions={
          <StatusBadge live status={presentation.status}>
            {presentation.label}
          </StatusBadge>
        }
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
                itemCounts={countByKind(vaultState.liveItems)}
                folders={folderState.folders}
                folderCounts={folderCounts}
                selectedFolderId={vaultState.folderId}
                onFolderSelect={handleFolderSelect}
                folderError={folderState.error}
                onCreateFolder={folderState.create}
                onRenameFolder={folderState.rename}
                onDeleteFolder={deleteFolder}
                onClearFolderError={folderState.clearError}
                archived={vaultState.archived}
                onOpenArchive={openArchive}
                view={view}
                onOpenSettings={() => leavingCreate(() => setView("settings"))}
                onOpenEnte={() => leavingCreate(() => setView("ente"))}
                onOpenHealth={() =>
                  leavingCreate(() => {
                    setHealthFocus(undefined);
                    setView("health");
                  })
                }
                healthCount={healthCount}
                onOpenGenerator={(tool) =>
                  leavingCreate(() => {
                    setGeneratorTool(tool);
                    setView("generator");
                  })
                }
                onOpenAliases={() => leavingCreate(() => setView("aliases"))}
                onOpenOverview={() => leavingCreate(() => setView("overview"))}
                onOpenAbout={() => leavingCreate(() => setView("about"))}
                generatorTool={generatorTool}
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
                      list="vault-tag-suggestions"
                    />
                    <datalist id="vault-tag-suggestions">
                      {vaultState.tagVocabulary.map((tag) => (
                        <option key={tag} value={`#${tag}`} />
                      ))}
                    </datalist>
                    <select
                      className={styles.sort}
                      aria-label="Sort items"
                      value={vaultState.sort}
                      onChange={(event) => vaultState.setSort(event.target.value as VaultSort)}
                    >
                      {VAULT_SORTS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
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
                      {...(vaultState.folderId === null
                        ? {}
                        : { folderName: folderPath(folderState.folders, vaultState.folderId) })}
                      {...(vaultState.archived
                        ? {}
                        : {
                            onCreate: () => startCreate(kindForCategory(vaultState.category)),
                            onImport: () => setView("settings"),
                          })}
                    />
                  </div>
                </div>

                <div className={styles.detail}>
                  {filingError ? (
                    <p role="alert" className={styles.notice}>
                      {filingError}
                    </p>
                  ) : null}
                  {creatingKind === "otp" ? (
                    <>
                      <OtpEditor
                        mode="create"
                        value={defaultOtpInput}
                        submitting={otpCreating}
                        onSubmit={submitOtpCreate}
                        onCancel={cancelCreate}
                      />
                      {otpCreateError ? <p role="alert">{otpCreateError}</p> : null}
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
                    <IdentityForm
                      platform={platform}
                      onSaved={handleCreated}
                      onCancel={cancelCreate}
                    />
                  ) : creatingKind === "secret" ? (
                    <SecretForm
                      platform={platform}
                      onSaved={handleCreated}
                      onCancel={cancelCreate}
                    />
                  ) : selectedItem && vaultState.redactedIds.has(selectedItem.id) ? (
                    <RepromptPrompt
                      key={selectedItem.id}
                      platform={platform}
                      itemId={selectedItem.id}
                      action="open"
                      onGranted={vaultState.refresh}
                    />
                  ) : selectedItem ? (
                    <ItemDetailPanel
                      // Keyed by item: an edit form or a revealed field must never survive a
                      // click onto a different item of the same kind.
                      key={selectedItem.id}
                      item={selectedItem}
                      platform={platform}
                      otpItems={otpItems}
                      folders={folderState.folders}
                      onUpdate={handleUpdate}
                      onDeleted={handleDeleted}
                    />
                  ) : pendingId !== null && pendingId === vaultState.selectedId ? null : (
                    <EmptyDetailState />
                  )}
                </div>
              </>
            ) : null}
            {/* Settings and Ente stay mounted while the vault is open: an import preview, a
                backup in progress or an Ente sign-in survives a look at the vault, and the
                security controls keep listening for a lock from any view. */}
            {/* Each card is a grid cell of its own (no wrappers: an empty wrapper for a
                migration panel that renders nothing would leave a hole), framed and sized
                alike by the panel's rules. */}
            {/* Security first, then the short cards: the three security cards are of a height
                with each other, and Appearance, breach checks and the import card are of a
                height with each other, so each row of tiles comes out even. */}
            <div className={styles.settingsPanel} hidden={view !== "settings"}>
              <VaultAccess
                platform={platform}
                securityControls
                onUnlockedChange={setVaultUnlocked}
              />
              <section className={styles.settingsCard} aria-labelledby="appearance-heading">
                <h3 id="appearance-heading" className={styles.settingsCardTitle}>
                  Appearance
                </h3>
                <ThemeToggle />
              </section>
              <BreachCheckSettings platform={platform} active={view === "settings"} />
              <MigrationPanel
                platform={platform}
                active={view === "settings"}
                onCompleted={vaultState.refresh}
              />
              <ImportDialog
                platform={platform}
                active={view === "settings"}
                onImported={handleImported}
                onDone={goToVaultView}
              />
            </div>
            {view === "health" ? (
              <div className={`${styles.settingsPanel} ${styles.settingsPanelSingle}`}>
                <HealthView
                  platform={platform}
                  items={vaultState.liveItems}
                  redactedIds={vaultState.redactedIds}
                  active={view === "health"}
                  onOpenItem={openItemFromElsewhere}
                  focus={healthFocus}
                />
              </div>
            ) : null}
            {view === "overview" ? (
              <div className={`${styles.settingsPanel} ${styles.settingsPanelSingle}`}>
                <OverviewView
                  platform={platform}
                  items={vaultState.liveItems}
                  folderCount={folderState.folders.length}
                  redactedIds={vaultState.redactedIds}
                  active={view === "overview"}
                  onOpenItem={openItemFromElsewhere}
                  onOpenHealth={(focus) => {
                    setHealthFocus(focus);
                    setView("health");
                  }}
                  onOpenGenerator={() => {
                    setGeneratorTool("random");
                    setView("generator");
                  }}
                  onOpenImport={() => setView("settings")}
                  onNewLogin={() => {
                    goToVaultView();
                    startCreate("login");
                  }}
                />
              </div>
            ) : null}
            {view === "generator" ? (
              <div className={`${styles.settingsPanel} ${styles.settingsPanelSingle}`}>
                <GeneratorView platform={platform} mode={generatorTool} />
              </div>
            ) : null}
            {view === "about" ? (
              <div className={`${styles.settingsPanel} ${styles.settingsPanelSingle}`}>
                <AboutView />
              </div>
            ) : null}
            <div
              className={`${styles.settingsPanel} ${styles.settingsPanelSingle}`}
              hidden={view !== "aliases"}
            >
              <EmailAliasView platform={platform} active={view === "aliases"} />
            </div>
            <div
              className={`${styles.settingsPanel} ${styles.settingsPanelSingle}`}
              hidden={view !== "ente"}
            >
              <EnteSettings platform={platform} active={view === "ente"} onSynced={handleUpdate} />
            </div>
          </div>
        )}
      </main>
      {pendingLeave !== null ? (
        <DeleteItemDialog
          itemName="this new item"
          title="Discard this draft?"
          description="What you have typed has not been saved yet."
          confirmLabel="Discard"
          submitting={false}
          onCancel={() => setPendingLeave(null)}
          onConfirm={() => {
            const leave = pendingLeave;
            setPendingLeave(null);
            leave();
          }}
        />
      ) : null}
    </div>
  );
}
