import { useEffect, useState } from "react";
import { Check, Sparkles, Trash2 } from "lucide-react";
import { send } from "@/lib/messages";
import type { IntegrationStatus } from "@/lib/messages";
import type { Settings } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

const TIMER_OPTIONS = [
  { v: "0", label: "Off" },
  { v: "5", label: "5 minutes" },
  { v: "15", label: "15 minutes" },
  { v: "30", label: "30 minutes" },
  { v: "60", label: "1 hour" },
];

export function SettingsMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [duckConfigured, setDuckConfigured] = useState<boolean | null>(null);
  const [duckTokenInput, setDuckTokenInput] = useState("");
  const [duckBusy, setDuckBusy] = useState(false);
  const [duckMessage, setDuckMessage] = useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);

  useEffect(() => {
    if (!open) return;
    setDuckMessage(null);
    void send<Settings>({ kind: "getSettings" }).then((res) => {
      if (res.ok) setSettings(res.data);
    });
    void send<IntegrationStatus>({ kind: "getIntegrationStatus" }).then(
      (res) => {
        if (res.ok) setDuckConfigured(res.data.duckduckgoConfigured);
      },
    );
  }, [open]);

  async function updateAutoLock(autoLockMinutes: number) {
    setBusy(true);
    const res = await send<Settings>({
      kind: "updateSettings",
      autoLockMinutes,
    });
    setBusy(false);
    if (res.ok) setSettings(res.data);
  }

  async function updateScreenLock(lockOnScreenLock: boolean) {
    setBusy(true);
    const res = await send<Settings>({
      kind: "updateSettings",
      lockOnScreenLock,
    });
    setBusy(false);
    if (res.ok) setSettings(res.data);
  }

  async function saveDuckToken() {
    const token = duckTokenInput.trim();
    if (!token) {
      setDuckMessage({ kind: "err", text: "Paste your bearer token." });
      return;
    }
    setDuckBusy(true);
    setDuckMessage(null);
    const res = await send<{ duckduckgoConfigured: boolean }>({
      kind: "setDuckToken",
      token,
    });
    setDuckBusy(false);
    if (!res.ok) {
      setDuckMessage({ kind: "err", text: res.error });
      return;
    }
    setDuckConfigured(true);
    setDuckTokenInput("");
    setDuckMessage({ kind: "ok", text: "Token saved." });
  }

  async function clearDuckToken() {
    setDuckBusy(true);
    setDuckMessage(null);
    const res = await send<{ duckduckgoConfigured: boolean }>({
      kind: "clearDuckToken",
    });
    setDuckBusy(false);
    if (!res.ok) {
      setDuckMessage({ kind: "err", text: res.error });
      return;
    }
    setDuckConfigured(false);
    setDuckMessage({ kind: "ok", text: "Disconnected." });
  }

  async function generateAndCopy() {
    setDuckBusy(true);
    setDuckMessage(null);
    const res = await send<{ alias: string }>({ kind: "generateDuckAlias" });
    setDuckBusy(false);
    if (!res.ok) {
      setDuckMessage({ kind: "err", text: res.error });
      return;
    }
    try {
      await navigator.clipboard.writeText(res.data.alias);
    } catch {
      /* ignore */
    }
    setDuckMessage({ kind: "ok", text: `${res.data.alias} — copied` });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Auto-lock, security, and integrations.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-0.5">
              <div className="text-[12.5px] font-medium text-foreground">
                Lock on screen lock
              </div>
              <p className="text-[10.5px] text-muted-foreground">
                Auto-lock when your OS screen locks.
              </p>
            </div>
            <Switch
              disabled={!settings || busy}
              checked={settings?.lockOnScreenLock ?? true}
              onCheckedChange={(v) => void updateScreenLock(v)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Auto-lock timer</Label>
            <Select
              disabled={!settings || busy}
              value={String(settings?.autoLockMinutes ?? 0)}
              onValueChange={(v) => void updateAutoLock(Number(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMER_OPTIONS.map((o) => (
                  <SelectItem key={o.v} value={o.v}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="m-0">DuckDuckGo Email Protection</Label>
              {duckConfigured && (
                <span className="flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wider text-emerald-300">
                  <Check className="size-2.5" /> connected
                </span>
              )}
            </div>
            <p className="text-[10.5px] leading-relaxed text-muted-foreground">
              Generate <span className="font-mono">@duck.com</span> aliases when
              adding accounts. Your token is stored inside the encrypted vault.
            </p>

            {duckConfigured ? (
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="flex-1"
                  disabled={duckBusy}
                  onClick={() => void generateAndCopy()}
                >
                  <Sparkles />
                  {duckBusy ? "Generating…" : "Generate alias"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={duckBusy}
                  onClick={() => void clearDuckToken()}
                  title="Disconnect"
                >
                  <Trash2 />
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder="Bearer token"
                  value={duckTokenInput}
                  onChange={(e) => setDuckTokenInput(e.target.value)}
                  className="font-mono text-[11px]"
                />
                <Button
                  type="button"
                  size="sm"
                  className="w-full"
                  disabled={duckBusy || !duckTokenInput.trim()}
                  onClick={() => void saveDuckToken()}
                >
                  {duckBusy ? "Saving…" : "Connect"}
                </Button>
                <p className="text-[10px] leading-relaxed text-muted-foreground/80">
                  Get your token at{" "}
                  <a
                    href="https://duckduckgo.com/email/settings/autofill"
                    target="_blank"
                    rel="noreferrer"
                    className="text-foreground/85 underline-offset-2 hover:underline"
                  >
                    duckduckgo.com/email/settings/autofill
                  </a>{" "}
                  — DevTools → Network → click "Generate Private Duck Address"
                  → copy the <span className="font-mono">Authorization</span>{" "}
                  bearer.
                </p>
              </div>
            )}

            {duckMessage && (
              <Alert
                variant={duckMessage.kind === "ok" ? "success" : "destructive"}
              >
                {duckMessage.text}
              </Alert>
            )}
          </div>

          <Separator />

          <p className="text-[10px] text-muted-foreground/80">
            AES-256-GCM · PBKDF2 · 250k iterations · SHA-256
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
