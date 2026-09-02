import type { VaultItem } from "@shardpass/domain";
import {
  importBitwardenJson,
  importChromeCsv,
  importFirefoxCsv,
  importOnePasswordCsv,
  type ImportResult,
} from "@shardpass/importers";
import { Button } from "@shardpass/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  BackupUiExtensionPlatform,
  ExtensionPlatform,
  OtpImportUiExtensionPlatform,
} from "../../platform/extension-platform";
import { createItem } from "../components/forms/submit-item";
import { itemDisplayName, itemDisplaySubtitle } from "../item-support";
import { OtpImportView } from "../otp/import/OtpImportView";
import { BackupView } from "../settings/BackupView";
import styles from "./ImportDialog.module.css";

/** Local file read cap for a third-party export: generous for thousands of rows, still bounded. */
const MAX_THIRD_PARTY_IMPORT_BYTES = 4 * 1024 * 1024;
const MAX_VISIBLE_WARNINGS = 20;

type ThirdPartySourceId = "chrome" | "firefox" | "bitwarden" | "onepassword";
type SourceId = "otp" | "backup" | ThirdPartySourceId;

interface ThirdPartySource {
  readonly id: ThirdPartySourceId;
  readonly label: string;
  readonly accept: string;
  readonly instructions: string;
  readonly parse: (text: string) => ImportResult;
}

const THIRD_PARTY_SOURCES: readonly ThirdPartySource[] = Object.freeze([
  {
    id: "chrome",
    label: "Chrome CSV",
    accept: ".csv,text/csv",
    instructions:
      'In Chrome, open chrome://password-manager/settings, choose "Export passwords", then select the downloaded file below.',
    parse: importChromeCsv,
  },
  {
    id: "firefox",
    label: "Firefox CSV",
    accept: ".csv,text/csv",
    instructions:
      'In Firefox, open about:logins, open the "⋯" menu, choose "Export Logins…", then select the downloaded file below.',
    parse: importFirefoxCsv,
  },
  {
    id: "bitwarden",
    label: "Bitwarden JSON",
    accept: ".json,application/json",
    instructions:
      "In the Bitwarden web vault, go to Tools → Export vault, choose the unencrypted .json format, then select the downloaded file below.",
    parse: importBitwardenJson,
  },
  {
    id: "onepassword",
    label: "1Password CSV",
    accept: ".csv,text/csv",
    instructions:
      "In 1Password, select the items to export, choose File → Export, pick the CSV format, then select the downloaded file below.",
    parse: importOnePasswordCsv,
  },
]);

const SOURCE_OPTIONS: readonly Readonly<{ id: SourceId; label: string }>[] = Object.freeze([
  { id: "chrome", label: "Chrome CSV" },
  { id: "firefox", label: "Firefox CSV" },
  { id: "bitwarden", label: "Bitwarden JSON" },
  { id: "onepassword", label: "1Password CSV" },
  { id: "otp", label: "QR code / otpauth://" },
  { id: "backup", label: "ShardPass backup" },
]);

type Row = Readonly<{ id: string; item: VaultItem; selected: boolean }>;
type ThirdPartyState = Readonly<{
  phase: "pick" | "reading" | "preview" | "importing" | "done";
  rows: readonly Row[];
  warnings: readonly string[];
  error: string | null;
  imported: number;
  failed: number;
}>;

const INITIAL_THIRD_PARTY_STATE: ThirdPartyState = Object.freeze({
  phase: "pick",
  rows: [],
  warnings: [],
  error: null,
  imported: 0,
  failed: 0,
});

export interface ImportDialogProps {
  platform: OtpImportUiExtensionPlatform &
    BackupUiExtensionPlatform &
    Pick<ExtensionPlatform, "sendMessage">;
  active: boolean;
  onImported: () => void;
}

