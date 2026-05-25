import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Search,
  Settings,
  Lock,
  ArrowUpFromLine,
  ShieldCheck,
} from "lucide-react";
import { send } from "@/lib/messages";
import { log } from "@/lib/log";
import { openImportExportWindow } from "@/lib/detached";
import type { AccountWithCode } from "@/lib/messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AccountItem } from "./AccountItem";
import { AddAccountDialog } from "./AddAccountDialog";
import { SettingsMenu } from "./SettingsMenu";
import { ImportExportDialog } from "./ImportExportDialog";

type DialogKind = null | "add" | "io" | "settings";

export function AccountList({ onLocked }: { onLocked: () => void }) {
  const [accounts, setAccounts] = useState<AccountWithCode[]>([]);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [toast, setToast] = useState<string | null>(null);

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
    const id = window.setInterval(() => {
      void refresh();
    }, 1000);
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

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  }

  async function openIO() {
    const ok = await openImportExportWindow();
    if (ok) {
      window.close();
      return;
    }
    setDialog("io");
  }

  return (
    <div className="relative flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-white/[0.04] px-5 pb-3.5 pt-5">
        <div className="flex items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-xl bg-white/[0.04] ring-1 ring-white/[0.06]">
            <ShieldCheck className="size-4 text-foreground/60" strokeWidth={1.5} />
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-foreground/85">
            ShardPass
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon-sm" title="Add account" onClick={() => setDialog("add")}>
            <Plus />
          </Button>
          <Button variant="ghost" size="icon-sm" title="Import / Export" onClick={() => void openIO()}>
            <ArrowUpFromLine />
          </Button>
          <Button variant="ghost" size="icon-sm" title="Settings" onClick={() => setDialog("settings")}>
            <Settings />
          </Button>
          <Button variant="ghost" size="icon-sm" title="Lock" onClick={() => void onLock()}>
            <Lock />
          </Button>
        </div>
      </header>

      <div className="px-4 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/40" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search accounts…"
            className="h-10 pl-9"
          />
        </div>
      </div>

      <main className="scrollbar-thin flex-1 overflow-y-auto px-4 pb-4">
        {filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            {accounts.length === 0 ? (
              <div className="animate-fade-in">
                <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.05]">
                  <ShieldCheck className="size-6 text-muted-foreground/40" strokeWidth={1.5} />
                </div>
                <p className="text-[15px] font-medium text-foreground/60">
                  No accounts yet
                </p>
                <p className="mt-1.5 text-[13px] text-muted-foreground/60">
                  Add your first TOTP account to get started
                </p>
                <Button size="sm" className="mt-4" onClick={() => setDialog("add")}>
                  <Plus className="size-4" />
                  Add account
                </Button>
              </div>
            ) : (
              <p className="text-[14px] text-muted-foreground/60">
                No matches for "{query}"
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

      {toast && (
        <div className="absolute bottom-4 left-4 right-4 z-50 rounded-2xl border border-emerald-500/10 bg-emerald-500/4 backdrop-blur-md px-4 py-3 text-[13px] text-emerald-300 animate-slide-up shadow-[0_4px_20px_oklch(0_0_0/50%)]">
          <div className="flex items-center gap-2.5">
            <div className="size-1.5 rounded-full bg-emerald-400/50" />
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}
