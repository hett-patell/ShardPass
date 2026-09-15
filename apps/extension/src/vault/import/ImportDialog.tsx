import { MAX_FOLDERS, MAX_FOLDER_DEPTH, type Folder, type VaultItem } from "@shardpass/domain";
import {
  type ImportFolder,
  importBitwardenJson,
  importChromeCsv,
  importFirefoxCsv,
  importOnePassword1pux,
  importOnePasswordCsv,
  type ImportResult,
  OnePassword1puxFormatError,
} from "@shardpass/importers";
import { parseFolderResponseForRequest, type FolderRequest } from "@shardpass/messaging";
import { Button, PasswordInput } from "@shardpass/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  BackupUiExtensionPlatform,
  ExtensionPlatform,
  OtpImportUiExtensionPlatform,
} from "../../platform/extension-platform";
import { createItems } from "../components/forms/submit-item";
import { itemDisplayName, itemDisplaySubtitle } from "../item-support";
import { OtpImportView } from "../otp/import/OtpImportView";
import { runKeePassImport } from "../keepass/keepass-executor";
import { BackupView } from "../settings/BackupView";
import { planFolders, sameFolderName, type FolderPlan } from "./folder-plan";
import styles from "./ImportDialog.module.css";

/** Local file read cap for a third-party export: generous for thousands of rows, still bounded. */
const MAX_THIRD_PARTY_IMPORT_BYTES = 4 * 1024 * 1024;
/** A 1PUX archive or a KeePass database with attachments; the parsers bound their own reads. */
const MAX_BINARY_IMPORT_BYTES = 64 * 1024 * 1024;
/** KeePass accepts any file as a key file; a photo is common, a video is not. */
const MAX_KEY_FILE_BYTES = 8 * 1024 * 1024;
const MAX_VISIBLE_WARNINGS = 20;
/** Rows per item.createMany call: bounds message size and gives the progress bar steps. */
const IMPORT_BATCH_SIZE = 100;

type ThirdPartySourceId =
  "chrome" | "firefox" | "bitwarden" | "onepassword" | "onepassword-1pux" | "keepass";
type SourceId = "otp" | "backup" | ThirdPartySourceId;

interface ThirdPartySource {
  /** Read cap for this source's files; the text parsers' default is 4 MiB. */
  maxBytes?: number;
  readonly id: ThirdPartySourceId;
  readonly label: string;
  readonly accept: string;
  readonly instructions: string;
  /**
   * Plain-text exports parse synchronously from the file's text. Archives are read as bytes and
   * parsed asynchronously through `parseBytes`. Encrypted sources leave both undefined and are
   * decrypted in a worker after the user supplies a password instead.
   */
  readonly parse?: (text: string) => ImportResult;
  readonly parseBytes?: (bytes: ArrayBuffer) => Promise<ImportResult>;
  readonly encrypted?: true;
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
      "In 1Password, select the items to export, choose File → Export, pick the CSV format, then select the downloaded file below. " +
      "1Password 8 writes only logins to CSV: cards, identities and secure notes are not in that file and have to be added by hand. " +
      "Older exports with a Type column are sorted by it.",
    parse: importOnePasswordCsv,
  },
  {
    id: "onepassword-1pux",
    label: "1Password 1PUX",
    // The archive carries attachments and documents; only export.data is ever read.
    maxBytes: MAX_BINARY_IMPORT_BYTES,
    accept: ".1pux,application/zip",
    instructions:
      "In 1Password, File → Export → 1PUX. It keeps every field, tags, several URLs, one-time secrets and " +
      "which accounts sign in with Google or Apple; the CSV export keeps only logins. Then select the .1pux file below.",
    parseBytes: importOnePassword1pux,
  },
  {
    id: "keepass",
    label: "KeePass database",
    maxBytes: MAX_BINARY_IMPORT_BYTES,
    accept: ".kdbx,application/x-keepass",
    instructions:
      "Choose your .kdbx database, then enter its master password and, if the database uses one, " +
      "its key file. Everything is decrypted on this device and nothing leaves your machine.",
    encrypted: true,
  },
]);

