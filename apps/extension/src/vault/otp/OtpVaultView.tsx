import type { OtpEditableInput, OtpListItemProjection } from "@shardpass/messaging";
import { Button } from "@shardpass/ui";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ExtensionPlatform,
  OtpImportUiExtensionPlatform,
} from "../../platform/extension-platform";
import { DeleteOtpDialog } from "./DeleteOtpDialog";
import { defaultOtpInput, OtpEditor } from "./OtpEditor";
import { OtpImportView } from "./import/OtpImportView";
import styles from "./OtpVaultView.module.css";
import { useOtpVault } from "./useOtpVault";

export interface OtpVaultViewProps {
  platform: ExtensionPlatform & OtpImportUiExtensionPlatform;
  active: boolean;
  refreshToken?: number;
  onImported?: () => void;
}

type EditorMode = "closed" | "create" | "edit" | "import";

const LIST_WINDOW_SIZE = 40;
const LIST_WINDOW_OVERSCAN = 5;
export const OTP_VAULT_ROW_HEIGHT_PX = 54;

function safeItemLabel(item: OtpListItemProjection): string {
  return item.issuer ? `${item.issuer} — ${item.label}` : item.label;
}

function editableValue(value: OtpEditableInput): OtpEditableInput {
  return {
    issuer: value.issuer,
    label: value.label,
    secret: value.secret,
    otpType: value.otpType,
    algorithm: value.algorithm,
    digits: value.digits,
    period: value.period,
    ...(value.counter === undefined ? {} : { counter: value.counter }),
    favorite: value.favorite,
    tags: [...value.tags],
    note: value.note,
  };
}