/**
 * Unified import surface: a source selector spanning both the existing OTP importers
 * (QR image / otpauth:// / other supported text formats, via the existing
 * {@link OtpImportView}) and ShardPass encrypted backup restore (via the existing
 * {@link BackupView}), alongside the new third-party password-manager importers from
 * `@shardpass/importers` (Chrome, Firefox, Bitwarden, 1Password). Third-party sources
 * are parsed locally, previewed with per-row checkboxes, and imported by calling
 * `item.create` once per selected item.
 */
export function ImportDialog({ platform, active, onImported }: ImportDialogProps) {
  const [source, setSource] = useState<SourceId>("chrome");
  const [state, setState] = useState<ThirdPartyState>(INITIAL_THIRD_PARTY_STATE);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const ownerRef = useRef(0);

  const resetThirdParty = useCallback(() => {
    ownerRef.current += 1;
    if (fileRef.current !== null) fileRef.current.value = "";
    setState(INITIAL_THIRD_PARTY_STATE);
  }, []);

  const changeSource = useCallback(
    (next: SourceId) => {
      resetThirdParty();
      setSource(next);
    },
    [resetThirdParty],
  );

  useEffect(() => {
    if (!active) resetThirdParty();
  }, [active, resetThirdParty]);
  // Cancels any in-flight file read on unmount, without updating state on an
  // unmounting component.
  useEffect(() => {
    return () => {
      ownerRef.current += 1;
    };
  }, []);

  if (!active) return null;

  const thirdParty = THIRD_PARTY_SOURCES.find((candidate) => candidate.id === source) ?? null;

  const selectFile = (parser: ThirdPartySource, file: File | undefined) => {
    if (fileRef.current !== null) fileRef.current.value = "";
    if (file === undefined) return;
    if (file.size === 0 || file.size > MAX_THIRD_PARTY_IMPORT_BYTES) {
      setState({ ...INITIAL_THIRD_PARTY_STATE, error: "The file is too large to import safely." });
      return;
    }
    const owner = ++ownerRef.current;
    setState({ ...INITIAL_THIRD_PARTY_STATE, phase: "reading" });
    void file.text().then(
      (text) => {
        if (owner !== ownerRef.current) return;
        let result: ImportResult;
        try {
          result = parser.parse(text);
        } catch {
          setState({ ...INITIAL_THIRD_PARTY_STATE, error: "The file could not be read." });
          return;
        }
        setState({
          phase: "preview",
          rows: result.items.map((item) => ({ id: item.id, item, selected: true })),
          warnings: result.warnings,
          error:
            result.items.length === 0 ? "No importable entries were found in this file." : null,
          imported: 0,
          failed: 0,
        });
      },
      () => {
        if (owner !== ownerRef.current) return;
        setState({ ...INITIAL_THIRD_PARTY_STATE, error: "The file could not be read." });
      },
    );
  };

  const toggleRow = (id: string) => {
    setState((current) => ({
      ...current,
      rows: current.rows.map((row) => (row.id === id ? { ...row, selected: !row.selected } : row)),
    }));
  };

  const toggleAll = (selected: boolean) => {
    setState((current) => ({ ...current, rows: current.rows.map((row) => ({ ...row, selected })) }));
  };

  const confirmImport = async () => {
    const owner = ++ownerRef.current;
    const selected = state.rows.filter((row) => row.selected);
    setState((current) => ({ ...current, phase: "importing" }));
    let imported = 0;
    let failed = 0;
    for (const row of selected) {
      const result = await createItem(platform, row.item);
      if (owner !== ownerRef.current) return;
      if (result.status === "saved") imported += 1;
      else failed += 1;
    }
    if (owner !== ownerRef.current) return;
    setState({
      phase: "done",
      rows: [],
      warnings: [],
      error: failed > 0 ? `${failed} item(s) could not be imported.` : null,
      imported,
      failed,
    });
    if (imported > 0) onImported();
  };

  return (
    <section className={styles.region} aria-labelledby="import-dialog-heading">
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>LOCAL INPUT / SAFE PREVIEW</p>
          <h3 id="import-dialog-heading">Import items</h3>
        </div>
      </header>

      <div className={styles.sourceSelector} aria-label="Import source">
        {SOURCE_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-current={source === option.id ? "true" : undefined}
            className={styles.sourceButton}
            data-selected={source === option.id ? "true" : "false"}
            onClick={() => changeSource(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {source === "otp" ? (
        <OtpImportView platform={platform} active onImported={onImported} />
      ) : source === "backup" ? (
        <BackupView platform={platform} active onImported={onImported} />
      ) : thirdParty !== null ? (
        <div className={styles.thirdParty}>
          <p className={styles.instructions}>{thirdParty.instructions}</p>

          {state.error !== null ? (
            <p className={styles.error} role="alert">
              {state.error}
            </p>
          ) : null}

          {state.phase === "pick" || state.phase === "reading" ? (
            <>
              <input
                ref={fileRef}
                className={styles.visuallyHidden}
                id="import-dialog-file"
                type="file"
                accept={thirdParty.accept}
                aria-label={`Choose a local ${thirdParty.label} file`}
                disabled={state.phase === "reading"}
                onChange={(event) => selectFile(thirdParty, event.currentTarget.files?.[0])}
              />
              <button
                className={styles.fileButton}
                type="button"
                disabled={state.phase === "reading"}
                onClick={() => fileRef.current?.click()}
              >
                <span aria-hidden="true">↓</span>
                <strong>
                  {state.phase === "reading" ? "Reading locally…" : `Choose ${thirdParty.label} file`}
                </strong>
                <small>Processed locally and never uploaded.</small>
              </button>
            </>
          ) : state.phase === "done" ? (
            <div className={styles.complete} role="status">
              <strong>Import complete</strong>
              <span>
                {state.imported.toLocaleString("en-US")}{" "}
                {state.imported === 1 ? "item" : "items"} imported
                {state.failed > 0 ? `, ${state.failed} failed` : ""}.
              </span>
              <Button variant="secondary" onClick={resetThirdParty}>
                Import more
              </Button>
            </div>
          ) : (
            <div className={styles.preview}>
              <div className={styles.previewHeading}>
                <span>
                  {state.rows.filter((row) => row.selected).length} of {state.rows.length} selected
                </span>
                <div className={styles.previewActions}>
                  <button
                    type="button"
                    className={styles.previewActionButton}
                    onClick={() => toggleAll(true)}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className={styles.previewActionButton}
                    onClick={() => toggleAll(false)}
                  >
                    Select none
                  </button>
                  <Button
                    variant="secondary"
                    onClick={resetThirdParty}
                    disabled={state.phase === "importing"}
                  >
                    Cancel
                  </Button>
                </div>
              </div>

              {state.warnings.length > 0 ? (
                <details className={styles.warnings}>
                  <summary>{state.warnings.length} row(s) were skipped</summary>
                  <ul>
                    {state.warnings.slice(0, MAX_VISIBLE_WARNINGS).map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </details>
              ) : null}

              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col" aria-label="Selected" />
                      <th scope="col">Name</th>
                      <th scope="col">Details</th>
                      <th scope="col">Kind</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.rows.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={row.selected}
                            disabled={state.phase === "importing"}
                            onChange={() => toggleRow(row.id)}
                            aria-label={`Import ${itemDisplayName(row.item)}`}
                          />
                        </td>
                        <td>{itemDisplayName(row.item)}</td>
                        <td>{itemDisplaySubtitle(row.item) ?? "—"}</td>
                        <td className={styles.kind}>{row.item.kind.toUpperCase()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Button
                onClick={() => void confirmImport()}
                loading={state.phase === "importing"}
                disabled={state.rows.every((row) => !row.selected)}
              >
                Import selected
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
