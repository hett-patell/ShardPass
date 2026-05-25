import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Clock,
  Info,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  RefreshCw,
  Shield,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { send } from "@/lib/messages";
import type { EnteStatus, IntegrationStatus } from "@/lib/messages";
import type { Settings } from "@/types";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
} from "@/components/ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

type View = "root" | "security" | "duck" | "ente" | "about";

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
  const [view, setView] = useState<View>("root");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      // Reset to root when dialog closes so reopen starts fresh
      const t = window.setTimeout(() => setView("root"), 200);
      return () => window.clearTimeout(t);
    }
    void send<Settings>({ kind: "getSettings" }).then((res) => {
      if (res.ok) setSettings(res.data);
    });
    void refreshIntegrations();
  }, [open]);

  async function refreshIntegrations() {
    const res = await send<IntegrationStatus>({ kind: "getIntegrationStatus" });
    if (res.ok) setIntegrations(res.data);
  }

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

  const title = {
    root: "Settings",
    security: "Security",
    duck: "DuckDuckGo Email",
    ente: "Ente Auth Sync",
    about: "About",
  }[view];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className={cn(
            "absolute bottom-0 left-0 right-0 z-50 max-h-[90%] overflow-hidden",
            "rounded-t-2xl bg-popover",
            "shadow-[0_-8px_32px_oklch(0_0_0/55%),0_-1px_0_0_oklch(1_0_0/6%)]",
            "data-[state=open]:animate-[content-in_240ms_cubic-bezier(0.16,1,0.3,1)]",
            "data-[state=closed]:animate-[content-out_140ms_ease-in]",
            "outline-none flex flex-col",
          )}
        >
          {/* Header */}
          <div className="relative flex shrink-0 items-center gap-2 border-b border-white/[0.05] px-4 py-3">
            {view !== "root" ? (
              <button
                type="button"
                onClick={() => setView("root")}
                className="grid size-7 place-items-center rounded-md text-muted-foreground/80 transition-colors hover:bg-[oklch(1_0_0/6%)] hover:text-foreground"
                aria-label="Back"
              >
                <ArrowLeft className="size-3.5" />
              </button>
            ) : (
              <div className="size-7" />
            )}
            <DialogPrimitive.Title
              className={cn(
                "absolute left-1/2 -translate-x-1/2 text-[13.5px] font-semibold tracking-tight",
                "transition-all duration-200",
              )}
            >
              {title}
            </DialogPrimitive.Title>
            <div className="ml-auto">
              <DialogPrimitive.Close
                className="grid size-7 place-items-center rounded-md text-muted-foreground/80 transition-colors hover:bg-[oklch(1_0_0/6%)] hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Close"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5">
                  <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                </svg>
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* Body — view router */}
          <div className="scrollbar-thin flex-1 overflow-y-auto">
            {view === "root" && (
              <RootView
                settings={settings}
                integrations={integrations}
                busy={busy}
                onChangeAutoLock={updateAutoLock}
                onChangeScreenLock={updateScreenLock}
                onNavigate={setView}
              />
            )}
            {view === "security" && <SecurityView />}
            {view === "duck" && (
              <DuckView
                connected={integrations?.duckduckgoConfigured ?? false}
                onChange={() => void refreshIntegrations()}
              />
            )}
            {view === "ente" && (
              <EnteView onChange={() => void refreshIntegrations()} />
            )}
            {view === "about" && <AboutView />}
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

/* ── Root View — list of settings categories ─────────────────── */

