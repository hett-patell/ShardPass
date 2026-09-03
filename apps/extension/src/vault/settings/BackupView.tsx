import { createWorkerKdfExecutor, type KdfExecutor } from "@shardpass/crypto";
import { Button } from "@shardpass/ui";

import type { BackupUiExtensionPlatform } from "../../platform/extension-platform";
import styles from "./BackupView.module.css";
import { defaultBackupCrypto, useBackup, type BackupCryptoPort } from "./useBackup";

export type { BackupCryptoPort } from "./useBackup";

export interface BackupViewProps {
  platform: BackupUiExtensionPlatform;
  active: boolean;
  onImported?: () => void;
  kdfExecutor?: KdfExecutor;
  crypto?: BackupCryptoPort;
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
  const exportWorking = backup.state.exportPhase === "working";
  const importWorking = backup.state.importPhase === "confirming";
  const importReading = backup.state.importPhase === "reading";

  return (
    <section
      className={styles.region}
      aria-labelledby="backup-heading"
      onKeyDown={(event) => {
        if (event.key === "Escape") backup.cancel();
      }}
    >
      <header className={styles.header}>
        <div>
          <h3 id="backup-heading">Encrypted backups</h3>
        </div>
        <span className={styles.scope}>ONE-TIME CODES</span>
      </header>

      <div className={styles.warning} id="backup-sensitive-warning">
        <strong>Portable secret material</strong>
        <span>
          A portable backup contains sensitive vault data (your one-time code items) protected
          only by its backup password. Logins, notes, cards, identities, and secrets stay on
          this device and are not included. Store both passwords separately and securely.
        </span>
      </div>

      {backup.state.error !== null ? (
        <p className={styles.error} role="alert">
          {backup.state.error}
        </p>
      ) : null}
      {backup.state.status !== null ? (
        <p className={styles.status} role="status">
          {backup.state.status}
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
            <span>01 / EXPORT</span>
            <h4>Create backup</h4>
            <p>Verify vault access, then encrypt a fresh one-use snapshot locally.</p>
          </div>
          <label>
            Current vault password
            <input
              ref={backup.currentPasswordRef}
              type="password"
              autoComplete="off"
              spellCheck={false}
              disabled={exportWorking}
              aria-describedby="backup-export-help backup-sensitive-warning"
            />
          </label>
          <label>
            Backup password
            <input
              ref={backup.backupPasswordRef}
              type="password"
              autoComplete="off"
              spellCheck={false}
              disabled={exportWorking}
              aria-describedby="backup-export-help"
            />
          </label>
          <label>
            Confirm backup password
            <input
              ref={backup.confirmationRef}
              type="password"
              autoComplete="off"
              spellCheck={false}
              disabled={exportWorking}
              aria-describedby="backup-export-help"
            />
          </label>
          <p className={styles.help} id="backup-export-help">
            Password derivation and backup verification are processed locally. Raw passwords are
            never sent to the extension runtime.
          </p>
          {backup.state.downloadUrl === null ? (
            <Button type="submit" loading={exportWorking} disabled={importWorking}>
              Prepare encrypted backup
            </Button>
          ) : (
            <a
              className={styles.download}
              href={backup.state.downloadUrl}
              download="shardpass-backup.shardpass"
              onClick={backup.downloadConsumed}
            >
              Download verified backup
            </a>
          )}
        </form>

        <div className={styles.panel}>
          <div className={styles.panelHeading}>
            <span>02 / IMPORT</span>
            <h4>Restore backup</h4>
            <p>Decrypt a bounded local file, review safe counts, then explicitly confirm.</p>
          </div>
          {backup.state.preview === null && backup.state.importPhase !== "complete" ? (
            <>
              <label>
                Backup file password
                <input
                  ref={backup.importPasswordRef}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={importWorking}
                  aria-describedby="backup-import-help backup-sensitive-warning"
                />
              </label>
              <input
                ref={backup.fileRef}
                className={styles.visuallyHidden}
                id="backup-file"
                type="file"
                accept=".shardpass,application/x-shardpass,application/json"
                aria-label="Choose local backup file"
                disabled={importWorking}
                onChange={(event) => backup.selectFile(event.currentTarget.files?.[0])}
              />
              <button
                className={styles.fileButton}
                type="button"
                disabled={importWorking}
                onClick={() => backup.fileRef.current?.click()}
              >
                <span aria-hidden="true">↓</span>
                <strong>{importReading ? "Reading locally…" : "Choose local backup"}</strong>
                <small>.shardpass or authorized legacy export</small>
              </button>
              <p className={styles.help} id="backup-import-help">
                The file is bounded before read and decrypted locally. Its name and contents are
                never displayed.
              </p>
            </>
          ) : backup.state.preview !== null ? (
            <div className={styles.preview}>
              <div className={styles.previewHeading}>
                <div>
                  <span>SAFE COUNTS ONLY</span>
                  <h4>Review backup import</h4>
                </div>
                <Button variant="secondary" onClick={backup.cancel} disabled={importWorking}>
                  Cancel import
                </Button>
              </div>
              <dl className={styles.counts} aria-label="Backup import summary">
                <div data-state="accepted">
                  <dt>READY</dt>
                  <dd>{backup.state.preview.accepted} ready</dd>
                </div>
                <div>
                  <dt>DUPLICATE</dt>
                  <dd>{backup.state.preview.duplicate}</dd>
                </div>
                <div>
                  <dt>CONFLICT</dt>
                  <dd>{backup.state.preview.conflict}</dd>
                </div>
                <div data-state="rejected">
                  <dt>REJECTED</dt>
                  <dd>{backup.state.preview.rejected}</dd>
                </div>
              </dl>
              <p className={styles.previewMeta}>
                Settings: {backup.state.preview.settings === "replace" ? "replace" : "unchanged"}
                {" · "}History additions: {backup.state.preview.journalAdded} journal,{" "}
                {backup.state.preview.tombstonesAdded} tombstones
              </p>
              <label className={styles.reviewCheck}>
                <input
                  type="checkbox"
                  checked={backup.state.reviewed}
                  disabled={importWorking}
                  onChange={(event) => backup.setReviewed(event.currentTarget.checked)}
                />
                I reviewed this backup summary
              </label>
              <Button
                onClick={backup.confirm}
                loading={backup.state.importPhase === "confirming"}
                disabled={!backup.state.reviewed}
              >
                Import backup
              </Button>
            </div>
          ) : (
            <div className={styles.complete}>
              <strong>Backup import complete</strong>
              <span>The confirmed portable state was applied as one vault generation.</span>
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
