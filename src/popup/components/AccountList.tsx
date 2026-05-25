import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Search,
  Settings,
  Lock,
  ArrowUpFromLine,
  ShieldCheck,
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
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={onClick} aria-label={label}>
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
    // Fetch the full account; AccountWithCode strips secret/algorithm/tags.
    // We only have the id, issuer, label, digits, period — but to edit we
    // need the full Account. For now we open the dialog and it will fetch.
    setEditTarget({
      id: account.id,
      issuer: account.issuer,
      label: account.label,
      secret: "", // dialog will not expose this for now
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
      <header className="flex shrink-0 items-center justify-between px-4 pb-3 pt-4">
        <div className="flex items-center gap-2">
          <div
            className="grid size-7 place-items-center rounded-md"
            style={{
              backgroundImage:
                "linear-gradient(135deg, oklch(0.68 0.14 285), oklch(0.50 0.18 295))",
              boxShadow:
                "inset 0 1px 0 oklch(1 0 0 / 14%), 0 1px 2px oklch(0 0 0 / 30%)",
            }}
          >
            <ShieldCheck className="size-3.5 text-white" strokeWidth={2} />
          </div>
          <span className="text-[14px] font-semibold tracking-tight text-foreground">
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
          <IconBtn label="Lock vault" onClick={() => void onLock()}>
            <Lock />
          </IconBtn>
        </div>
      </header>

      {/* ── Search ──────────────────────────────────── */}
      <div className="shrink-0 px-4 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/45" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="h-8 pl-8 pr-8 text-[13px]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground/55 hover:bg-[oklch(1_0_0/6%)] hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>

      {/* ── List body ───────────────────────────────── */}
      <main className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-4 pt-1 mask-fade-b">
        {filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            {accounts.length === 0 ? (
              <div className="animate-fade-in-scale">
                <div
                  className="mx-auto mb-4 grid size-12 place-items-center rounded-xl"
                  style={{
                    backgroundImage:
                      "linear-gradient(135deg, oklch(0.22 0.025 285), oklch(0.17 0.012 282))",
                    boxShadow: "inset 0 1px 0 oklch(1 0 0 / 6%)",
                  }}
                >
                  <ShieldCheck
                    className="size-6 text-foreground/35"
                    strokeWidth={1.6}
                  />
                </div>
                <p className="text-[14px] font-semibold text-foreground/85">
                  No accounts yet
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground/70">
                  Add your first TOTP account to get started.
                </p>
                <Button
                  size="sm"
                  className="mt-4"
                  onClick={() => setDialog("add")}
                >
                  <Plus className="size-3.5" />
                  Add account
                </Button>
              </div>
            ) : (
              <div className="animate-fade-in">
                <p className="text-[13px] text-muted-foreground/80">
                  No results
                </p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground/55">
                  No accounts matching &ldquo;{query}&rdquo;
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 animate-fade-in">
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

      {/* ── Footer count ────────────────────────────── */}
      {accounts.length > 0 && (
        <div className="shrink-0 border-t border-white/[0.04] px-4 py-2 text-center">
          <span className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground/55">
            {filtered.length === accounts.length
              ? `${accounts.length} account${accounts.length === 1 ? "" : "s"}`
              : `${filtered.length} of ${accounts.length}`}
          </span>
        </div>
      )}

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
