import type { OtpImportResponse } from "@shardpass/messaging";
import { Button } from "@shardpass/ui";
import { useState } from "react";

import type { OtpImportUiExtensionPlatform } from "../../../platform/extension-platform";
import type { ImageImportExecutor } from "./image-import-executor";
import styles from "./OtpImportView.module.css";
import { useOtpImport, type ImportTextParser } from "./useOtpImport";

const ROW_WINDOW = 45;
const ROW_HEIGHT = 70;

const FORMAT_LABELS = {
  otpauth: "OTP AUTH URI",
  "google-migration": "GOOGLE MIGRATION",
  aegis: "AEGIS EXPORT",
  ente: "ENTE STATIC EXPORT",
  qr: "LOCAL QR IMAGE",
} as const;

type PreviewRowProjection = Extract<
  OtpImportResponse,
  { kind: "otp.importPreviewResult" }
>["rows"][number];

const REASON_LABELS: Record<PreviewRowProjection["reason"], string> = {
  IMPORT_ACCEPTED: "Ready to import",
  IMPORT_DUPLICATE_VAULT: "Already in vault",
  IMPORT_DUPLICATE_BATCH: "Repeated in this import",
  IMPORT_MALFORMED: "Malformed entry",
  IMPORT_UNSUPPORTED: "Unsupported entry",
  IMPORT_LIMIT_EXCEEDED: "Entry exceeds limits",
};

export interface OtpImportViewProps {
  platform: OtpImportUiExtensionPlatform;
  active: boolean;
  onImported: () => void;
  parseText?: ImportTextParser;
  imageExecutor?: ImageImportExecutor;
}

