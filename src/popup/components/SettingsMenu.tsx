import { useEffect, useState } from "react";
import { Check, Sparkles, Trash2, RefreshCw, LogOut, Shield } from "lucide-react";
import { send } from "@/lib/messages";
import type { EnteStatus, IntegrationStatus } from "@/lib/messages";
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

          {/* ── Ente Auth Sync ──────────────────────────── */}
          <EnteAuthSection />

          <Separator />

          <p className="text-[10px] text-muted-foreground/80">
            AES-256-GCM · PBKDF2 · 250k iterations · SHA-256
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ────────────────────────────────────────────────────────────────
   Ente Auth Sync — self-contained sub-component
   ──────────────────────────────────────────────────────────────── */

function EnteAuthSection() {
  const [status, setStatus] = useState<EnteStatus | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [twofaCode, setTwofaCode] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    void send<IntegrationStatus>({ kind: "getIntegrationStatus" }).then((res) => {
      if (res.ok) setStatus(res.data.ente);
    });
  }, []);

  function resetForm() {
    setEmail("");
    setPassword("");
    setServerUrl("");
    setTwofaCode("");
    setShowAdvanced(false);
    setMessage(null);
  }

  async function doLogin() {
    if (!email.trim() || !password) {
      setMessage({ kind: "err", text: "Email and password are required." });
      return;
    }
    setBusy(true);
    setMessage(null);
    const res = await send<{ status: EnteStatus; syncError?: string | null }>({
      kind: "enteLogin",
      email: email.trim(),
      password,
      serverUrl: serverUrl.trim() || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setMessage({ kind: "err", text: res.error });
      return;
    }
    setStatus(res.data.status);
    if (res.data.status.pending2FA) {
      setMessage({ kind: "ok", text: "2FA required — enter code below." });
      return;
    }
    resetForm();
    if (res.data.syncError) {
      setMessage({ kind: "err", text: `Connected but sync failed: ${res.data.syncError}` });
    } else {
      setMessage({ kind: "ok", text: "Connected & synced!" });
    }
  }

  async function doSubmit2FA() {
    if (!twofaCode.trim()) {
      setMessage({ kind: "err", text: "Enter your 2FA code." });
      return;
    }
    setBusy(true);
    setMessage(null);
    const res = await send<{ status: EnteStatus; syncError?: string | null }>({
      kind: "enteSubmit2FA",
      code: twofaCode.trim(),
    });
    setBusy(false);
    if (!res.ok) {
      setMessage({ kind: "err", text: res.error });
      return;
    }
    setStatus(res.data.status);
    resetForm();
    if (res.data.syncError) {
      setMessage({ kind: "err", text: `Connected but sync failed: ${res.data.syncError}` });
    } else {
      setMessage({ kind: "ok", text: "Connected & synced!" });
    }
  }

  async function doSync() {
    setSyncing(true);
    setMessage(null);
    const res = await send<{ status: EnteStatus }>({ kind: "enteSyncNow" });
    setSyncing(false);
    if (!res.ok) {
      setMessage({ kind: "err", text: res.error });
      return;
    }
    setStatus(res.data.status);
    setMessage({ kind: "ok", text: "Sync complete." });
  }

  async function doDisconnect() {
    setBusy(true);
    setMessage(null);
    const res = await send<{ status: EnteStatus }>({ kind: "enteDisconnect" });
    setBusy(false);
    if (!res.ok) {
      setMessage({ kind: "err", text: res.error });
      return;
    }
    setStatus(res.data.status);
    resetForm();
    setMessage({ kind: "ok", text: "Disconnected." });
  }

  if (!status) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="m-0 flex items-center gap-1.5">
          <Shield className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
          Ente Auth Sync
        </Label>
        {status.connected && (
          <span className="flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wider text-emerald-300">
            <Check className="size-2.5" /> synced
          </span>
        )}
      </div>
      <p className="text-[10.5px] leading-relaxed text-muted-foreground">
        Two-way sync your TOTP accounts with{" "}
        <a
          href="https://ente.io/auth"
          target="_blank"
          rel="noreferrer"
          className="text-foreground/85 underline-offset-2 hover:underline"
        >
          Ente Auth
        </a>
        . Credentials are stored inside the encrypted vault.
      </p>

      {status.connected ? (
        <div className="space-y-2">
          <div className="rounded-md border border-border bg-secondary/40 px-3 py-2 space-y-1">
            <p className="text-[11px] text-foreground/85 font-medium truncate">
              {status.email}
            </p>
            {status.lastSync && (
              <p className="text-[10px] text-muted-foreground">
                Last sync: {new Date(status.lastSync).toLocaleString()}
              </p>
            )}
            {status.needsReauth && (
              <p className="text-[10px] text-amber-400">
                Session expired — disconnect and reconnect.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="flex-1"
              disabled={syncing || !!status.needsReauth}
              onClick={() => void doSync()}
            >
              <RefreshCw className={syncing ? "animate-spin" : ""} />
              {syncing ? "Syncing…" : "Sync now"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void doDisconnect()}
              title="Disconnect"
            >
              <LogOut />
            </Button>
          </div>
        </div>
      ) : status.pending2FA ? (
        <div className="space-y-2">
          <p className="text-[10.5px] text-muted-foreground">
            Enter the 2FA code for <span className="font-medium text-foreground/85">{status.email}</span>
          </p>
          <Input
            autoComplete="off"
            placeholder="6-digit code"
            value={twofaCode}
            onChange={(e) => setTwofaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="font-mono text-[11px] text-center tracking-[0.25em]"
            maxLength={6}
          />
          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={busy || twofaCode.length < 6}
            onClick={() => void doSubmit2FA()}
          >
            {busy ? "Verifying…" : "Verify"}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Input
            autoComplete="off"
            placeholder="Ente account email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="text-[11px]"
          />
          <Input
            type="password"
            autoComplete="off"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="text-[11px]"
          />
          <button
            type="button"
            className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? "Hide" : "Show"} advanced
          </button>
          {showAdvanced && (
            <Input
              autoComplete="off"
              placeholder="Server URL (default: api.ente.io)"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              className="font-mono text-[10px]"
            />
          )}
          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={busy || !email.trim() || !password}
            onClick={() => void doLogin()}
          >
            {busy ? "Connecting…" : "Connect"}
          </Button>
        </div>
      )}

      {message && (
        <Alert variant={message.kind === "ok" ? "success" : "destructive"}>
          {message.text}
        </Alert>
      )}
    </div>
  );
}
