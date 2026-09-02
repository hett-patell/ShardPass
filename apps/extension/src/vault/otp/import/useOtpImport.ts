import { parseOtpImportText } from "@shardpass/importers/detect";
import { parseGoogleMigrationUris } from "@shardpass/importers/google-migration";
import { IMPORT_LIMITS, type ParsedOtpImport } from "@shardpass/importers/import-model";
import type { ImportPreviewRow, ImportSourceFormat, OtpImportResponse } from "@shardpass/messaging";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type { OtpImportUiExtensionPlatform } from "../../../platform/extension-platform";
import { createImageImportExecutor, type ImageImportExecutor } from "./image-import-executor";

export type ImportTextParser = (
  text: string,
  signal: AbortSignal,
) => ParsedOtpImport | Promise<ParsedOtpImport>;

type SafeRow = Readonly<{
  rowId: string;
  ordinal: number;
  status: "accepted" | "duplicate" | "rejected";
  reason: ImportPreviewRow["reason"];
  metadata: Extract<
    OtpImportResponse,
    { kind: "otp.importPreviewResult" }
  >["rows"][number]["metadata"];
}>;
type PreviewState = Readonly<{
  token: string | null;
  format: ImportSourceFormat;
  rows: readonly SafeRow[];
  accepted: number;
  duplicate: number;
  rejected: number;
}>;
type ImportState = Readonly<{
  phase: "input" | "parsing" | "preview" | "confirming" | "complete";
  preview: PreviewState | null;
  reviewed: boolean;
  error: string | null;
  status: string | null;
}>;
type OwnedJob = {
  id: number;
  controller: AbortController;
  text: string | null;
  file: Blob | null;
  payload: string | null;
  candidates: ParsedOtpImport["candidates"] | null;
  requestCandidates: Array<Record<string, unknown>> | null;
  disposed: boolean;
  dispose(): void;
};

const INITIAL_STATE: ImportState = Object.freeze({
  phase: "input",
  preview: null,
  reviewed: false,
  error: null,
  status: null,
});
const MIGRATION_PREFIX = "otpauth-migration://offline?data=";

function createOwnedJob(id: number): OwnedJob {
  const controller = new AbortController();
  return {
    id,
    controller,
    text: null,
    file: null,
    payload: null,
    candidates: null,
    requestCandidates: null,
    disposed: false,
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.controller.abort();
      this.text = null;
      this.file = null;
      this.payload = null;
      this.candidates = null;
      this.requestCandidates?.splice(0);
      this.requestCandidates = null;
    },
  };
}

function defaultParseText(text: string, signal: AbortSignal): Promise<ParsedOtpImport> {
  if (text.startsWith(MIGRATION_PREFIX))
    return parseGoogleMigrationUris(
      text.split(/\r?\n/gu).filter((line) => line.trim().length > 0),
      { signal },
    );
  if (signal.aborted) return Promise.reject(new Error("IMPORT_MALFORMED"));
  return Promise.resolve(parseOtpImportText(text));
}

function fixedError(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : error instanceof Error
        ? error.message
        : "";
  switch (code) {
    case "OTP_IMPORT_LIMIT":
    case "IMPORT_LIMIT_EXCEEDED":
    case "IMAGE_LIMIT":
      return "Import exceeds the safe local limit.";
    case "OTP_IMPORT_EXPIRED":
      return "Import preview expired. Create a new preview.";
    case "OTP_IMPORT_CAPACITY":
      return "The vault does not have capacity for this import.";
    case "VAULT_LOCKED":
      return "Unlock the vault before importing.";
    case "OTP_IMPORT_UNAVAILABLE":
      return "Import is unavailable. Try again from this vault page.";
    default:
      return "Import could not be read safely.";
  }
}

function rejectedRows(parsed: ParsedOtpImport): SafeRow[] {
  return parsed.rejected.map((row) => ({
    rowId: `local-rejected-${row.ordinal}`,
    ordinal: row.ordinal,
    status: "rejected",
    reason:
      row.reason === "IMPORT_UNSUPPORTED" || row.reason === "IMPORT_LIMIT_EXCEEDED"
        ? row.reason
        : "IMPORT_MALFORMED",
    metadata: null,
  }));
}

function unifiedPreview(
  format: ImportSourceFormat,
  localRows: readonly SafeRow[],
  response?: Extract<
    OtpImportResponse,
    { kind: "otp.importPreviewResult" | "otp.importPreviewChanged" }
  >,
): PreviewState {
  const rows = [...(response?.rows ?? []), ...localRows].sort(
    (left, right) => left.ordinal - right.ordinal,
  );
  return Object.freeze({
    token: response?.previewToken ?? null,
    format,
    rows: Object.freeze(rows),
    accepted: response?.accepted ?? 0,
    duplicate: response?.duplicate ?? 0,
    rejected: (response?.rejected ?? 0) + localRows.length,
  });
}