const SOURCE_OPTIONS: readonly Readonly<{ id: SourceId; label: string }>[] = Object.freeze([
  { id: "chrome", label: "Chrome CSV" },
  { id: "firefox", label: "Firefox CSV" },
  { id: "bitwarden", label: "Bitwarden JSON" },
  { id: "onepassword", label: "1Password CSV" },
  { id: "onepassword-1pux", label: "1Password 1PUX" },
  { id: "keepass", label: "KeePass database" },
  { id: "otp", label: "QR code / otpauth://" },
  { id: "backup", label: "ShardPass backup" },
]);

type Row = Readonly<{ id: string; item: VaultItem; selected: boolean }>;
/** One row that did not become a vault item, or became one with something missing, and why. */
type ImportOutcome = Readonly<{
  name: string;
  kind: VaultItem["kind"];
  status: "duplicate" | "invalid" | "conflict" | "unfiled" | "updated";
  reason?: string;
}>;
type ThirdPartyState = Readonly<{
  phase: "pick" | "reading" | "password" | "unlocking" | "preview" | "importing" | "done";
  rows: readonly Row[];
  /** Provisional folders from the source; created for real, parents first, on confirm. */
  folders: readonly ImportFolder[];
  /** Folders already in the vault, fetched once per preview; null until known. */
  existingFolders: readonly Folder[] | null;
  /** Rows that repeat an earlier row of the same file: same kind, name and account. */
  duplicateRowIds: ReadonlySet<string>;
  warnings: readonly string[];
  error: string | null;
  imported: number;
  updated: number;
  failed: number;
  duplicates: number;
  unfiled: number;
  outcomes: readonly ImportOutcome[];
  progress: Readonly<{ done: number; total: number }> | null;
}>;

const INITIAL_THIRD_PARTY_STATE: ThirdPartyState = Object.freeze({
  phase: "pick",
  rows: [],
  folders: [],
  existingFolders: null,
  duplicateRowIds: new Set<string>(),
  warnings: [],
  error: null,
  imported: 0,
  updated: 0,
  failed: 0,
  duplicates: 0,
  unfiled: 0,
  outcomes: [],
  progress: null,
});

