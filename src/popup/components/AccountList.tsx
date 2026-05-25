import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Settings,
  Lock,
  ArrowUpFromLine,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { send } from "@/lib/messages";
import { log } from "@/lib/log";
import { openImportExportWindow } from "@/lib/detached";
import type { AccountWithCode } from "@/lib/messages";
import type { Account } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AccountItem } from "./AccountItem";
import { AddAccountDialog } from "./AddAccountDialog";
import { EditAccountDialog } from "./EditAccountDialog";
import { SettingsMenu } from "./SettingsMenu";
import { ImportExportDialog } from "./ImportExportDialog";

type DialogKind = null | "add" | "io" | "settings" | "edit";

function IconBtn({
  label,
  children,
  onClick,
  primary = false,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={primary ? "default" : "secondary"}
          size="icon-sm"
          onClick={onClick}
          aria-label={label}
        >
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
  const [editTarget, setEditTarget] = useState<Account | null>(null);

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

  function requestDelete(account: AccountWithCode) {
    toast(`Delete ${account.issuer || account.label || "account"}?`, {
      description: "This cannot be undone.",
      action: {
        label: "Delete",
        onClick: async () => {
          const res = await send({ kind: "deleteAccount", id: account.id });
          if (res.ok) {
            void refresh();
            toast.success("Account deleted");
          } else {
            toast.error("Couldn't delete");
          }
        },
      },
      cancel: {
        label: "Cancel",
        onClick: () => undefined,
      },
      duration: 6000,
    });
  }

  function requestEdit(account: AccountWithCode) {
    setEditTarget({
      id: account.id,
      issuer: account.issuer,
      label: account.label,
      secret: "",
      algorithm: "SHA1",
      digits: account.digits,
      period: account.period,
      tags: [],
      createdAt: 0,
    } as Account);
    setDialog("edit");
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
      {/* ── Header ───────────────────────────────────── */}
      <header className="flex shrink-0 items-center gap-2 border-b border-border-soft px-4 pt-4 pb-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div
            className="grid size-6 place-items-center rounded-[2px] bg-primary text-primary-foreground"
            aria-hidden
          >
            <span className="text-[13px] font-bold leading-none tracking-[-0.04em]">
              S
            </span>
          </div>
          <span className="text-[14.5px] font-semibold leading-none tracking-[-0.02em] text-foreground">
            ShardPass
          </span>
        </div>
        <span className="code-mono text-[10.5px] text-muted-foreground">
          <span className="text-foreground font-medium">
            {accounts.length}
          </span>
          {" / "}
          {accounts.length}
        </span>
      </header>

      {/* ── Action bar ──────────────────────────────── */}
      <div className="shrink-0 border-b border-border-soft px-4 py-3 flex gap-1.5">
        <Button
          variant="default"
          size="sm"
          className="flex-1"
          onClick={() => setDialog("add")}
        >
          <Plus /> New
        </Button>
        <IconBtn label="Import / Export" onClick={() => void openIO()}>
          <ArrowUpFromLine />
        </IconBtn>
        <IconBtn label="Settings" onClick={() => setDialog("settings")}>
          <Settings />
        </IconBtn>
        <IconBtn label="Lock vault" onClick={() => void onLock()}>
          <Lock />
        </IconBtn>
      </div>

      {/* ── Search ──────────────────────────────────── */}
      <div className="shrink-0 px-4 pt-3 pb-2">
        <div className="relative">
          <span
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-1.5 rounded-full bg-primary"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search accounts"
            className="h-8 pl-6 pr-7 text-[12.5px]"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 grid size-4 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground/55 hover:bg-card hover:text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary"
              aria-label="Clear search"
            >
              <X className="size-3" />
            </button>
          ) : (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 code-mono text-[9.5px] text-muted-foreground/55 border border-border-soft px-1 py-px rounded-[2px]">
              ⌘K
            </span>
          )}
        </div>
      </div>

      {/* ── Section header ──────────────────────────── */}
      <div className="shrink-0 px-4 pt-3 pb-1 flex items-baseline justify-between">
        <span className="label-caps">Accounts</span>
        <span className="code-mono text-[10px] text-muted-foreground/85 flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-success" aria-hidden />
          Unlocked
        </span>
      </div>

      {/* ── List body ───────────────────────────────── */}
      <main className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-2 mask-fade-b">
        {filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            {accounts.length === 0 ? (
              <div className="animate-fade-in-scale">
                <div
                  className="mx-auto mb-3 grid size-10 place-items-center rounded-sm border border-border bg-card"
                  aria-hidden
                >
                  <Lock
                    className="size-4 text-muted-foreground"
                    strokeWidth={1.5}
                  />
                </div>
                <p className="text-[13px] font-semibold tracking-[-0.015em] text-foreground">
                  No accounts yet
                </p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                  Add your first TOTP account to get started.
                </p>
                <Button
                  size="sm"
                  className="mt-3"
                  onClick={() => setDialog("add")}
                >
                  <Plus />
                  New account
                </Button>
              </div>
            ) : (
              <div className="animate-fade-in">
                <p className="text-[12.5px] text-muted-foreground">
                  No results
                </p>
                <p className="mt-0.5 code-mono text-[10.5px] text-muted-foreground/70">
                  No accounts matching "{query}"
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="animate-fade-in">
            {filtered.map((acc) => (
              <AccountItem
                key={acc.id}
                account={acc}
                onDelete={() => requestDelete(acc)}
                onEdit={() => requestEdit(acc)}
              />
            ))}
          </div>
        )}
      </main>

      {/* ── Footer ──────────────────────────────────── */}
      <div className="shrink-0 flex items-center justify-between border-t border-border-soft px-4 py-2 code-mono text-[10px] text-muted-foreground/70">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-success" aria-hidden />
          AES-256-GCM
        </span>
        <span>
          {filtered.length === accounts.length
            ? `${accounts.length} account${accounts.length === 1 ? "" : "s"}`
            : `${filtered.length} of ${accounts.length}`}
        </span>
      </div>

      {/* ── Dialogs ─────────────────────────────────── */}
      <AddAccountDialog
        open={dialog === "add"}
        onOpenChange={(o) => setDialog(o ? "add" : null)}
        onAdded={() => {
          setDialog(null);
          void refresh();
          toast.success("Account added");
        }}
      />
      <EditAccountDialog
        open={dialog === "edit"}
        account={editTarget}
        onOpenChange={(o) => {
          if (!o) {
            setDialog(null);
            setEditTarget(null);
          }
        }}
        onSaved={() => {
          setDialog(null);
          setEditTarget(null);
          void refresh();
          toast.success("Account updated");
        }}
      />
      <ImportExportDialog
        open={dialog === "io"}
        onOpenChange={(o) => setDialog(o ? "io" : null)}
        onChanged={(msg) => {
          void refresh();
          setDialog(null);
          if (msg) toast.success(msg);
        }}
      />
      <SettingsMenu
        open={dialog === "settings"}
        onOpenChange={(o) => setDialog(o ? "settings" : null)}
      />
    </div>
  );
}
