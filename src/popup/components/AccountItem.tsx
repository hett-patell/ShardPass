import { useEffect, useState } from "react";
import { Trash2, Check } from "lucide-react";
import type { AccountWithCode } from "@/lib/messages";
import { formatCode } from "@/lib/totp";
import { cn } from "@/lib/utils";

export function AccountItem({
  account,
  onDelete,
}: {
  account: AccountWithCode;
  onDelete: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(t);
  }, [copied]);

  const remaining = Math.max(0, account.remainingSeconds);
  const ratio = remaining / account.period;
  const urgent = remaining <= 5;

  async function copy() {
    try {
      await navigator.clipboard.writeText(account.code);
      setCopied(true);
    } catch {
      /* ignore */
    }
  }

  const initial = (account.issuer || account.label || "?")[0].toUpperCase();

  return (
    <button
      type="button"
      onClick={copy}
      className="group relative w-full overflow-hidden rounded-lg border border-border bg-card/40 px-3 py-2.5 text-left transition-colors hover:border-border/70 hover:bg-card/80"
    >
      <div className="flex items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-[12px] font-semibold text-foreground/85">
          {initial}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12.5px] font-medium text-foreground">
              {account.issuer || "Untitled"}
            </span>
            {copied && (
              <span className="flex items-center gap-0.5 text-[10px] font-medium text-emerald-400 animate-fade-in">
                <Check className="size-2.5" /> copied
              </span>
            )}
          </div>
          <div className="truncate text-[10.5px] text-muted-foreground">
            {account.label || "—"}
          </div>
        </div>

        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          {confirmDelete ? (
            <div
              className="flex items-center gap-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="rounded-md px-1.5 py-1 text-[10px] font-medium text-destructive transition-colors hover:bg-destructive/15"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDelete(false);
                }}
                className="rounded-md px-1.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-accent"
              >
                Keep
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDelete(true);
              }}
              title="Delete"
              className="grid size-6 place-items-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-destructive"
            >
              <Trash2 className="size-3" strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <div
          className={cn(
            "code-mono text-[20px] font-light",
            urgent ? "text-destructive" : "text-foreground",
          )}
        >
          {formatCode(account.code)}
        </div>

        <div className="flex items-center gap-1.5">
          <div className="h-[3px] w-12 overflow-hidden rounded-full bg-secondary">
            <div
              className={cn(
                "h-full rounded-full transition-[width]",
                urgent ? "bg-destructive" : "bg-foreground/70",
              )}
              style={{
                width: `${ratio * 100}%`,
                transitionDuration: "1000ms",
                transitionTimingFunction: "linear",
              }}
            />
          </div>
          <span
            className={cn(
              "text-[10px] tabular-nums",
              urgent ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {remaining}s
          </span>
        </div>
      </div>
    </button>
  );
}