/** Turns a batch outcome into a sentence a person can act on. */
function describeOutcome(outcome: ImportOutcome): string {
  switch (outcome.status) {
    case "duplicate":
      return "Skipped: an equivalent item is already in your vault.";
    case "conflict":
      return "Skipped: an item with the same identifier already exists.";
    case "invalid":
      return outcome.reason === undefined
        ? "Rejected: did not pass validation."
        : `Rejected: ${outcome.reason}`;
    case "unfiled":
      return outcome.reason === undefined
        ? "Imported without a folder."
        : `Imported without a folder: ${outcome.reason}`;
    case "updated":
      return "Updated: the copy already in your vault now has what this row knew.";
  }
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Rows that repeat an earlier row of the same file. Cheap and local: it never asks the vault,
 * so it is a hint to look twice, not a verdict.
 */
function findInFileDuplicates(rows: readonly Row[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    const item = row.item;
    const name = itemDisplayName(item).normalize("NFKC").toLocaleLowerCase("en-US");
    const account =
      item.kind === "login"
        ? `${item.username.normalize("NFKC").toLocaleLowerCase("en-US")} ${item.urls[0] ?? ""}`
        : item.kind === "otp"
          ? `${item.label} ${item.secret}`
          : "";
    const key = `${item.kind} ${name} ${account}`;
    if (seen.has(key)) duplicates.add(row.id);
    else seen.add(key);
  }
  return duplicates;
}

function previewState(
  result: Readonly<{
    items: readonly VaultItem[];
    warnings: readonly string[];
    folders?: readonly ImportFolder[];
  }>,
  emptyMessage: string,
): ThirdPartyState {
  const rows = result.items.map((item) => ({ id: item.id, item, selected: true }));
  return {
    ...INITIAL_THIRD_PARTY_STATE,
    phase: "preview",
    rows,
    folders: result.folders ?? [],
    duplicateRowIds: findInFileDuplicates(rows),
    warnings: [...result.warnings],
    error: result.items.length === 0 ? emptyMessage : null,
  };
}

/** What the preview says about folders, given the plan for the current selection. */
function describeFolderPlan(plan: FolderPlan): string {
  const parts: string[] = [`${plural(plan.creatable.length, "folder")} will be created`];
  if (plan.reused.size > 0) parts.push(`${plan.reused.size} already exist`);
  let sentence = parts.join(", ");
  if (plan.collapsed > 0)
    sentence += `; ${plan.collapsed} nested deeper than ${MAX_FOLDER_DEPTH} levels ${
      plan.collapsed === 1 ? "was" : "were"
    } folded into ${plan.collapsed === 1 ? "its" : "their"} parent's name`;
  sentence += ".";
  if (plan.overLimit.size > 0)
    sentence += ` ${plan.overLimit.size} cannot be created: a vault holds at most ${MAX_FOLDERS} folders, so ${plural(
      plan.unfiledItems,
      "item",
    )} will be imported without a folder.`;
  return sentence;
}

export interface ImportDialogProps {
  platform: OtpImportUiExtensionPlatform &
    BackupUiExtensionPlatform &
    Pick<ExtensionPlatform, "sendMessage">;
  active: boolean;
  onImported: () => void;
  /** Called from "View vault" once an import is complete. */
  onDone?: () => void;
}

/**
 * Unified import surface: a source selector spanning both the existing OTP importers
 * (QR image / otpauth:// / other supported text formats, via the existing
 * {@link OtpImportView}) and ShardPass encrypted backup restore (via the existing
 * {@link BackupView}), alongside the new third-party password-manager importers from
 * `@shardpass/importers` (Chrome, Firefox, Bitwarden, 1Password, KeePass). Third-party
 * sources are parsed locally, previewed with per-row checkboxes, and imported in batches of
 * `item.createMany`.
 */
export function ImportDialog({ platform, active, onImported, onDone }: ImportDialogProps) {
  const [source, setSource] = useState<SourceId>("chrome");
  const [state, setState] = useState<ThirdPartyState>(INITIAL_THIRD_PARTY_STATE);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const ownerRef = useRef(0);
  const mountedRef = useRef(true);
  // An import that has started runs to its summary; nothing on this surface cancels it.
  const importingRef = useRef(false);
  const [password, setPassword] = useState("");
  const [keyFile, setKeyFile] = useState<File | null>(null);
  // Held only between choosing an encrypted file and unlocking it.
  const pendingFileRef = useRef<File | null>(null);

  const resetThirdParty = useCallback(() => {
    ownerRef.current += 1;
    if (fileRef.current !== null) fileRef.current.value = "";
    pendingFileRef.current = null;
    setPassword("");
    setKeyFile(null);
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
    // Leaving mid-import must not lose the summary: the import finishes and reports
    // whenever the person comes back.
    if (!active && !importingRef.current) resetThirdParty();
  }, [active, resetThirdParty]);
  // Cancels any in-flight file read on unmount, without updating state on an
  // unmounting component.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      ownerRef.current += 1;
    };
  }, []);
  // One round trip per preview so the folder summary can count what already exists.
  useEffect(() => {
    if (state.phase !== "preview" || state.folders.length === 0 || state.existingFolders !== null)
      return;
    const owner = ownerRef.current;
    void sendFolderRequest(platform, { version: 1, kind: "folder.list" }).then((folders) => {
      if (!mountedRef.current || owner !== ownerRef.current) return;
      setState((current) =>
        current.phase === "preview" ? { ...current, existingFolders: folders ?? [] } : current,
      );
    });
  }, [platform, state.phase, state.folders.length, state.existingFolders]);

  if (!active) return null;

  const thirdParty = THIRD_PARTY_SOURCES.find((candidate) => candidate.id === source) ?? null;

  const selectFile = (parser: ThirdPartySource, file: File | undefined) => {
    if (fileRef.current !== null) fileRef.current.value = "";
    if (file === undefined) return;
    if (file.size === 0) {
      setState({ ...INITIAL_THIRD_PARTY_STATE, error: "The file is empty." });
      return;
    }
    if (file.size > (parser.maxBytes ?? MAX_THIRD_PARTY_IMPORT_BYTES)) {
      setState({ ...INITIAL_THIRD_PARTY_STATE, error: "The file is too large to import safely." });
      return;
    }
    if (parser.encrypted === true) {
      pendingFileRef.current = file;
      setPassword("");
      setKeyFile(null);
      setState({ ...INITIAL_THIRD_PARTY_STATE, phase: "password" });
      return;
    }
    const owner = ++ownerRef.current;
    setState({ ...INITIAL_THIRD_PARTY_STATE, phase: "reading" });
    void parseFile(parser, file).then(
      (result) => {
        if (owner !== ownerRef.current) return;
        setState(previewState(result, "No importable entries were found in this file."));
      },
      (error: unknown) => {
        if (owner !== ownerRef.current) return;
        // A format error names what the file is not (not a ZIP, no export.data); anything else
        // is an unreadable file.
        setState({
          ...INITIAL_THIRD_PARTY_STATE,
          error:
            error instanceof OnePassword1puxFormatError
              ? error.message
              : "The file could not be read.",
        });
      },
    );
  };

  const selectKeyFile = (file: File | undefined) => {
    if (file === undefined) {
      setKeyFile(null);
      return;
    }
    if (file.size > MAX_KEY_FILE_BYTES) {
      setKeyFile(null);
      setState((current) => ({ ...current, error: "The key file is too large to use." }));
      return;
    }
    setKeyFile(file);
    setState((current) => ({ ...current, error: null }));
  };

  const unlockDatabase = async () => {
    const file = pendingFileRef.current;
    if (file === null) return;
    const owner = ++ownerRef.current;
    setState((current) => ({ ...current, phase: "unlocking", error: null }));
    try {
      const buffer = await file.arrayBuffer();
      const keyBytes = keyFile === null ? undefined : await keyFile.arrayBuffer();
      const outcome = await runKeePassImport(buffer, password, keyBytes);
      if (owner !== ownerRef.current) return;
      // Cleared as soon as they have been used; the worker has already terminated.
      setPassword("");
      setKeyFile(null);
      pendingFileRef.current = null;
      setState(previewState(outcome, "No importable entries were found in this database."));
    } catch (error) {
      if (owner !== ownerRef.current) return;
      setState({
        ...INITIAL_THIRD_PARTY_STATE,
        phase: "password",
        error: error instanceof Error ? error.message : "The database could not be opened.",
      });
    }
  };

  const toggleRow = (id: string) => {
    setState((current) => ({
      ...current,
      rows: current.rows.map((row) => (row.id === id ? { ...row, selected: !row.selected } : row)),
    }));
  };

  const toggleAll = (selected: boolean) => {
    setState((current) => ({
      ...current,
      rows: current.rows.map((row) => ({ ...row, selected })),
    }));
  };

  const confirmImport = async () => {
    const selected = state.rows.filter((row) => row.selected);
    // The vault's folders decide what gets reused; if their list has not arrived yet, wait
    // for it rather than recreating every folder beside its namesake.
    let existingFolders = state.existingFolders;
    if (existingFolders === null && state.folders.length > 0)
      existingFolders =
        (await sendFolderRequest(platform, { version: 1, kind: "folder.list" })) ?? [];
    const plan = planFolders(
      state.folders,
      selected.map((row) => row.item.folderId),
      existingFolders ?? [],
    );
    importingRef.current = true;
    setState((current) => ({
      ...current,
      phase: "importing",
      progress: { done: 0, total: selected.length },
    }));
    let imported = 0;
    let duplicates = 0;
    let updated = 0;
    let failed = 0;
    let unfiled = 0;
    const outcomes: ImportOutcome[] = [];
    try {
      // The source's folders come first so every item can be filed as it is created. A folder
      // that cannot be created leaves its items unfiled rather than failing the import, and
      // each such item is listed in the summary.
      const folderIds = await realizeFolders(platform, plan);
      if (!mountedRef.current) return;
      // Batched: each call is one vault commit, so a large import is seconds rather than
      // minutes and cannot be left half-written. Chunking keeps messages bounded and gives
      // the progress bar something to show.
      for (let start = 0; start < selected.length; start += IMPORT_BATCH_SIZE) {
        const chunk = selected.slice(start, start + IMPORT_BATCH_SIZE);
        const refiled = chunk.map((row) => refile(row.item, plan, folderIds));
        const results = await createItems(
          platform,
          refiled.map((entry) => entry.item),
        );
        if (!mountedRef.current) return;
        for (const entry of results) {
          const row = chunk[entry.index];
          const filing = refiled[entry.index];
          if (row === undefined || filing === undefined) continue;
          if (entry.status === "created") {
            imported += 1;
            if (filing.unfiled !== undefined) {
              unfiled += 1;
              outcomes.push({
                name: itemDisplayName(row.item),
                kind: row.item.kind,
                status: "unfiled",
                reason: filing.unfiled,
              });
            }
            continue;
          }
          if (entry.status === "updated") {
            updated += 1;
            outcomes.push({
              name: itemDisplayName(row.item),
              kind: row.item.kind,
              status: "updated",
            });
            continue;
          }
          if (entry.status === "duplicate") duplicates += 1;
          else failed += 1;
          outcomes.push({
            name: itemDisplayName(row.item),
            kind: row.item.kind,
            status: entry.status,
            ...(entry.status === "invalid" && entry.reason !== undefined
              ? { reason: entry.reason }
              : {}),
          });
        }
        const done = Math.min(start + chunk.length, selected.length);
        setState((current) => ({ ...current, progress: { done, total: selected.length } }));
      }
    } finally {
      importingRef.current = false;
    }
    if (!mountedRef.current) return;
    setState({
      ...INITIAL_THIRD_PARTY_STATE,
      phase: "done",
      error: failed > 0 ? `${failed} item(s) could not be imported.` : null,
      imported,
      failed,
      updated,
      duplicates,
      unfiled,
      outcomes,
    });
    if (imported > 0) onImported();
  };

  const importing = state.phase === "importing";
  const selectedRows = state.rows.filter((row) => row.selected);
  const folderPlan =
    (state.phase === "preview" || importing) && state.folders.length > 0
      ? planFolders(
          state.folders,
          selectedRows.map((row) => row.item.folderId),
          state.existingFolders ?? [],
        )
      : null;

  return (
    <section className={styles.region} aria-labelledby="import-dialog-heading">
      <header className={styles.header}>
        <div>
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
            disabled={importing}
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

          {state.phase === "password" || state.phase === "unlocking" ? (
            <form
              className={styles.unlockForm}
              onSubmit={(event) => {
                event.preventDefault();
                void unlockDatabase();
              }}
            >
              <label className={styles.unlockLabel} htmlFor="import-dialog-kdbx-password">
                Master password
              </label>
              <PasswordInput
                id="import-dialog-kdbx-password"
                className={styles.unlockInput}
                autoComplete="current-password"
                autoFocus
                required={keyFile === null}
                disabled={state.phase === "unlocking"}
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
              <label className={styles.unlockLabel} htmlFor="import-dialog-kdbx-keyfile">
                Key file (optional)
              </label>
              <input
                id="import-dialog-kdbx-keyfile"
                className={styles.unlockFile}
                type="file"
                disabled={state.phase === "unlocking"}
                onChange={(event) => selectKeyFile(event.currentTarget.files?.[0])}
              />
              <p className={styles.unlockHint}>
                Only needed when the database was locked with a key file as well as, or instead of,
                a password. Opening a database is deliberately slow: KeePass key derivation can take
                several seconds.
              </p>
              <div className={styles.unlockActions}>
                <Button
                  type="submit"
                  disabled={state.phase === "unlocking" || (password === "" && keyFile === null)}
                >
                  {state.phase === "unlocking" ? "Opening…" : "Open database"}
                </Button>
                <Button variant="secondary" type="button" onClick={resetThirdParty}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : state.phase === "pick" || state.phase === "reading" ? (
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
                  {state.phase === "reading"
                    ? "Reading locally…"
                    : `Choose ${thirdParty.label} file`}
                </strong>
                <small>Processed locally and never uploaded.</small>
              </button>
            </>
          ) : state.phase === "done" ? (
            <div className={styles.complete} role="status">
              <strong>Import complete</strong>
              <span>
                {plural(state.imported, "item")} imported
                {state.updated > 0 ? `, ${state.updated} brought up to date` : ""}
                {state.duplicates > 0 ? `, ${state.duplicates} already in your vault` : ""}
                {state.failed > 0 ? `, ${state.failed} failed` : ""}
                {state.unfiled > 0 ? `, ${state.unfiled} without a folder` : ""}.
              </span>
              {state.outcomes.length > 0 ? (
                <ul className={styles.outcomes} aria-label="Items that need attention">
                  {state.outcomes.slice(0, MAX_VISIBLE_WARNINGS).map((outcome, index) => (
                    <li key={`${outcome.name}-${index}`}>
                      <span className={styles.outcomeName}>{outcome.name}</span>
                      <span className={styles.outcomeReason}>{describeOutcome(outcome)}</span>
                    </li>
                  ))}
                  {state.outcomes.length > MAX_VISIBLE_WARNINGS ? (
                    <li className={styles.outcomeMore}>
                      and {state.outcomes.length - MAX_VISIBLE_WARNINGS} more
                    </li>
                  ) : null}
                </ul>
              ) : null}
              <div className={styles.completeActions}>
                {onDone ? <Button onClick={onDone}>View vault</Button> : null}
                <Button variant="secondary" onClick={resetThirdParty}>
                  Import more
                </Button>
              </div>
            </div>
          ) : (
            <div className={styles.preview}>
              <div className={styles.previewHeading}>
                <span>
                  {selectedRows.length} of {state.rows.length} selected
                </span>
                <div className={styles.previewActions}>
                  <button
                    type="button"
                    className={styles.previewActionButton}
                    disabled={importing}
                    onClick={() => toggleAll(true)}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className={styles.previewActionButton}
                    disabled={importing}
                    onClick={() => toggleAll(false)}
                  >
                    Select none
                  </button>
                  <Button variant="secondary" onClick={resetThirdParty} disabled={importing}>
                    Cancel
                  </Button>
                </div>
              </div>

              {importing && state.progress !== null ? (
                <div className={styles.progress} role="status" aria-live="polite">
                  <progress
                    className={styles.progressBar}
                    value={state.progress.done}
                    max={Math.max(state.progress.total, 1)}
                  />
                  <span>
                    Importing {state.progress.done.toLocaleString("en-US")} of{" "}
                    {state.progress.total.toLocaleString("en-US")}…
                  </span>
                </div>
              ) : null}

              {folderPlan !== null ? (
                <p className={styles.folderSummary}>{describeFolderPlan(folderPlan)}</p>
              ) : null}

              {state.warnings.length > 0 ? (
                <details className={styles.warnings}>
                  <summary>{plural(state.warnings.length, "notice")}</summary>
                  <ul>
                    {state.warnings.slice(0, MAX_VISIBLE_WARNINGS).map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                    {state.warnings.length > MAX_VISIBLE_WARNINGS ? (
                      <li className={styles.outcomeMore}>
                        and {state.warnings.length - MAX_VISIBLE_WARNINGS} more
                      </li>
                    ) : null}
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
                            disabled={importing}
                            onChange={() => toggleRow(row.id)}
                            aria-label={`Import ${itemDisplayName(row.item)}`}
                          />
                        </td>
                        <td>{itemDisplayName(row.item)}</td>
                        <td>
                          {itemDisplaySubtitle(row.item) ?? "—"}
                          {state.duplicateRowIds.has(row.id) ? (
                            <span
                              className={styles.hint}
                              title="Another row in this file has the same name and account."
                            >
                              Duplicate?
                            </span>
                          ) : null}
                        </td>
                        <td className={styles.kind}>{row.item.kind.toUpperCase()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Button
                onClick={() => void confirmImport()}
                loading={importing}
                disabled={importing || selectedRows.length === 0}
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

/** Runs a source's parser over the file, as text or as bytes, whichever the source reads. */
async function parseFile(parser: ThirdPartySource, file: File): Promise<ImportResult> {
  if (parser.parseBytes !== undefined) return parser.parseBytes(await file.arrayBuffer());
  if (parser.parse === undefined) throw new Error("Source has no text parser.");
  return parser.parse(await file.text());
}

const FOLDER_LIMIT_REASON = "the vault's folder limit was reached.";
const FOLDER_FAILED_REASON = "the folder could not be created.";

/**
 * Swaps an item's provisional folder id for the real one. When the folder does not exist
 * the item goes in unfiled, and the reason travels with it into the summary.
 */
function refile(
  item: VaultItem,
  plan: FolderPlan,
  folderIds: ReadonlyMap<string, string>,
): Readonly<{ item: VaultItem; unfiled?: string }> {
  if (item.folderId === undefined) return { item };
  const planned = plan.remap.get(item.folderId);
  const real = planned === undefined ? undefined : folderIds.get(planned);
  if (real === undefined) {
    const { folderId: _dropped, ...rest } = item;
    void _dropped;
    return {
      item: rest,
      unfiled:
        planned !== undefined && plan.overLimit.has(planned)
          ? FOLDER_LIMIT_REASON
          : FOLDER_FAILED_REASON,
    };
  }
  return { item: real === item.folderId ? item : { ...item, folderId: real } };
}

async function sendFolderRequest(
  platform: Pick<ExtensionPlatform, "sendMessage">,
  request: FolderRequest,
): Promise<readonly Folder[] | null> {
  try {
    const parsed = parseFolderResponseForRequest(request, await platform.sendMessage(request));
    return parsed.success ? parsed.data.folders : null;
  } catch {
    return null;
  }
}

/**
 * Creates the folders the plan calls for, parents before children. Returns planned to real
 * ids, including the folders the plan found already in the vault.
 */
async function realizeFolders(
  platform: Pick<ExtensionPlatform, "sendMessage">,
  plan: FolderPlan,
): Promise<ReadonlyMap<string, string>> {
  const resolved = new Map<string, string>(plan.reused);
  for (const folder of plan.creatable) {
    const parentReal = folder.parentId === undefined ? undefined : resolved.get(folder.parentId);
    // The parent could not be created, so neither can this one.
    if (folder.parentId !== undefined && parentReal === undefined) continue;
    const created = await sendFolderRequest(platform, {
      version: 1,
      kind: "folder.create",
      name: folder.name,
      ...(parentReal === undefined ? {} : { parentId: parentReal }),
    });
    if (created === null) continue;
    const real = created.find(
      (candidate) =>
        candidate.parentId === parentReal && sameFolderName(candidate.name, folder.name),
    );
    if (real !== undefined) resolved.set(folder.id, real.id);
  }
  return resolved;
}