export function OtpVaultView({
  platform,
  active,
  refreshToken = 0,
  onImported,
}: OtpVaultViewProps) {
  const vault = useOtpVault(platform, active);
  const [mode, setMode] = useState<EditorMode>("closed");
  const [attempted, setAttempted] = useState<OtpEditableInput | null>(null);
  const [conflict, setConflict] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConflict, setDeleteConflict] = useState(false);
  const [windowStart, setWindowStart] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const operation = useRef(0);
  const deleteOpener = useRef<HTMLButtonElement | null>(null);
  const listboxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (active && refreshToken > 0) void vault.refreshList(vault.query.trim());
  }, [active, refreshToken]); // refreshList/query intentionally excluded: token owns this refresh.

  useEffect(() => {
    if (!active) {
      operation.current += 1;
      setMode("closed");
      setAttempted(null);
      setConflict(false);
      setDeleteOpen(false);
      setDeleteConflict(false);
      setSubmitting(false);
    }
  }, [active]);

  useEffect(() => {
    if (vault.state.status === "error") {
      operation.current += 1;
      setMode("closed");
      setAttempted(null);
      setConflict(false);
      setDeleteOpen(false);
      setDeleteConflict(false);
      setSubmitting(false);
      return;
    }
    if (vault.state.editor !== null && vault.state.selectedId === vault.state.editor.id) {
      setMode("edit");
      if (!conflict) setAttempted(null);
    }
  }, [conflict, vault.state.editor, vault.state.selectedId]);

  useEffect(() => {
    setWindowStart(0);
  }, [vault.query]);

  const selectedItem = vault.state.items.find(({ id }) => id === vault.state.selectedId) ?? null;
  const editorValue = useMemo(
    () => attempted ?? (vault.state.editor === null ? null : editableValue(vault.state.editor)),
    [attempted, vault.state.editor],
  );
  const boundedWindowStart = Math.min(
    windowStart,
    Math.max(0, vault.state.items.length - LIST_WINDOW_SIZE),
  );
  const windowEnd = Math.min(
    vault.state.items.length,
    boundedWindowStart + LIST_WINDOW_SIZE + LIST_WINDOW_OVERSCAN,
  );
  const visibleItems = vault.state.items.slice(boundedWindowStart, windowEnd);
  const boundedActiveIndex = Math.min(activeIndex, Math.max(0, vault.state.items.length - 1));
  const activeItem =
    visibleItems.find((item) => item.id === vault.state.items[boundedActiveIndex]?.id) ??
    visibleItems[0] ??
    null;
  const detailsReady = active && vault.state.status === "ready";
  const closeDialog = () => {
    if (submitting) return;
    setDeleteOpen(false);
    deleteOpener.current?.focus();
  };

  const submit = async (value: OtpEditableInput) => {
    if (submitting) return;
    const operationToken = ++operation.current;
    setSubmitting(true);
    setConflict(false);
    setDeleteConflict(false);
    try {
      if (mode === "create") {
        const created = await vault.create(value);
        if (operationToken !== operation.current || created === null) return;
        setAttempted(null);
        setMode("edit");
      } else if (vault.state.selectedId !== null && vault.state.editor !== null) {
        const result = await vault.update(
          vault.state.selectedId,
          vault.state.editor.revision,
          value,
        );
        if (operationToken !== operation.current) return;
        if (result.status === "conflict") {
          setAttempted(value);
          setConflict(true);
        } else if (result.status === "saved") {
          setAttempted(null);
        }
      }
    } catch {
      if (operationToken === operation.current) setConflict(false);
    } finally {
      if (operationToken === operation.current) setSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (submitting || vault.state.editor === null) return;
    const operationToken = operation.current;
    const itemId = vault.state.editor.id;
    const revision = vault.state.editor.revision;
    setSubmitting(true);
    setDeleteConflict(false);
    try {
      const result = await vault.remove(itemId, revision);
      if (operationToken !== operation.current) return;
      setDeleteOpen(false);
      if (result.status === "conflict") {
        setDeleteConflict(true);
        setMode("edit");
        queueMicrotask(() => deleteOpener.current?.focus());
      } else if (result.status === "deleted") {
        setMode("closed");
        setAttempted(null);
        setConflict(false);
      }
    } catch {
      if (operationToken === operation.current) setDeleteOpen(false);
    } finally {
      if (operationToken === operation.current) setSubmitting(false);
    }
  };

  const selectItem = (item: OtpListItemProjection) => {
    operation.current += 1;
    setSubmitting(false);
    setAttempted(null);
    setConflict(false);
    setDeleteConflict(false);
    setMode("edit");
    void vault.select(item.id);
  };

  const activateItem = (index: number) => {
    const next = vault.state.items[index];
    if (next === undefined) return;
    const nextStart = Math.min(
      Math.max(0, index - LIST_WINDOW_OVERSCAN),
      Math.max(0, vault.state.items.length - LIST_WINDOW_SIZE),
    );
    setActiveIndex(index);
    setWindowStart(nextStart);
    selectItem(next);
    queueMicrotask(() => listboxRef.current?.focus());
  };

  if (!active) return null;

  return (
    <section className={styles.region} aria-labelledby="otp-vault-heading">
      <header className={styles.heading}>
        <div>
          <p className={styles.kicker}>ENCRYPTED INDEX / OTP</p>
          <h2 id="otp-vault-heading">One-time passwords</h2>
        </div>
        <div className={styles.headingActions}>
          <Button
            variant="secondary"
            disabled={!detailsReady}
            aria-pressed={mode === "import"}
            onClick={() => {
              vault.clearSelection();
              setMode("import");
              setAttempted(null);
              setConflict(false);
              setDeleteConflict(false);
            }}
          >
            Import
          </Button>
          <Button
            disabled={!detailsReady}
            onClick={() => {
              vault.clearSelection();
              setMode("create");
              setAttempted(null);
              setConflict(false);
              setDeleteConflict(false);
            }}
          >
            Create OTP
          </Button>
        </div>
      </header>

      <label className={styles.searchField} htmlFor="otp-vault-search">
        <span>Search OTP items</span>
        <input
          id="otp-vault-search"
          type="search"
          value={vault.query}
          maxLength={256}
          autoComplete="off"
          spellCheck={false}
          placeholder="Issuer, label, or tag"
          onChange={(event) => vault.setQuery(event.target.value)}
        />
      </label>

      <div className={styles.workspace}>
        <section className={styles.index} aria-labelledby="otp-index-heading">
          <header className={styles.indexHeader}>
            <h3 id="otp-index-heading">OTP index</h3>
            <span>{vault.state.items.length.toLocaleString("en-US")} ITEMS</span>
          </header>
          {vault.state.status === "loading" ? (
            <p className={styles.state}>Loading encrypted item projections…</p>
          ) : null}
          {vault.state.status === "error" ? (
            <p className={styles.error} role="alert">
              OTP items unavailable. Try again.
            </p>
          ) : null}
          {vault.state.status === "ready" && vault.state.items.length === 0 ? (
            <div className={styles.empty}>
              <strong>{vault.query.trim() ? "No matching OTP items" : "No OTP items yet"}</strong>
              <span>
                {vault.query.trim()
                  ? "Change the issuer, label, or tag search."
                  : "Create an OTP item or use legacy migration below."}
              </span>
            </div>
          ) : null}
          {vault.state.items.length > 0 ? (
            <div
              ref={listboxRef}
              className={styles.list}
              role="listbox"
              aria-label="OTP items"
              tabIndex={0}
              aria-activedescendant={
                activeItem === null ? undefined : `otp-option-${activeItem.id}`
              }
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  activateItem(boundedActiveIndex + 1);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  activateItem(boundedActiveIndex - 1);
                } else if (event.key === "Home") {
                  event.preventDefault();
                  activateItem(0);
                } else if (event.key === "End") {
                  event.preventDefault();
                  activateItem(vault.state.items.length - 1);
                }
              }}
              onScroll={(event) => {
                const nextStart = Math.max(
                  0,
                  Math.min(
                    Math.floor(event.currentTarget.scrollTop / OTP_VAULT_ROW_HEIGHT_PX) -
                      LIST_WINDOW_OVERSCAN,
                    Math.max(0, vault.state.items.length - LIST_WINDOW_SIZE),
                  ),
                );
                if (nextStart !== boundedWindowStart) {
                  setWindowStart(nextStart);
                  if (
                    boundedActiveIndex < nextStart ||
                    boundedActiveIndex >= nextStart + LIST_WINDOW_SIZE + LIST_WINDOW_OVERSCAN
                  )
                    setActiveIndex(nextStart);
                }
              }}
            >
              <div
                aria-hidden="true"
                style={{ height: boundedWindowStart * OTP_VAULT_ROW_HEIGHT_PX }}
              />
              {visibleItems.map((item, visibleIndex) => (
                <div
                  key={item.id}
                  id={`otp-option-${item.id}`}
                  role="option"
                  aria-posinset={boundedWindowStart + visibleIndex + 1}
                  aria-setsize={vault.state.items.length}
                  aria-selected={item.id === vault.state.selectedId}
                  className={styles.item}
                  onClick={() => {
                    setActiveIndex(boundedWindowStart + visibleIndex);
                    selectItem(item);
                    listboxRef.current?.focus();
                  }}
                >
                  <span className={styles.marker} aria-hidden="true" />
                  <span className={styles.itemCopy}>
                    <strong>{item.issuer || "No issuer"}</strong>
                    <span>{item.label}</span>
                  </span>
                  <span className={styles.itemMeta}>{item.otpType.toUpperCase()}</span>
                </div>
              ))}
              <div
                aria-hidden="true"
                style={{
                  height: (vault.state.items.length - windowEnd) * OTP_VAULT_ROW_HEIGHT_PX,
                }}
              />
            </div>
          ) : null}
        </section>

        <section className={styles.detail} aria-labelledby="otp-detail-heading">
          <h3 className={styles.visuallyHidden} id="otp-detail-heading">
            OTP detail
          </h3>
          {detailsReady && deleteConflict ? (
            <p className={styles.conflict} role="alert">
              This item changed before deletion. Review the latest revision before trying again.
            </p>
          ) : null}
          {detailsReady && mode === "create" ? (
            <OtpEditor
              key="create"
              mode="create"
              value={defaultOtpInput}
              submitting={submitting}
              onSubmit={submit}
              onCancel={() => setMode("closed")}
            />
          ) : null}
          {detailsReady && mode === "edit" && vault.state.loadingEditor ? (
            <p className={styles.state}>Loading selected editor…</p>
          ) : null}
          {detailsReady && mode === "edit" && editorValue !== null ? (
            <div>
              <OtpEditor
                key={vault.state.editor?.id ?? "attempted-editor"}
                mode="edit"
                value={editorValue}
                {...(vault.state.editor === null ? {} : { revision: vault.state.editor.revision })}
                submitting={submitting}
                conflict={conflict}
                onSubmit={submit}
                onCancel={() => {
                  setMode("closed");
                  setAttempted(null);
                  setConflict(false);
                  vault.clearSelection();
                }}
                onDelete={(opener) => {
                  deleteOpener.current = opener;
                  setDeleteOpen(true);
                }}
              />
            </div>
          ) : null}
          {detailsReady && mode === "closed" ? (
            <div className={styles.detailEmpty}>
              <strong>Select an OTP item</strong>
              <span>Only the selected item’s full editor projection is requested.</span>
            </div>
          ) : null}
        </section>
      </div>

      {detailsReady && mode === "import" ? (
        <OtpImportView
          platform={platform}
          active={active}
          onImported={() => {
            setMode("closed");
            void vault.refreshList(vault.query.trim());
            onImported?.();
          }}
        />
      ) : null}

      {detailsReady && deleteOpen && selectedItem !== null ? (
        <DeleteOtpDialog
          label={safeItemLabel(selectedItem)}
          submitting={submitting}
          onCancel={closeDialog}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </section>
  );
}