function RootView({
  settings,
  integrations,
  busy,
  onChangeAutoLock,
  onChangeScreenLock,
  onNavigate,
}: {
  settings: Settings | null;
  integrations: IntegrationStatus | null;
  busy: boolean;
  onChangeAutoLock: (m: number) => void;
  onChangeScreenLock: (v: boolean) => void;
  onNavigate: (view: View) => void;
}) {
  const duckConnected = integrations?.duckduckgoConfigured ?? false;
  const enteConnected = integrations?.ente.connected ?? false;

  return (
    <div className="animate-fade-in p-4 space-y-5">
      {/* Inline general settings */}
      <Section title="General">
        <SettingRow
          icon={<Lock className="size-3.5" />}
          title="Lock on screen lock"
          description="Auto-lock when your OS screen locks"
          trailing={
            <Switch
              disabled={!settings || busy}
              checked={settings?.lockOnScreenLock ?? true}
              onCheckedChange={onChangeScreenLock}
            />
          }
        />
        <SettingRow
          icon={<Clock className="size-3.5" />}
          title="Auto-lock timer"
          description="Lock after inactivity"
          trailing={
            <Select
              disabled={!settings || busy}
              value={String(settings?.autoLockMinutes ?? 0)}
              onValueChange={(v) => onChangeAutoLock(Number(v))}
            >
              <SelectTrigger className="h-7 w-[110px] text-[12px]">
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
          }
        />
      </Section>

      {/* Navigation rows */}
      <Section title="Security">
        <NavRow
          icon={<KeyRound className="size-3.5" />}
          title="Master password"
          description="Change your master password"
          onClick={() => onNavigate("security")}
        />
      </Section>

      <Section title="Integrations">
        <NavRow
          icon={<Mail className="size-3.5" />}
          title="DuckDuckGo Email"
          description="Generate @duck.com aliases"
          trailing={
            duckConnected ? (
              <Badge variant="success">
                <Check /> Connected
              </Badge>
            ) : undefined
          }
          onClick={() => onNavigate("duck")}
        />
        <NavRow
          icon={<Shield className="size-3.5" />}
          title="Ente Auth Sync"
          description="Sync TOTP with Ente"
          trailing={
            enteConnected ? (
              <Badge variant="success">
                <Check /> Synced
              </Badge>
            ) : undefined
          }
          onClick={() => onNavigate("ente")}
        />
      </Section>

      <Section title="About">
        <NavRow
          icon={<Info className="size-3.5" />}
          title="About ShardPass"
          description="Version & cryptography"
          onClick={() => onNavigate("about")}
        />
      </Section>
    </div>
  );
}

/* ── Layout helpers ──────────────────────────────────────────── */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="label-caps mb-1.5 px-1">{title}</h3>
      <div className="overflow-hidden rounded-lg border border-white/[0.06] bg-[oklch(1_0_0/2%)] divide-y divide-white/[0.04]">
        {children}
      </div>
    </div>
  );
}

