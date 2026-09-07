import { createWorkerKdfExecutor, type KdfExecutor } from "@shardpass/crypto";
import { VAULT_ITEM_KINDS, type VaultItemKind } from "@shardpass/domain";
import type { BackupCountsByKind } from "@shardpass/messaging";
import { Button, PasswordInput, SectionLabel } from "@shardpass/ui";

import type { BackupUiExtensionPlatform } from "../../platform/extension-platform";
import styles from "./BackupView.module.css";
import {
  defaultBackupCrypto,
  EXPORT_FILES,
  useBackup,
  type BackupCryptoPort,
  type BackupExportKind,
} from "./useBackup";

export type { BackupCryptoPort, BackupExportKind } from "./useBackup";

export interface BackupViewProps {
  platform: BackupUiExtensionPlatform;
  active: boolean;
  onImported?: () => void;
  kdfExecutor?: KdfExecutor;
  crypto?: BackupCryptoPort;
}

const EXPORT_CHOICES: ReadonlyArray<
  Readonly<{
    kind: BackupExportKind;
    title: string;
    tag: string;
    encrypted: boolean;
    description: string;
  }>
> = [
  {
    kind: "encrypted",
    title: "Encrypted backup",
    tag: "Recommended",
    encrypted: true,
    description:
      "A .shardpass file with every item, every folder, and your lock settings, sealed with a password you choose. Only ShardPass can open it.",
  },
  {
    kind: "json",
    title: "JSON export",
    tag: "Unencrypted",
    encrypted: false,
    description:
      "A .json file with every item and folder, secrets included, in plain text. Anything can read it. For moving to another tool or keeping your own copy.",
  },
  {
    kind: "csv",
    title: "Logins as CSV",
    tag: "Unencrypted",
    encrypted: false,
    description:
      "A .csv of your logins only: name, URL, username, password, notes, one-time code. The format most password managers import. Other item kinds are left out.",
  },
];

const PREPARE_LABELS: Readonly<Record<BackupExportKind, string>> = {
  encrypted: "Prepare encrypted backup",
  json: "Prepare JSON export",
  csv: "Prepare CSV export",
};
const DOWNLOAD_LABELS: Readonly<Record<BackupExportKind, string>> = {
  encrypted: "Download verified backup",
  json: "Download JSON export",
  csv: "Download CSV export",
};

const KIND_NAMES: Readonly<Record<VaultItemKind, readonly [string, string]>> = {
  otp: ["one-time code", "one-time codes"],
  login: ["login", "logins"],
  note: ["note", "notes"],
  card: ["card", "cards"],
  identity: ["identity", "identities"],
  secret: ["secret", "secrets"],
};

/** Logins first, since that is what most people are looking for; then the rest. */
const KIND_DISPLAY_ORDER: readonly VaultItemKind[] = [
  "login",
  ...VAULT_ITEM_KINDS.filter((kind) => kind !== "login"),
];

