import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Search,
  Settings,
  Lock,
  ArrowUpFromLine,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { send } from "@/lib/messages";
import { log } from "@/lib/log";
import { openImportExportWindow } from "@/lib/detached";
import type { AccountWithCode } from "@/lib/messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AccountItem } from "./AccountItem";
import { AddAccountDialog } from "./AddAccountDialog";
import { SettingsMenu } from "./SettingsMenu";
import { ImportExportDialog } from "./ImportExportDialog";

type DialogKind = null | "add" | "io" | "settings";

function IconBtn({
  label,
  children,
  onClick,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function AccountList({ onLocked }: { onLocked: () => void }) {
  const [accounts, setAccounts] = useState<AccountWithCode[]>([]);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<DialogKind>(null);

  const refresh = useCallback(async () => {
    const res = await send<AccountWithCode[]>({ kind: "listAccounts" });
    if (res.ok) {
      log("list", `refresh got ${res.data.length} accounts`);
      setAccounts(res.data);
    } else {
      log("list", `refresh failed -> onLocked:`, res.error);
      onLocked();
    }
  }, [onLocked]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const id = window.setInterval(() => void refresh(), 1000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const filtered = useMemo(() => {
    if (!query.trim()) return accounts;
    const q = query.toLowerCase();
    return accounts.filter(
      (a) =>
        a.issuer.toLowerCase().includes(q) || a.label.toLowerCase().includes(q),
    );
  }, [accounts, query]);

  async function onLock() {
    await send({ kind: "lock" });
    onLocked();
  }

  async function onDelete(id: string) {
    const res = await send({ kind: "deleteAccount", id });
    if (res.ok) void refresh();
  }

  async function openIO() {
    const ok = await openImportExportWindow();
    if (ok) {
      window.close();
      return;
    }
    setDialog("io");
  }

  function showToast(msg: string) {
    toast(msg);
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* ── Header ───────────────────────────────────── */}
      <header className="flex items-center justify-between px-5 pb-4 pt-5">
        <div className="flex items-center gap-3">
          <div className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-[oklch(0.65_0.18_290)] to-[oklch(0.50_0.18_300)]">
            <ShieldCheck className="size-4 text-white" strokeWidth={1.75} />
          </div>
          <span className="text-[16px] font-bold tracking-tight text-foreground/90">
            ShardPass
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <IconBtn label="Add account" onClick={() => setDialog("add")}>
            <Plus />
          </IconBtn>
          <IconBtn label="Import / Export" onClick={() => void openIO()}>
            <ArrowUpFromLine />
          </IconBtn>
          <IconBtn label="Settings" onClick={() => setDialog("settings")}>
            <Settings />
          </IconBtn>
          <IconBtn label="Lock" onClick={() => void onLock()}>
            <Lock />
          </IconBtn>
        </div>
      </header>

      {/* ── Search ──────────────────────────────────── */}
      <div className="px-4 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/30" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search accounts…"
            className="h-10 pl-9"
          />
        </div>
      </div>

      {/* ── Account list ────────────────────────────── */}
      <main className="scrollbar-thin flex-1 overflow-y-auto px-4 pb-4 mask-fade-b">
        {filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            {accounts.length === 0 ? (
              <div className="animate-fade-in-scale">
                <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-[oklch(0.23_0.015_285)] to-[oklch(0.19_0.01_280)]">
                  <ShieldCheck className="size-7 text-foreground/30" strokeWidth={1.5} />
                </div>
                <p className="text-[16px] font-semibold text-foreground/70">
                  No accounts yet
                </p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground/60">
                  Add your first TOTP account to get started
                </p>
                <Button className="mt-5" onClick={() => setDialog("add")}>
                  <Plus className="size-4" />
                  Add account
                </Button>
              </div>
            ) : (
              <p className="animate-fade-in text-[14px] text-muted-foreground/60">
                No matches for &ldquo;{query}&rdquo;
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((acc) => (
              <AccountItem
                key={acc.id}
                account={acc}
                onDelete={() => void onDelete(acc.id)}
              />
            ))}
          </div>
        )}
      </main>

      {/* ── Dialogs ─────────────────────────────────── */}
      <AddAccountDialog
        open={dialog === "add"}
        onOpenChange={(o) => setDialog(o ? "add" : null)}
        onAdded={() => {
          setDialog(null);
          void refresh();
        }}
      />
      <ImportExportDialog
        open={dialog === "io"}
        onOpenChange={(o) => setDialog(o ? "io" : null)}
        onChanged={(msg) => {
          void refresh();
          setDialog(null);
          if (msg) showToast(msg);
        }}
      />
      <SettingsMenu
        open={dialog === "settings"}
        onOpenChange={(o) => setDialog(o ? "settings" : null)}
      />
    </div>
  );
}