export function useOtpImport({
  platform,
  active,
  onImported,
  parseText = defaultParseText,
  imageExecutor = createImageImportExecutor(),
}: Readonly<{
  platform: OtpImportUiExtensionPlatform;
  active: boolean;
  onImported: () => void;
  parseText?: ImportTextParser;
  imageExecutor?: ImageImportExecutor;
}>) {
  const [state, setState] = useState<ImportState>(INITIAL_STATE);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const ownerRef = useRef<OwnedJob | null>(null);
  const operationRef = useRef(0);
  const previewTokenRef = useRef<string | null>(null);

  const clearControls = useCallback(() => {
    if (textRef.current !== null) textRef.current.value = "";
    if (fileRef.current !== null) fileRef.current.value = "";
  }, []);
  const owns = useCallback(
    (owner: OwnedJob) => active && !owner.disposed && ownerRef.current === owner,
    [active],
  );
  const cancelBackground = useCallback(
    (token: string | null) => {
      if (token === null) return;
      const pending = platform.sendOtpImportMessage({
        version: 1,
        kind: "otp.importCancel",
        previewToken: token,
      });
      void pending.catch(() => undefined);
    },
    [platform],
  );
  const disposeOwner = useCallback(() => {
    ownerRef.current?.dispose();
    ownerRef.current = null;
  }, []);
  const clear = useCallback(
    (restoreFocus = false) => {
      operationRef.current += 1;
      disposeOwner();
      clearControls();
      const token = previewTokenRef.current;
      previewTokenRef.current = null;
      setState(INITIAL_STATE);
      cancelBackground(token);
      if (restoreFocus) queueMicrotask(() => textRef.current?.focus());
    },
    [cancelBackground, clearControls, disposeOwner],
  );
  useLayoutEffect(() => {
    if (!active) clear(false);
  }, [active, clear]);
  useLayoutEffect(() => () => clear(false), [clear]);

  const publishParsed = useCallback(
    (owner: OwnedJob, parsed: ParsedOtpImport) => {
      if (!owns(owner)) return;
      owner.candidates = parsed.candidates;
      const ordinals = [
        ...parsed.candidates.map((candidate) => candidate.sourceOrdinal),
        ...parsed.rejected.map((row) => row.ordinal),
      ];
      if (
        ordinals.some(
          (ordinal) =>
            ordinal === undefined ||
            !Number.isSafeInteger(ordinal) ||
            ordinal < 1 ||
            ordinal > IMPORT_LIMITS.maxEntries,
        ) ||
        new Set(ordinals).size !== ordinals.length
      ) {
        owner.dispose();
        ownerRef.current = null;
        setState({ ...INITIAL_STATE, error: "Import could not be read safely." });
        return;
      }
      const localRows = rejectedRows(parsed);
      if (parsed.candidates.length === 0) {
        owner.dispose();
        ownerRef.current = null;
        setState({
          phase: "preview",
          preview: unifiedPreview(parsed.format, localRows),
          reviewed: false,
          error: null,
          status: null,
        });
        return;
      }
      const requestCandidates = parsed.candidates.map((candidate) => ({
        ...candidate,
        tags: [...candidate.tags],
      }));
      owner.requestCandidates = requestCandidates;
      const pending = platform.sendOtpImportMessage({
        version: 1,
        kind: "otp.importPreview",
        format: parsed.format,
        candidates: requestCandidates as never,
      });
      requestCandidates.splice(0);
      owner.requestCandidates = null;
      owner.candidates = null;
      void pending.then(
        (response) => {
          if (!owns(owner)) {
            if (response.kind === "otp.importPreviewResult")
              cancelBackground(response.previewToken);
            return;
          }
          if (response.kind !== "otp.importPreviewResult")
            throw new Error("OTP_IMPORT_UNAVAILABLE");
          previewTokenRef.current = response.previewToken;
          owner.dispose();
          ownerRef.current = null;
          setState({
            phase: "preview",
            preview: unifiedPreview(parsed.format, localRows, response),
            reviewed: false,
            error: null,
            status: null,
          });
        },
        (error) => {
          if (!owns(owner)) return;
          owner.dispose();
          ownerRef.current = null;
          setState({ ...INITIAL_STATE, error: fixedError(error) });
        },
      );
    },
    [cancelBackground, owns, platform],
  );

  const beginText = useCallback(
    (raw: string, source: "text" | "image") => {
      disposeOwner();
      const owner = createOwnedJob(++operationRef.current);
      ownerRef.current = owner;
      owner.text = raw;
      setState({
        phase: "parsing",
        preview: null,
        reviewed: false,
        error: null,
        status: source === "image" ? "Image selected" : null,
      });
      if (
        Array.from(raw).length < 1 ||
        Array.from(raw).length > IMPORT_LIMITS.maxTextScalars ||
        new TextEncoder().encode(raw).byteLength > IMPORT_LIMITS.maxInputBytes
      ) {
        owner.dispose();
        ownerRef.current = null;
        setState({ ...INITIAL_STATE, error: "Import exceeds the safe local limit." });
        return;
      }
      let pending: Promise<ParsedOtpImport>;
      try {
        pending = Promise.resolve(parseText(raw, owner.controller.signal));
      } catch (error) {
        owner.dispose();
        ownerRef.current = null;
        setState({ ...INITIAL_STATE, error: fixedError(error) });
        return;
      }
      owner.text = null;
      void pending.then(
        (parsed) => {
          if (!owns(owner)) return;
          publishParsed(
            owner,
            source === "image" ? Object.freeze({ ...parsed, format: "qr" }) : parsed,
          );
        },
        (error) => {
          if (!owns(owner)) return;
          owner.dispose();
          ownerRef.current = null;
          setState({ ...INITIAL_STATE, error: fixedError(error) });
        },
      );
    },
    [disposeOwner, owns, parseText, publishParsed],
  );

  const previewText = useCallback(() => {
    const raw = textRef.current?.value ?? "";
    clearControls();
    beginText(raw, "text");
  }, [beginText, clearControls]);

  const selectImage = useCallback(
    (selected: File | undefined) => {
      if (selected === undefined) return;
      clearControls();
      if (selected.type !== "image/png") {
        setState({ ...INITIAL_STATE, error: "Choose a PNG image." });
        return;
      }
      if (selected.size < 1 || selected.size > IMPORT_LIMITS.maxImageBytes) {
        setState({ ...INITIAL_STATE, error: "Image is too large." });
        return;
      }
      disposeOwner();
      const owner = createOwnedJob(++operationRef.current);
      owner.file = selected;
      ownerRef.current = owner;
      setState({
        phase: "parsing",
        preview: null,
        reviewed: false,
        error: null,
        status: "Image selected",
      });
      const pending = imageExecutor.decode(selected, owner.controller.signal);
      owner.file = null;
      void pending.then(
        (payload) => {
          if (!owns(owner)) return;
          owner.payload = payload;
          owner.dispose();
          ownerRef.current = null;
          beginText(payload, "image");
        },
        (error) => {
          if (!owns(owner)) return;
          owner.dispose();
          ownerRef.current = null;
          setState({ ...INITIAL_STATE, error: fixedError(error) });
        },
      );
    },
    [beginText, clearControls, disposeOwner, imageExecutor, owns],
  );

  const confirm = useCallback(() => {
    const token = previewTokenRef.current;
    if (token === null || !state.reviewed || (state.preview?.accepted ?? 0) === 0) return;
    const operation = ++operationRef.current;
    setState((current) => ({ ...current, phase: "confirming", error: null }));
    const pending = platform.sendOtpImportMessage({
      version: 1,
      kind: "otp.importConfirm",
      previewToken: token,
    });
    void pending.then(
      (response) => {
        if (operation !== operationRef.current || !active) return;
        if (response.kind === "otp.importPreviewChanged") {
          previewTokenRef.current = response.previewToken;
          setState({
            phase: "preview",
            preview: unifiedPreview(response.format, [], response),
            reviewed: false,
            error: "Import summary changed. Review it again before confirming.",
            status: null,
          });
          return;
        }
        if (response.kind !== "otp.importConfirmed") throw new Error("OTP_IMPORT_UNAVAILABLE");
        clearControls();
        previewTokenRef.current = null;
        setState({
          phase: "complete",
          preview: null,
          reviewed: false,
          error: null,
          status: `${response.imported.toLocaleString("en-US")} OTP ${response.imported === 1 ? "item" : "items"} imported`,
        });
        onImported();
      },
      (error) => {
        if (operation === operationRef.current && active)
          setState((current) => ({
            ...current,
            phase: "preview",
            reviewed: false,
            error: fixedError(error),
          }));
      },
    );
  }, [active, clearControls, onImported, platform, state.preview?.accepted, state.reviewed]);

  return {
    state,
    textRef,
    fileRef,
    previewText,
    selectImage,
    confirm,
    cancel: () => clear(true),
    setReviewed: (reviewed: boolean) => setState((current) => ({ ...current, reviewed })),
  };
}
