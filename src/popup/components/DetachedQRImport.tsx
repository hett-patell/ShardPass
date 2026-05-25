import { useEffect, useRef, useState } from "react";
import { Check, Image as ImageIcon } from "lucide-react";
import { send } from "@/lib/messages";
import { decodeQRFromFile } from "@/lib/qr";
import { parseOtpAuthURI } from "@/lib/totp";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export function DetachedQRImport() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!done) return;
    const id = window.setTimeout(() => window.close(), 1400);
    return () => window.clearTimeout(id);
  }, [done]);

  async function onPick(file: File | null) {
    setError(null);
    if (!file) return;
    setBusy(true);
    try {
      const data = await decodeQRFromFile(file);
      if (!data) {
        setError("Could not read a QR code from that image.");
        return;
      }
      const parsed = parseOtpAuthURI(data);
      if (!parsed) {
        setError("QR code is not a valid otpauth:// TOTP URI.");
        return;
      }
      const res = await send<{ id: string }>({
        kind: "addAccount",
        account: { ...parsed, tags: [] },
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(`Added ${parsed.issuer || parsed.label || "account"}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center animate-fade-in">
        <div className="grid size-10 place-items-center rounded-sm border border-success/30 bg-success/10">
          <Check className="size-4 text-success" strokeWidth={2.5} />
        </div>
        <p className="text-[13px] font-semibold tracking-[-0.015em] text-foreground">
          {done}
        </p>
        <p className="code-mono text-[10px] text-muted-foreground">Closing…</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col animate-fade-in">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-2 border-b border-border-soft px-4 pt-4 pb-3">
        <div
          className="grid size-6 place-items-center rounded-[2px] bg-primary text-primary-foreground"
          aria-hidden
        >
          <span className="text-[13px] font-bold leading-none tracking-[-0.04em]">
            S
          </span>
        </div>
        <span className="text-[13px] font-semibold leading-none tracking-[-0.02em] text-foreground">
          Import from QR
        </span>
      </header>

      <div className="flex-1 flex flex-col px-4 py-4">
        <p className="mb-3 text-[12px] leading-relaxed text-muted-foreground">
          Pick a QR screenshot. Decoded locally — never uploaded.
        </p>

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="flex w-full flex-col items-center gap-2 rounded-sm border border-dashed border-border bg-card/50 py-10 text-[13px] font-medium text-muted-foreground transition-[border-color,background,color] duration-100 hover:border-primary hover:bg-card hover:text-foreground disabled:opacity-50 outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
        >
          <ImageIcon className="size-5" strokeWidth={1.75} />
          {busy ? "Decoding…" : "Choose QR image"}
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void onPick(e.target.files?.[0] ?? null)}
        />

        {error && (
          <div className="mt-3">
            <Alert variant="destructive">{error}</Alert>
          </div>
        )}

        <div className="mt-auto flex justify-end pt-3">
          <Button type="button" variant="ghost" onClick={() => window.close()}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
