import { useEffect, useRef, useState } from "react";
import { Check, Image as ImageIcon, ShieldCheck } from "lucide-react";
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
        <div className="grid size-9 place-items-center rounded-full bg-emerald-500/15">
          <Check className="size-4 text-emerald-300" strokeWidth={2.25} />
        </div>
        <p className="text-[12.5px] font-medium text-foreground">{done}</p>
        <p className="text-[10.5px] text-muted-foreground">Closing…</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col px-4 py-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="grid size-6 place-items-center rounded-md bg-secondary">
          <ShieldCheck className="size-3.5 text-foreground/85" strokeWidth={1.75} />
        </div>
        <span className="text-[13px] font-semibold tracking-tight">
          Import from QR image
        </span>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
        Pick a QR screenshot. Decoded locally — never uploaded.
      </p>

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="flex w-full flex-col items-center gap-2 rounded-md border border-dashed border-border bg-card/30 py-8 text-[11.5px] text-muted-foreground transition-colors hover:border-border/80 hover:bg-card/60 disabled:opacity-50"
      >
        <ImageIcon className="size-5" strokeWidth={1.5} />
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
  );
}
