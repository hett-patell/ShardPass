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

  return (
    <div className="relative flex h-full flex-col">
      <header className="flex items-center justify-between px-4 pb-2 pt-3.5">
        <div className="flex items-center gap-2">
          <div className="grid size-6 place-items-center rounded-md bg-secondary">
            <ShieldCheck
              className="size-3.5 text-foreground/85"
              strokeWidth={1.75}
            />
          </div>
          <span className="text-[13px] font-semibold tracking-tight">
            ShardPass
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            title="Add account"
            onClick={() => setDialog("add")}
          >
            <Plus />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Import / Export"
            onClick={() => setDialog("io")}
          >
            <ArrowUpFromLine />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Settings"
            onClick={() => setDialog("settings")}
          >
            <Settings />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Lock"
            onClick={() => void onLock()}
          >
            <Lock />
          </Button>
        </div>
      </header>

      <div className="px-4 pb-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="h-8 pl-8"
          />
        </div>
      </div>

      <main className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-3">
        {filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            {accounts.length === 0 ? (
              <div className="animate-fade-in">
                <div className="mx-auto mb-3 grid size-10 place-items-center rounded-lg bg-secondary">
                  <ShieldCheck
                    className="size-4 text-muted-foreground"
                    strokeWidth={1.5}
                  />
                </div>
                <p className="text-[11.5px] text-muted-foreground">
                  No accounts yet
                </p>
                <Button
                  size="sm"
                  className="mt-3"
                  onClick={() => setDialog("add")}
                >
                  Add first account
                </Button>
              </div>
            ) : (
              <p className="text-[11.5px] text-muted-foreground/80">
                No matches
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
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
        <div className="absolute bottom-3 left-3 right-3 z-50 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[11.5px] text-emerald-300 backdrop-blur animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}