export function OtpImportView(props: OtpImportViewProps) {
  const importer = useOtpImport(props);
  const [concealed, setConcealed] = useState(true);
  const [windowStart, setWindowStart] = useState(0);

  if (!props.active) return null;
  const working = importer.state.phase === "parsing" || importer.state.phase === "confirming";
  const preview = importer.state.preview;
  const start = Math.min(windowStart, Math.max(0, (preview?.rows.length ?? 0) - ROW_WINDOW));
  const visibleRows = preview?.rows.slice(start, start + ROW_WINDOW) ?? [];

  return (
    <section
      className={styles.region}
      aria-labelledby="otp-import-heading"
      onKeyDown={(event) => {
        if (event.key === "Escape") importer.cancel();
      }}
    >
      <header className={styles.header}>
        <div>
          <h3 id="otp-import-heading">Import OTP items</h3>
        </div>
        {preview === null ? (
          <span className={styles.phase}>INPUT</span>
        ) : (
          <span className={styles.phase}>REVIEW</span>
        )}
      </header>

      {importer.state.phase === "complete" ? (
        <div className={styles.complete} role="status">
          <strong>Import complete</strong>
          <span>{importer.state.status}</span>
          <Button variant="secondary" onClick={importer.cancel}>
            Import more
          </Button>
        </div>
      ) : preview === null ? (
        <div className={styles.inputLayout}>
          <div className={styles.textInput}>
            <div className={styles.warning} id="sensitive-import-warning">
              <strong>Sensitive input</strong>
              <span>Content is processed locally and cleared when preview begins.</span>
            </div>
            <label htmlFor="otp-import-input">Sensitive import input</label>
            <textarea
              ref={importer.textRef}
              id="otp-import-input"
              rows={7}
              maxLength={262_144}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="none"
              data-concealed={concealed ? "true" : "false"}
              aria-describedby="sensitive-import-warning import-input-help"
              disabled={working}
            />
            <div className={styles.inputControls}>
              <button
                className={styles.concealToggle}
                type="button"
                aria-pressed={!concealed}
                onClick={() => setConcealed((value) => !value)}
              >
                {concealed ? "Reveal input" : "Conceal input"}
              </button>
              <span id="import-input-help">Paste supported text, then create a safe preview.</span>
            </div>
            <Button onClick={importer.previewText} loading={working}>
              Preview import
            </Button>
          </div>

          <div className={styles.fileInput}>
            <input
              ref={importer.fileRef}
              className={styles.visuallyHidden}
              id="otp-import-file"
              type="file"
              accept="image/png"
              disabled={working}
              aria-label="Choose a local PNG image"
              onChange={(event) => void importer.selectImage(event.currentTarget.files?.[0])}
            />
            <button
              className={styles.dropZone}
              type="button"
              disabled={working}
              aria-label="Drop PNG image here"
              onClick={() => importer.fileRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void importer.selectImage(event.dataTransfer.files[0]);
              }}
            >
              <span aria-hidden="true">▧</span>
              <strong>Local PNG</strong>
              <small>Select or drop a static QR image</small>
            </button>
            {importer.state.status === "Image selected" ? (
              <p role="status">Image selected</p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className={styles.preview}>
          <div className={styles.summaryHeader}>
            <div>
              <span>FORMAT</span>
              <strong>{FORMAT_LABELS[preview.format]}</strong>
            </div>
            <Button variant="secondary" onClick={importer.cancel} disabled={working}>
              Cancel import
            </Button>
          </div>
          <dl className={styles.counts} aria-label="Import summary">
            <div data-status="accepted">
              <dt>ACCEPTED</dt>
              <dd>
                <strong>{preview.accepted}</strong>
              </dd>
            </div>
            <div data-status="duplicate">
              <dt>DUPLICATE</dt>
              <dd>
                <strong>{preview.duplicate}</strong>
              </dd>
            </div>
            <div data-status="rejected">
              <dt>REJECTED</dt>
              <dd>
                <strong>{preview.rejected}</strong>
              </dd>
            </div>
          </dl>
          <div
            className={styles.rowViewport}
            onScroll={(event) =>
              setWindowStart(Math.floor(event.currentTarget.scrollTop / ROW_HEIGHT))
            }
          >
            <div aria-hidden="true" style={{ height: start * ROW_HEIGHT }} />
            <ol className={styles.rows} aria-label="Safe import preview rows" start={start + 1}>
              {visibleRows.map((row) => (
                <PreviewRow key={row.rowId} row={row} />
              ))}
            </ol>
            <div
              aria-hidden="true"
              style={{
                height: Math.max(0, preview.rows.length - start - visibleRows.length) * ROW_HEIGHT,
              }}
            />
          </div>
          <label className={styles.reviewCheck}>
            <input
              type="checkbox"
              checked={importer.state.reviewed}
              disabled={working || preview.accepted === 0}
              onChange={(event) => importer.setReviewed(event.currentTarget.checked)}
            />
            <span>I reviewed the import summary</span>
          </label>
          <div
            className={styles.confirmRail}
            data-confirmed={importer.state.reviewed ? "true" : "false"}
          >
            <p>Only accepted entries are written in one confirmed vault operation.</p>
            <Button
              disabled={!importer.state.reviewed || preview.accepted === 0 || working}
              loading={importer.state.phase === "confirming"}
              onClick={() => void importer.confirm()}
            >
              Confirm import
            </Button>
          </div>
        </div>
      )}

      {importer.state.error !== null ? (
        <p className={styles.error} role="alert">
          {importer.state.error}
        </p>
      ) : null}
    </section>
  );
}

function PreviewRow({ row }: Readonly<{ row: PreviewRowProjection }>) {
  return (
    <li className={styles.row} data-status={row.status}>
      <span className={styles.ordinal}>{String(row.ordinal).padStart(3, "0")}</span>
      <div className={styles.rowCopy}>
        <strong>{row.metadata?.issuer || "Unavailable metadata"}</strong>
        <span>{row.metadata?.label || "Entry could not be read"}</span>
      </div>
      <span className={styles.type}>{row.metadata?.otpType.toUpperCase() ?? "—"}</span>
      <span className={styles.reason}>{REASON_LABELS[row.reason]}</span>
    </li>
  );
}
