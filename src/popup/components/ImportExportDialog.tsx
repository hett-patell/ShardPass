import { useEffect, useRef, useState, type DragEvent } from "react";
import { FileText, FileJson, Upload, Download, Clipboard } from "lucide-react";
import { send } from "@/lib/messages";
import { log, error as logError } from "@/lib/log";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import {
  extractOtpAuthUris,
  otpAuthUrisToAccountDrafts,
} from "@/lib/otpauth-import";

type ImportKind = "json-backup" | "otpauth-txt" | "unknown";
type Source = "file" | "paste" | "drop" | "clipboard";

function detectImportKind(text: string): ImportKind {
  const t = text.trimStart();
  if (t.startsWith("{")) {
    try {
      const j = JSON.parse(text) as { type?: string };
      if (j.type === "shardpass-export" || j.type === "chrome-authenticator-export")
        return "json-backup";
    } catch {
      /* ignore */
    }
  }
  if (/otpauth:\/\//i.test(text)) return "otpauth-txt";
  return "unknown";
}

export function ImportExportDialog({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: (msg?: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [importPassword, setImportPassword] = useState("");
  const [importData, setImportData] = useState("");
  const [importKind, setImportKind] = useState<ImportKind | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) log("import:dialog", "opened");
  }, [open]);

  function reset() {
    setBusy(false);
    setError(null);
    setInfo(null);
    setProgress(null);
    setImportPassword("");
    setImportData("");
    setImportKind(null);
    setPasteText("");
    setDragOver(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  function loadText(text: string, source: Source) {
    const kind = detectImportKind(text);
    log("import", `loaded text source=${source} length=${text.length} kind=${kind}`);
    log("import", `head:`, text.slice(0, 160));
    setImportData(text);
    setImportKind(kind);
    setError(null);
    setInfo(null);
  }

  async function doExport() {
    log("import:click", "export");
    setBusy(true);
    setError(null);
    const res = await send<string>({ kind: "exportVault" });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const blob = new Blob([res.data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shardpass-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setInfo("Backup downloaded.");
  }

  function onChooseFileClick() {
    log("import:click", "choose-file → triggering hidden <input> click");
    fileRef.current?.click();
  }

  async function onPickFile(file: File | null) {
    log("import:file-input", `change: file=${file?.name ?? "null"} size=${file?.size ?? 0}`);
    setError(null);
    setInfo(null);
    setProgress(null);
    if (!file) return;
    try {
      const text = await file.text();
      loadText(text, "file");
    } catch (e) {
      logError("import", `read failed`, e);
      setError(
        "Failed to read file: " +
          (e instanceof Error ? e.message : String(e)),
      );
    }
  }

  async function onPasteFromClipboard() {
    log("import:click", "paste-from-clipboard");
    setError(null);
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        setError("Clipboard is empty.");
        return;
      }
      setPasteText(text);
      loadText(text, "clipboard");
    } catch (e) {
      logError("import", `clipboard read failed`, e);
      setError(
        "Could not read clipboard. Paste into the textarea below instead.",
      );
    }
  }

  function onPasteAreaChange(text: string) {
    setPasteText(text);
    if (!text.trim()) {
      setImportData("");
      setImportKind(null);
      return;
    }
    loadText(text, "paste");
  }

  function onDragEnter(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }
  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }
  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
  }
  async function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    log("import:drop", `dataTransfer files=${e.dataTransfer.files.length}`);
    const file = e.dataTransfer.files[0];
    if (file) {
      try {
        const text = await file.text();
        loadText(text, "drop");
      } catch (err) {
        logError("import", `drop read failed`, err);
        setError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    const text = e.dataTransfer.getData("text/plain");
    if (text) loadText(text, "drop");
  }

  async function doImportEncrypted() {
    log("import:click", "doImportEncrypted");
    setError(null);
    setInfo(null);
    if (!importData.trim()) {
      setError("Choose a backup file first.");
      return;
    }
    if (!importPassword) {
      setError("Enter the backup password.");
      return;
    }
    setBusy(true);
    const res = await send<{ count: number; merged: boolean }>({
      kind: "importVault",
      data: importData,
      password: importPassword,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onChanged(`Imported ${res.data.count} account(s).`);
    reset();
  }

  async function doImportOtpAuthText() {
    log("import:click", "doImportOtpAuthText");
    setError(null);
    setInfo(null);
    setProgress(null);
    if (!importData.trim()) {
      setError("Paste otpauth URIs or choose a file first.");
      return;
    }

    log("import", `input length=${importData.length}`);
    const uris = extractOtpAuthUris(importData);
    log("import", `extracted ${uris.length} URIs`);
    if (uris.length === 0) {
      setError("No otpauth:// URIs found in this file.");
      return;
    }

    const drafts = otpAuthUrisToAccountDrafts(uris);
    log(
      "import",
      `parsed ${drafts.length} drafts (from ${uris.length} URIs)`,
      drafts.map((d) => ({
        issuer: d.issuer,
        label: d.label,
        secretLen: d.secret.length,
        algo: d.algorithm,
        digits: d.digits,
        period: d.period,
      })),
    );
    if (drafts.length === 0) {
      setError(`Found ${uris.length} URIs but none were valid TOTP.`);
      return;
    }

    setBusy(true);
    setProgress(`Adding ${drafts.length} account${drafts.length === 1 ? "" : "s"}…`);

    const res = await send<{
      added: number;
      skippedDuplicates: number;
      skippedInvalid: number;
      totalProcessed: number;
    }>({ kind: "bulkAddAccounts", accounts: drafts });

    setBusy(false);
    setProgress(null);

    if (!res.ok) {
      logError("import", `bulkAddAccounts failed:`, res.error);
      setError(res.error);
      return;
    }

    log("import", `bulkAddAccounts response:`, res.data);
    const { added, skippedDuplicates, skippedInvalid } = res.data;
    if (added === 0) {
      const reason =
        skippedDuplicates > 0 && skippedInvalid === 0
          ? "All accounts already exist."
          : skippedInvalid > 0 && skippedDuplicates === 0
            ? "All secrets were invalid."
            : "Nothing was imported.";
      setError(reason);
      return;
    }
    const parts: string[] = [`Added ${added}`];
    if (skippedDuplicates) parts.push(`${skippedDuplicates} duplicate`);
    if (skippedInvalid) parts.push(`${skippedInvalid} invalid`);
    onChanged(parts.join(" · ") + ".");
    reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Backup</DialogTitle>
          <DialogDescription>
            Import accounts or download an encrypted backup.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          defaultValue="import"
          onValueChange={() => {
            setError(null);
            setInfo(null);
          }}
        >
          <TabsList>
            <TabsTrigger value="import">Import</TabsTrigger>
            <TabsTrigger value="export">Export</TabsTrigger>
          </TabsList>

          <TabsContent value="import">
            <div
              className="space-y-2.5"
              onDragEnter={onDragEnter}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={(e) => void onDrop(e)}
            >
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onChooseFileClick}
                  disabled={busy}
                  className="flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-card/30 py-4 text-[11px] text-muted-foreground transition-colors hover:border-border/80 hover:bg-card/60 disabled:opacity-50"
                >
                  <Upload className="size-4" strokeWidth={1.5} />
                  Choose file
                </button>
                <button
                  type="button"
                  onClick={() => void onPasteFromClipboard()}
                  disabled={busy}
                  className="flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-card/30 py-4 text-[11px] text-muted-foreground transition-colors hover:border-border/80 hover:bg-card/60 disabled:opacity-50"
                >
                  <Clipboard className="size-4" strokeWidth={1.5} />
                  Paste clipboard
                </button>
              </div>

              <input
                ref={fileRef}
                type="file"
                accept=".json,.txt,text/plain,application/json"
                className="hidden"
                onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
              />

              <div className="relative">
                <textarea
                  value={pasteText}
                  onChange={(e) => onPasteAreaChange(e.target.value)}
                  placeholder="…or paste otpauth:// URIs / encrypted backup JSON here"
                  rows={4}
                  className={`w-full resize-none rounded-md border bg-input/30 px-3 py-2 text-[11px] font-mono leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 placeholder:font-sans focus:bg-input/50 focus:ring-2 focus:ring-ring/30 ${
                    dragOver ? "border-foreground/40 bg-input/60" : "border-border"
                  }`}
                />
                {dragOver && (
                  <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-md bg-background/70 text-[11px] font-medium text-foreground">
                    Drop file here
                  </div>
                )}
              </div>

              {importData && (
                <div className="flex items-center justify-between rounded-md border border-border bg-secondary/40 px-3 py-2">
                  <span className="flex items-center gap-2 text-[11px] text-foreground/85">
                    {importKind === "json-backup" && (
                      <>
                        <FileJson className="size-3.5 text-muted-foreground" />
                        Encrypted backup
                      </>
                    )}
                    {importKind === "otpauth-txt" && (
                      <>
                        <FileText className="size-3.5 text-muted-foreground" />
                        otpauth:// URIs detected
                      </>
                    )}
                    {importKind === "unknown" && (
                      <>
                        <FileText className="size-3.5 text-muted-foreground" />
                        Unknown format
                      </>
                    )}
                  </span>
                  <button
                    type="button"
                    className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                    onClick={reset}
                  >
                    Clear
                  </button>
                </div>
              )}

              {importKind === "json-backup" && (
                <div className="space-y-2.5">
                  <Input
                    type="password"
                    autoComplete="off"
                    value={importPassword}
                    onChange={(e) => setImportPassword(e.target.value)}
                    placeholder="Backup password"
                  />
                  <Button
                    type="button"
                    onClick={() => void doImportEncrypted()}
                    disabled={busy}
                    className="w-full"
                  >
                    {busy ? "Importing…" : "Import backup"}
                  </Button>
                </div>
              )}

              {importKind === "otpauth-txt" && (
                <Button
                  type="button"
                  onClick={() => void doImportOtpAuthText()}
                  disabled={busy || !importData.trim()}
                  className="w-full"
                >
                  {busy ? progress || "Importing…" : "Import accounts"}
                </Button>
              )}

              {importKind === "unknown" && importData && (
                <Alert variant="destructive">Not a recognized format.</Alert>
              )}

              {error && <Alert variant="destructive">{error}</Alert>}
              {info && <Alert variant="success">{info}</Alert>}
            </div>
          </TabsContent>

          <TabsContent value="export">
            <div className="space-y-3">
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Download an encrypted JSON backup. Re-import requires this
                vault's master password.
              </p>
              <Button
                type="button"
                onClick={() => void doExport()}
                disabled={busy}
                className="w-full"
              >
                <Download />
                {busy ? "Preparing…" : "Download backup"}
              </Button>
              {error && <Alert variant="destructive">{error}</Alert>}
              {info && <Alert variant="success">{info}</Alert>}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
