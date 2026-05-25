import { useEffect, useState } from "react";
import { Trash2, Check, Copy } from "lucide-react";
import type { AccountWithCode } from "@/lib/messages";
import { formatCode } from "@/lib/format";
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
    const t = setTimeout(() => setCopied(false), 1400);
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
      className="group relative w-full overflow-hidden rounded-2xl border border-white/[0.04] bg-white/[0.025] px-4 py-3.5 text-left transition-all hover:border-primary/20 hover:bg-white/[0.04] hover:shadow-[0_2px_16px_oklch(0.56_0.22_262/5%)] active:scale-[0.99]"
    >
      <div className="flex items-center gap-3.5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.04] text-[14px] font-semibold text-foreground/80 ring-1 ring-white/[0.06]">
          {initial}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-medium text-foreground/90">
              {account.issuer || "Untitled"}
            </span>
            {copied && (
              <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-primary animate-fade-in">
                <Check className="size-3" /> Copied
              </span>
            )}
          </div>
          <div className="truncate text-[12px] text-muted-foreground">
            {account.label || "—"}
          </div>
        </div>

        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {confirmDelete ? (
            <div
              className="flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-destructive transition-colors hover:bg-destructive/8"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDelete(false);
                }}
                className="rounded-lg px-2.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent"
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
              className="grid size-7 place-items-center rounded-lg text-muted-foreground/40 transition-colors hover:bg-accent hover:text-destructive"
            >
              <Trash2 className="size-3.5" strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div
          className={cn(
            "code-mono text-[26px] font-medium tracking-wider",
            urgent ? "text-destructive" : "text-foreground/95",
          )}
        >
          {formatCode(account.code)}
        </div>

        <div className="flex items-center gap-2.5">
          <div className="h-1 w-16 overflow-hidden rounded-full bg-white/[0.05]">
            <div
              className={cn(
                "h-full rounded-full transition-[width]",
                urgent
                  ? "bg-destructive shadow-[0_0_8px_oklch(0.54_0.16_18/40%)]"
                  : "bg-primary shadow-[0_0_8px_oklch(0.56_0.22_262/30%)]",
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
              "w-8 text-right text-[12px] tabular-nums font-medium",
              urgent ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {remaining}s
          </span>
        </div>
      </div>

      {!copied && (
        <div className="pointer-events-none absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100">
          <Copy className="size-3.5 text-muted-foreground/30" strokeWidth={1.5} />
        </div>
      )}
    </button>
  );
}