function SettingRow({
  icon,
  title,
  description,
  trailing,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      {icon && (
        <div className="grid size-7 shrink-0 place-items-center rounded-md bg-[oklch(1_0_0/4%)] text-muted-foreground">
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium leading-tight text-foreground">
          {title}
        </div>
        {description && (
          <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground/75">
            {description}
          </div>
        )}
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </div>
  );
}

function NavRow({
  icon,
  title,
  description,
  trailing,
  onClick,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  trailing?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none",
        "transition-colors hover:bg-[oklch(1_0_0/3%)]",
        "focus-visible:bg-[oklch(1_0_0/4%)]",
      )}
    >
      {icon && (
        <div className="grid size-7 shrink-0 place-items-center rounded-md bg-[oklch(1_0_0/4%)] text-muted-foreground group-hover:text-foreground transition-colors">
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium leading-tight text-foreground">
          {title}
        </div>
        {description && (
          <div className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground/75">
            {description}
          </div>
        )}
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/45 group-hover:text-muted-foreground/80 transition-colors" />
    </button>
  );
}

/* ── Security View — change master password ──────────────────── */

function SecurityView() {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);

  function reset() {
    setOldPassword("");
    setNewPassword("");
    setConfirm("");
  }

  async function doChange() {
    setMessage(null);
    if (!oldPassword) {
      setMessage({ kind: "err", text: "Enter your current password." });
      return;
    }
    if (newPassword.length < 12) {
      setMessage({
        kind: "err",
        text: "New password must be at least 12 characters.",
      });
      return;
    }
    if (newPassword !== confirm) {
      setMessage({ kind: "err", text: "New passwords do not match." });
      return;
    }
    setBusy(true);
    const res = await send({
      kind: "changePassword",
      oldPassword,
      newPassword,
    });
    setBusy(false);
    if (!res.ok) {
      setMessage({ kind: "err", text: res.error });
      return;
    }
    setMessage({ kind: "ok", text: "Password changed." });
    reset();
  }

  return (
    <div className="animate-slide-in-right p-4 space-y-4">
      <div className="space-y-1.5">
        <h2 className="text-[14px] font-semibold tracking-tight">
          Change master password
        </h2>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          Re-encrypts the vault with a new key derived from the new password.
          You'll stay logged in.
        </p>
      </div>

      <div className="space-y-2.5">
        <div className="space-y-1.5">
          <Label>Current password</Label>
          <Input
            type="password"
            autoComplete="off"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            placeholder="Current master password"
          />
        </div>
        <div className="space-y-1.5">
          <Label>New password</Label>
          <Input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="At least 12 characters"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Confirm new password</Label>
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Re-enter new password"
          />
        </div>

        <Button
          type="button"
          className="w-full"
          disabled={busy || !oldPassword || !newPassword || !confirm}
          onClick={() => void doChange()}
        >
          {busy ? "Changing…" : "Change password"}
        </Button>

        {message && (
          <Alert variant={message.kind === "ok" ? "success" : "destructive"}>
            {message.text}
          </Alert>
        )}
      </div>
    </div>
  );
}

/* ── Duck View — DuckDuckGo Email integration ────────────────── */

function DuckView({
  connected,
  onChange,
}: {
  connected: boolean;
  onChange: () => void;
}) {
  const [tokenInput, setTokenInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);

  async function saveToken() {
    const token = tokenInput.trim();
    if (!token) {
      setMessage({ kind: "err", text: "Paste your bearer token." });
      return;
    }
    setBusy(true);
    setMessage(null);
    const res = await send({ kind: "setDuckToken", token });
    setBusy(false);
    if (!res.ok) {
      setMessage({ kind: "err", text: res.error });
      return;
    }
    setTokenInput("");
    setMessage({ kind: "ok", text: "Token saved." });
    onChange();
  }

  async function clearToken() {
    setBusy(true);
    setMessage(null);
    const res = await send({ kind: "clearDuckToken" });
    setBusy(false);
    if (!res.ok) {
      setMessage({ kind: "err", text: res.error });
      return;
    }
    setMessage({ kind: "ok", text: "Disconnected." });
    onChange();
  }

  async function generateAndCopy() {
    setBusy(true);
    setMessage(null);
    const res = await send<{ alias: string }>({ kind: "generateDuckAlias" });
    setBusy(false);
    if (!res.ok) {
      setMessage({ kind: "err", text: res.error });
      return;
    }
    try {
      await navigator.clipboard.writeText(res.data.alias);
    } catch {
      /* ignore */
    }
    setMessage({ kind: "ok", text: `${res.data.alias} — copied` });
  }

  return (
    <div className="animate-slide-in-right p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[14px] font-semibold tracking-tight">
          DuckDuckGo Email Protection
        </h2>
        {connected && (
          <Badge variant="success">
            <Check /> Connected
          </Badge>
        )}
      </div>
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        Generate <span className="font-mono">@duck.com</span> aliases when
        adding accounts. Your token is stored inside the encrypted vault.
      </p>

      {connected ? (
        <div className="space-y-2">
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={busy}
            onClick={() => void generateAndCopy()}
          >
            <Sparkles />
            {busy ? "Generating…" : "Generate alias"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={busy}
            onClick={() => void clearToken()}
          >
            <Trash2 />
            Disconnect
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="space-y-1.5">
            <Label>Bearer token</Label>
            <Input
              type="password"
              autoComplete="off"
              placeholder="Paste your token"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              className="font-mono"
            />
          </div>
          <Button
            type="button"
            className="w-full"
            disabled={busy || !tokenInput.trim()}
            onClick={() => void saveToken()}
          >
            {busy ? "Saving…" : "Connect"}
          </Button>
          <Alert variant="info">
            Get your token at{" "}
            <a
              href="https://duckduckgo.com/email/settings/autofill"
              target="_blank"
              rel="noreferrer"
              className="text-foreground/85 underline-offset-2 hover:underline"
            >
              duckduckgo.com/email/settings/autofill
            </a>
            . Open DevTools → Network → click "Generate Private Duck Address"
            and copy the <span className="font-mono">Authorization</span>{" "}
            bearer token.
          </Alert>
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

/* ── Ente View — Ente Auth sync ──────────────────────────────── */

function EnteView({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = useState<EnteStatus | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [twofaCode, setTwofaCode] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    void send<IntegrationStatus>({ kind: "getIntegrationStatus" }).then(
      (res) => {
        if (res.ok) setStatus(res.data.ente);
      },
    );
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
      setMessage({
        kind: "err",
        text: `Connected but sync failed: ${res.data.syncError}`,
      });
    } else {
      setMessage({ kind: "ok", text: "Connected and synced." });
    }
    onChange();
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
      setMessage({
        kind: "err",
        text: `Connected but sync failed: ${res.data.syncError}`,
      });
    } else {
      setMessage({ kind: "ok", text: "Connected and synced." });
    }
    onChange();
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
    onChange();
  }

  if (!status) {
    return (
      <div className="p-4">
        <div className="text-[12px] text-muted-foreground/70">Loading…</div>
      </div>
    );
  }

  return (
    <div className="animate-slide-in-right p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[14px] font-semibold tracking-tight">
          Ente Auth Sync
        </h2>
        {status.connected && (
          <Badge variant="success">
            <Check /> Synced
          </Badge>
        )}
      </div>
      <p className="text-[12px] leading-relaxed text-muted-foreground">
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
        <div className="space-y-3">
          <div className="rounded-lg border border-white/[0.06] bg-[oklch(1_0_0/2%)] px-3 py-2.5 space-y-1">
            <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground/70">
              Account
            </div>
            <p className="truncate text-[13px] font-medium text-foreground">
              {status.email}
            </p>
            {status.lastSync && (
              <p className="text-[11px] text-muted-foreground">
                Last sync: {new Date(status.lastSync).toLocaleString()}
              </p>
            )}
            {status.needsReauth && (
              <Alert variant="warning" className="mt-2">
                Session expired — disconnect and reconnect.
              </Alert>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={syncing || !!status.needsReauth}
              onClick={() => void doSync()}
            >
              <RefreshCw className={syncing ? "animate-spin" : ""} />
              {syncing ? "Syncing…" : "Sync now"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => void doDisconnect()}
            >
              <LogOut />
              Disconnect
            </Button>
          </div>
        </div>
      ) : status.pending2FA ? (
        <div className="space-y-2.5">
          <p className="text-[12px] text-muted-foreground">
            Enter the 2FA code for{" "}
            <span className="font-medium text-foreground/85">
              {status.email}
            </span>
          </p>
          <div className="space-y-1.5">
            <Label>2FA Code</Label>
            <Input
              autoComplete="off"
              placeholder="000000"
              value={twofaCode}
              onChange={(e) =>
                setTwofaCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              className="code-mono text-center text-[15px] tracking-[0.3em]"
              maxLength={6}
            />
          </div>
          <Button
            type="button"
            className="w-full"
            disabled={busy || twofaCode.length < 6}
            onClick={() => void doSubmit2FA()}
          >
            {busy ? "Verifying…" : "Verify"}
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input
              autoComplete="off"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Password</Label>
            <Input
              type="password"
              autoComplete="off"
              placeholder="Your Ente password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? "Hide" : "Show"} advanced
          </button>
          {showAdvanced && (
            <div className="space-y-1.5 animate-fade-in">
              <Label>Server URL</Label>
              <Input
                autoComplete="off"
                placeholder="api.ente.io"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                className="font-mono"
              />
            </div>
          )}
          <Button
            type="button"
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

/* ── About View ──────────────────────────────────────────────── */

function AboutView() {
  return (
    <div className="animate-slide-in-right p-4 space-y-5">
      <div className="flex flex-col items-center text-center pt-4">
        <div
          className="mb-3 grid size-12 place-items-center rounded-xl"
          style={{
            backgroundImage:
              "linear-gradient(135deg, oklch(0.68 0.14 285), oklch(0.50 0.18 295))",
            boxShadow:
              "inset 0 1px 0 oklch(1 0 0 / 18%), 0 4px 16px oklch(0.50 0.18 295 / 30%)",
          }}
        >
          <ShieldCheck className="size-6 text-white" strokeWidth={1.75} />
        </div>
        <h2 className="text-[16px] font-semibold tracking-tight">ShardPass</h2>
        <p className="mt-0.5 text-[11.5px] text-muted-foreground/70 tracking-[0.02em]">
          Minimal TOTP authenticator
        </p>
      </div>

      <div className="space-y-3">
        <Section title="Cryptography">
          <SettingRow
            title="Vault encryption"
            description="AES-256-GCM (authenticated encryption)"
          />
          <SettingRow
            title="Key derivation"
            description="PBKDF2 · 250,000 iterations · SHA-256"
          />
          <SettingRow
            title="Identifier hash"
            description="SHA-256"
          />
        </Section>

        <Section title="Storage">
          <SettingRow
            title="Local only"
            description="Vault never leaves this device"
          />
        </Section>
      </div>
    </div>
  );
}


