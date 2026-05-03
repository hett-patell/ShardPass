import { useEffect, useRef, useState, type FormEvent } from "react";
import { Image as ImageIcon, Sparkles } from "lucide-react";
import { send } from "@/lib/messages";
import type { IntegrationStatus } from "@/lib/messages";
import { isValidBase32, parseOtpAuthURI } from "@/lib/totp";
import { decodeQRFromFile } from "@/lib/qr";
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
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function AddAccountDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}) {
  const [mode, setMode] = useState<"manual" | "qr">("manual");
  const [issuer, setIssuer] = useState("");
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [digits, setDigits] = useState<6 | 7 | 8>(6);
  const [period, setPeriod] = useState(30);
  const [algorithm, setAlgorithm] = useState<"SHA1" | "SHA256" | "SHA512">("SHA1");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [duckConfigured, setDuckConfigured] = useState(false);
  const [aliasBusy, setAliasBusy] = useState(false);
  const [aliasNote, setAliasNote] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    void send<IntegrationStatus>({ kind: "getIntegrationStatus" }).then(
      (res) => {
        if (res.ok) setDuckConfigured(res.data.duckduckgoConfigured);
      },
    );
  }, [open]);

  async function generateAlias() {
    setAliasBusy(true);
    setAliasNote(null);
    setError(null);
    const res = await send<{ alias: string }>({ kind: "generateDuckAlias" });
    setAliasBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setLabel(res.data.alias);
    try {
      await navigator.clipboard.writeText(res.data.alias);
      setAliasNote(`${res.data.alias} — copied`);
    } catch {
      setAliasNote(res.data.alias);
    }
  }

  function reset() {
    setMode("manual");
    setIssuer("");
    setLabel("");
    setSecret("");
    setAdvanced(false);
    setDigits(6);
    setPeriod(30);
    setAlgorithm("SHA1");
    setError(null);
    setBusy(false);
    setAliasNote(null);
    setAliasBusy(false);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!issuer.trim() && !label.trim()) {
      setError("Provide an issuer or account name.");
      return;
    }
    if (!isValidBase32(secret)) {
      setError("Secret must be valid base32 (A–Z, 2–7).");
      return;
    }
    setBusy(true);
    const res = await send({
      kind: "addAccount",
      account: {
        issuer: issuer.trim(),
        label: label.trim(),
        secret,
        digits,
        period,
        algorithm,
        tags: [],
      },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    reset();
    onAdded();
  }

  async function onPickFile(file: File | null) {
    setError(null);
    if (!file) return;
    setBusy(true);
    const data = await decodeQRFromFile(file);
    setBusy(false);
    if (!data) {
      setError("Could not read a QR code from that image.");
      return;
    }
    const parsed = parseOtpAuthURI(data);
    if (!parsed) {
      setError("QR code is not a valid otpauth:// TOTP URI.");
      return;
    }
    setIssuer(parsed.issuer);
    setLabel(parsed.label);
    setSecret(parsed.secret);
    setDigits(parsed.digits);
    setPeriod(parsed.period);
    setAlgorithm(parsed.algorithm);
    setMode("manual");
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
          <DialogTitle>Add account</DialogTitle>
          <DialogDescription>
            Enter a TOTP secret manually or import from a QR image.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as "manual" | "qr")}>
          <TabsList>
            <TabsTrigger value="manual">Manual</TabsTrigger>
            <TabsTrigger value="qr">QR image</TabsTrigger>
          </TabsList>

          <TabsContent value="manual">
            <form className="space-y-2.5" onSubmit={onSubmit}>
              <Field label="Issuer" value={issuer} onChange={setIssuer} placeholder="GitHub" />
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label>Account</Label>
                  {duckConfigured && (
                    <button
                      type="button"
                      onClick={() => void generateAlias()}
                      disabled={aliasBusy}
                      className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                      title="Generate a duck.com alias and fill this field"
                    >
                      <Sparkles className="size-2.5" />
                      {aliasBusy ? "Generating…" : "Duck alias"}
                    </button>
                  )}
                </div>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="you@example.com"
                />
                {aliasNote && (
                  <p className="text-[10px] text-emerald-300">{aliasNote}</p>
                )}
              </div>
              <Field
                label="Secret"
                value={secret}
                onChange={(v) => setSecret(v.toUpperCase())}
                placeholder="JBSWY3DPEHPK3PXP"
                mono
              />

              <button
                type="button"
                className="text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setAdvanced((v) => !v)}
              >
                {advanced ? "Hide" : "Show"} advanced
              </button>

              {advanced && (
                <div className="grid grid-cols-3 gap-2">
                  <SmallSelect
                    label="Digits"
                    value={String(digits)}
                    onChange={(v) => setDigits(Number(v) as 6 | 7 | 8)}
                    options={["6", "7", "8"]}
                  />
                  <SmallSelect
                    label="Period"
                    value={String(period)}
                    onChange={(v) => setPeriod(Number(v))}
                    options={["15", "30", "60"]}
                  />
                  <SmallSelect
                    label="Hash"
                    value={algorithm}
                    onChange={(v) =>
                      setAlgorithm(v as "SHA1" | "SHA256" | "SHA512")
                    }
                    options={["SHA1", "SHA256", "SHA512"]}
                  />
                </div>
              )}

              {error && <Alert variant="destructive">{error}</Alert>}

              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? "Adding…" : "Add account"}
                </Button>
              </div>
            </form>
          </TabsContent>

          <TabsContent value="qr">
            <div className="space-y-3">
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Upload a QR screenshot. Decoded locally — never uploaded.
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                className="flex w-full flex-col items-center gap-2 rounded-md border border-dashed border-border bg-card/30 py-6 text-[11.5px] text-muted-foreground transition-colors hover:border-border/80 hover:bg-card/60 disabled:opacity-50"
              >
                <ImageIcon className="size-5" strokeWidth={1.5} />
                {busy ? "Decoding…" : "Choose QR image"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
              />
              {error && <Alert variant="destructive">{error}</Alert>}
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={mono ? "code-mono" : undefined}
      />
    </div>
  );
}

function SmallSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[9.5px]">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-[11.5px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
