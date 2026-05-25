import { useEffect, useMemo, useState } from "react";
import { Trash2, Check } from "lucide-react";
import type { AccountWithCode } from "@/lib/messages";
import { formatCode } from "@/lib/format";
import { cn } from "@/lib/utils";

const AVATAR_GRADIENTS = [
  ["oklch(0.62 0.18 280)", "oklch(0.48 0.20 300)"],
  ["oklch(0.62 0.16 240)", "oklch(0.48 0.20 260)"],
  ["oklch(0.60 0.14 180)", "oklch(0.45 0.12 200)"],
  ["oklch(0.62 0.15 50)",  "oklch(0.50 0.16 30)"],
  ["oklch(0.60 0.15 340)", "oklch(0.50 0.18 0)"],
  ["oklch(0.55 0.18 140)", "oklch(0.45 0.14 160)"],
  ["oklch(0.60 0.14 80)",  "oklch(0.50 0.12 100)"],
  ["oklch(0.58 0.16 200)", "oklch(0.44 0.18 220)"],
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

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

  const gradient = useMemo(() => {
    const key = account.issuer + "\x00" + account.label;
    return AVATAR_GRADIENTS[hashStr(key) % AVATAR_GRADIENTS.length];
  }, [account.issuer, account.label]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(account.code);
      setCopied(true);
    } catch {
      /* ignore */
    }
  }

  const initial = (account.issuer || account.label || "?")[0].toUpperCase();
  const name = account.issuer || "Untitled";

  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        "group relative w-full overflow-hidden pr-4 text-left transition-all duration-200 active:scale-[0.985]",
        "rounded-2xl",
        "bg-[oklch(0.18_0.015_265)]",
        "ring-1 ring-white/[0.04] ring-inset",
        "hover:ring-white/[0.08] hover:bg-[oklch(0.195_0.016_265)]",
        "hover:shadow-[0_4px_20px_oklch(0_0_0/35%)] hover:shadow-primary/5",
      )}
    >
      {/* Left accent bar — drains as time passes */}
      <div
        className="absolute left-0 top-0 h-full w-[3px] transition-all duration-1000 ease-linear"
        style={{ opacity: ratio * 0.85 + 0.15 }}
      >
        <div
          className={cn(
            "h-full w-full rounded-r-sm",
            urgent
              ? "bg-destructive"
              : "bg-primary",
          )}
        />
      </div>

      {/* Glow halo under the accent bar */}
      {ratio < 1 && (
        <div
          className={cn(
            "pointer-events-none absolute left-0 top-0 h-full w-8 rounded-r-full opacity-30 blur-md transition-all duration-1000 ease-linear",
            urgent ? "bg-destructive/40" : "bg-primary/30",
          )}
          style={{
            height: `${Math.max(ratio * 100, 4)}%`,
          }}
        />
      )}

      <div className="flex items-center gap-3.5 py-3.5 pl-4">
        <div
          className="flex size-9 shrink-0 items-center justify-center rounded-xl text-[13px] font-semibold text-white/90"
          style={{
            backgroundImage: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})`,
          }}
        >
          {initial}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold tracking-tight text-foreground/90">
              {name}
            </span>
            {copied && (
              <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-primary animate-fade-in">
                <Check className="size-3" /> Copied
              </span>
            )}
          </div>
          {account.label ? (
            <div className="mt-0.5 truncate text-[12px] text-muted-foreground/80">
              {account.label}
            </div>
          ) : null}
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
              className="grid size-7 place-items-center rounded-lg text-muted-foreground/30 transition-colors hover:bg-accent hover:text-destructive"
            >
              <Trash2 className="size-3.5" strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between pb-3.5 pl-4">
        <div
          className={cn(
            "code-mono font-medium transition-colors duration-200 text-[26px]",
            urgent ? "text-destructive" : "text-foreground/95",
            copied ? "tracking-[0.12em]" : "tracking-[0.06em]",
          )}
        >
          {formatCode(account.code)}
        </div>

        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "w-8 text-right tabular-nums font-medium text-[11px]",
              urgent ? "text-destructive/90" : "text-muted-foreground/70",
            )}
          >
            {remaining}s
          </span>
        </div>
      </div>
    </button>
  );
}