/** "3 logins, 1 note, 2 one-time codes", or "nothing" when every count is zero. */
export function describeKinds(counts: BackupCountsByKind): string {
  const parts = KIND_DISPLAY_ORDER.filter((kind) => counts[kind] > 0).map(
    (kind) =>
      `${counts[kind].toLocaleString("en-US")} ${KIND_NAMES[kind][counts[kind] === 1 ? 0 : 1]}`,
  );
  return parts.length === 0 ? "nothing" : parts.join(", ");
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : pluralForm}`;
}

export function BackupView({
  platform,
  active,
  onImported,
  kdfExecutor = createWorkerKdfExecutor(),
  crypto = defaultBackupCrypto,
}: BackupViewProps) {
  const backup = useBackup({
    platform,
    active,
    kdfExecutor,
    crypto,
    ...(onImported === undefined ? {} : { onImported }),
  });
  if (!active) return null;
  const { state } = backup;
  const exportWorking = state.exportPhase === "working";
  const importWorking = state.importPhase === "confirming";
  const importReading = state.importPhase === "reading";
  const fileChosen = state.importPhase === "selected" || importReading;
  const choice = EXPORT_CHOICES.find((option) => option.kind === state.exportKind)!;

  return (
    <section
      className={styles.region}
      aria-labelledby="backup-heading"
      onKeyDown={(event) => {
        if (event.key === "Escape") backup.cancel();
      }}
    >
      <header className={styles.header}>
        <h3 id="backup-heading">Backup and export</h3>
        <p>Save a copy of this vault, or move your logins to another password manager.</p>
      </header>

      <div className={styles.warning} id="backup-sensitive-warning">
        <strong>Handle with care</strong>
        <span>
          Every file made here holds the secrets in this vault. Keep it, and the passwords that
          protect it, somewhere only you can reach.
        </span>
      </div>

      {state.error !== null ? (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      ) : null}
      {state.status !== null ? (
        <p className={styles.status} role="status">
          {state.status}
        </p>
      ) : null}

      <div className={styles.columns}>
        <form
          className={styles.panel}
          onSubmit={(event) => {
            event.preventDefault();
            backup.prepareExport();
          }}
        >
          <div className={styles.panelHeading}>
            <SectionLabel>Export</SectionLabel>
            <h4>Create a file</h4>
            <p>Confirm your vault password, then the file is built here and offered as a download.</p>
          </div>

          <fieldset className={styles.choices} disabled={exportWorking}>
            <legend className={styles.visuallyHidden}>What to create</legend>
            {EXPORT_CHOICES.map((option) => (
              <label
                key={option.kind}
                className={styles.choice}
                data-selected={state.exportKind === option.kind ? "true" : "false"}
              >
                <input
                  type="radio"
                  name="backup-export-kind"
                  value={option.kind}
                  checked={state.exportKind === option.kind}
                  onChange={() => backup.setExportKind(option.kind)}
                />
                <span className={styles.choiceBody}>
                  <span className={styles.choiceTitle}>
                    <strong>{option.title}</strong>
                    <span className={styles.tag} data-tone={option.encrypted ? "good" : "warn"}>
                      {option.tag}
                    </span>
                  </span>
                  <span className={styles.choiceText}>{option.description}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {choice.encrypted ? null : (
            <div className={styles.unencrypted} role="note" id="backup-unencrypted-warning">
              <strong>This file is not encrypted</strong>
              <span>
                Anyone who can open it can read every secret in it. Save it only where you need
                it, and delete it as soon as you are done.
              </span>
            </div>
          )}

          <label>
            Current vault password
            <PasswordInput
              ref={backup.currentPasswordRef}
              autoComplete="off"
              spellCheck={false}
              disabled={exportWorking}
              aria-describedby="backup-export-help backup-sensitive-warning"
            />
          </label>
          {choice.encrypted ? (
            <>
              <label>
                Backup password
                <PasswordInput
                  ref={backup.backupPasswordRef}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={exportWorking}
                  aria-describedby="backup-export-help"
                />
              </label>
              <label>
                Confirm backup password
                <PasswordInput
                  ref={backup.confirmationRef}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={exportWorking}
                  aria-describedby="backup-export-help"
                />
              </label>
            </>
          ) : null}
          <p className={styles.help} id="backup-export-help">
            Password checks and file creation happen locally. Raw passwords are never sent to the
            extension runtime.
          </p>
          {state.download === null ? (
            <Button type="submit" loading={exportWorking} disabled={importWorking}>
              {PREPARE_LABELS[state.exportKind]}
            </Button>
          ) : (
            <a
              className={styles.download}
              data-tone={state.download.kind === "encrypted" ? "good" : "warn"}
              href={state.download.url}
              download={EXPORT_FILES[state.download.kind].fileName}
              onClick={backup.downloadConsumed}
            >
              {DOWNLOAD_LABELS[state.download.kind]}
            </a>
          )}
        </form>

        <div className={styles.panel}>
          <div className={styles.panelHeading}>
            <SectionLabel>Import</SectionLabel>
            <h4>Restore a backup</h4>
            <p>
              Bring a .shardpass file into this vault. Nothing already here is changed: matching
              items are skipped, matching folders are reused, and missing folders are created.
            </p>
          </div>
          {state.preview === null && state.importPhase !== "complete" ? (
            <form
              className={styles.restore}
              onSubmit={(event) => {
                event.preventDefault();
                backup.unlockBackup();
              }}
            >
              <input
                ref={backup.fileRef}
                className={styles.visuallyHidden}
                id="backup-file"
                type="file"
                accept=".shardpass,application/x-shardpass,application/json"
                aria-label="Choose local backup file"
                disabled={importWorking || importReading}
                onChange={(event) => backup.selectFile(event.currentTarget.files?.[0])}
              />
              <button
                className={styles.fileButton}
                type="button"
                data-chosen={fileChosen ? "true" : "false"}
                disabled={importWorking || importReading}
                onClick={() => backup.fileRef.current?.click()}
              >
                <span aria-hidden="true">{fileChosen ? "✓" : "↓"}</span>
                <strong>{fileChosen ? "Backup file chosen" : "Choose backup file"}</strong>
                <small>
                  {fileChosen
                    ? "Choose a different file"
                    : ".shardpass, or an older ShardPass export"}
                </small>
              </button>
              {fileChosen ? (
                <>
                  <label>
                    Backup file password
                    <PasswordInput
                      ref={backup.importPasswordRef}
                      autoComplete="off"
                      spellCheck={false}
                      autoFocus
                      disabled={importReading}
                      aria-describedby="backup-import-help backup-sensitive-warning"
                    />
                  </label>
                  <Button type="submit" loading={importReading}>
                    Unlock backup
                  </Button>
                </>
              ) : null}
              <p className={styles.help} id="backup-import-help">
                The file is size-checked before it is read and decrypted here in the vault page.
                Its name and contents are never shown.
              </p>
            </form>
          ) : state.preview !== null ? (
            <div className={styles.preview}>
              <div className={styles.previewHeading}>
                <div>
                  <SectionLabel>Safe counts only</SectionLabel>
                  <h4>Review backup import</h4>
                </div>
                <Button variant="secondary" onClick={backup.cancel} disabled={importWorking}>
                  Cancel import
                </Button>
              </div>
              <dl className={styles.counts} aria-label="Backup import summary">
                <div data-state="accepted">
                  <dt>Ready</dt>
                  <dd>{state.preview.accepted} ready</dd>
                </div>
                <div>
                  <dt>Duplicate</dt>
                  <dd>{state.preview.duplicate}</dd>
                </div>
                <div>
                  <dt>Conflict</dt>
                  <dd>{state.preview.conflict}</dd>
                </div>
                <div data-state="rejected">
                  <dt>Rejected</dt>
                  <dd>{state.preview.rejected}</dd>
                </div>
              </dl>
              <p className={styles.previewMeta}>
                Ready to add: {describeKinds(state.preview.byKind)}.
              </p>
              <p className={styles.previewMeta}>
                Folders: {plural(state.preview.foldersCreated, "folder", "folders")} to create
                {state.preview.unfiled > 0
                  ? `, ${plural(state.preview.unfiled, "item", "items")} will be left out of a folder that cannot be created`
                  : ""}
                .
              </p>
              <p className={styles.previewMeta}>
                Settings: {state.preview.settings === "replace" ? "replace" : "unchanged"}
                {" · "}History additions: {state.preview.journalAdded} journal,{" "}
                {state.preview.tombstonesAdded} tombstones
              </p>
              <label className={styles.reviewCheck}>
                <input
                  type="checkbox"
                  checked={state.reviewed}
                  disabled={importWorking}
                  onChange={(event) => backup.setReviewed(event.currentTarget.checked)}
                />
                I reviewed this backup summary
              </label>
              <Button
                onClick={backup.confirm}
                loading={state.importPhase === "confirming"}
                disabled={!state.reviewed}
              >
                Import backup
              </Button>
            </div>
          ) : (
            <div className={styles.complete}>
              <strong>Backup import complete</strong>
              <span>
                Added {state.outcome === null ? "nothing" : describeKinds(state.outcome.byKind)}
                {state.outcome !== null && state.outcome.foldersCreated > 0
                  ? ` and created ${plural(state.outcome.foldersCreated, "folder", "folders")}`
                  : ""}
                , as one vault generation.
              </span>
              <Button variant="secondary" onClick={backup.cancel}>
                Restore another
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
