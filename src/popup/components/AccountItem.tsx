import { useEffect, useMemo, useState } from "react";
import { Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { AccountWithCode } from "@/lib/messages";
import { formatCode } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const AVATAR_GRADIENTS = [
  ["oklch(0.62 0.18 285)", "oklch(0.48 0.20 300)"], // violet
  ["oklch(0.62 0.16 240)", "oklch(0.48 0.20 260)"], // indigo
  ["oklch(0.60 0.14 180)", "oklch(0.45 0.12 200)"], // teal
  ["oklch(0.62 0.15 50)",  "oklch(0.50 0.16 30)"],  // orange
  ["oklch(0.60 0.15 340)", "oklch(0.50 0.18 0)"],   // magenta→red
  ["oklch(0.55 0.18 140)", "oklch(0.45 0.14 160)"], // green
  ["oklch(0.60 0.14 80)",  "oklch(0.50 0.12 100)"], // gold
  ["oklch(0.58 0.16 200)", "oklch(0.44 0.18 220)"], // cyan
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function AccountItem({
  account,
  onDelete,
  onEdit,
}: {
  account: AccountWithCode;
  onDelete: () => void;
  onEdit?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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

  async function copy(silent = false) {
    try {
      await navigator.clipboard.writeText(account.code);
      setCopied(true);
      if (!silent) toast.success("Code copied", { duration: 1600 });
    } catch {
      if (!silent) toast.error("Couldn't copy to clipboard");
    }
  }

  const initial = (account.issuer || account.label || "?")[0].toUpperCase();
  const name = account.issuer || "Untitled";

  // Timer ring geometry — 14px radius circle, stroke 2
  const RADIUS = 11;
  const CIRC = 2 * Math.PI * RADIUS;
  const dashOffset = CIRC * (1 - ratio);

  return (
    <div
      className={cn(
        "group relative flex items-center gap-3 rounded-lg",
        "bg-card border border-white/[0.05]",
        "transition-[background,border-color] duration-150",
        "hover:bg-[oklch(0.185_0.01_283)] hover:border-white/[0.09]",
        menuOpen && "bg-[oklch(0.185_0.01_283)] border-white/[0.09]",
      )}
    >
      {/* ── Clickable copy region ─────────────────────── */}
      <button
        type="button"
        onClick={() => void copy()}
        className="flex flex-1 min-w-0 items-center gap-3 py-2.5 pl-3 pr-1.5 text-left outline-none rounded-l-lg focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-inset"
        title="Click to copy"
      >
        {/* Avatar */}
        <div
          className="grid size-8 shrink-0 place-items-center rounded-md text-[12.5px] font-semibold text-white/95"
          style={{
            backgroundImage: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})`,
            boxShadow:
              "inset 0 1px 0 oklch(1 0 0 / 12%), 0 1px 2px oklch(0 0 0 / 25%)",
          }}
        >
          {initial}
        </div>

        {/* Name + label */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold leading-tight text-foreground/95 tracking-tight">
            {name}
          </div>
          {account.label ? (
            <div className="mt-0.5 truncate text-[11.5px] leading-tight text-muted-foreground/75">
              {account.label}
            </div>
          ) : (
            <div className="mt-0.5 truncate text-[11.5px] leading-tight text-muted-foreground/45">
              {account.digits} digits · {account.period}s
            </div>
          )}
        </div>

        {/* Code + timer ring */}
        <div className="flex shrink-0 items-center gap-2.5">
          <div
            className={cn(
              "code-mono text-[16px] font-medium leading-none transition-colors duration-150",
              urgent ? "text-[oklch(0.78_0.16_22)]" : "text-foreground/95",
              copied && "text-primary",
            )}
            aria-label={`Code ${account.code}`}
          >
            {formatCode(account.code)}
          </div>

          {/* Circular timer ring with seconds in center */}
          <div
            className="relative grid size-7 shrink-0 place-items-center"
            aria-label={`${remaining} seconds remaining`}
          >
            <svg
              className="absolute inset-0 -rotate-90"
              viewBox="0 0 28 28"
              width="28"
              height="28"
            >
              <circle
                cx="14"
                cy="14"
                r={RADIUS}
                fill="none"
                stroke="oklch(1 0 0 / 7%)"
                strokeWidth="2"
              />
              <circle
                cx="14"
                cy="14"
                r={RADIUS}
                fill="none"
                stroke={
                  urgent ? "oklch(0.7 0.18 25)" : "oklch(0.72 0.14 285)"
                }
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={CIRC}
                strokeDashoffset={dashOffset}
                style={{
                  transition: "stroke-dashoffset 1s linear, stroke 200ms",
                }}
              />
            </svg>
            <span
              className={cn(
                "tnums relative text-[9.5px] font-semibold leading-none",
                urgent ? "text-[oklch(0.78_0.16_22)]" : "text-muted-foreground",
              )}
            >
              {remaining}
            </span>
          </div>
        </div>
      </button>

      {/* ── Overflow menu ────────────────────────────── */}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More actions"
            className={cn(
              "mr-1.5 grid size-7 shrink-0 place-items-center rounded-md outline-none transition-[opacity,background,color] duration-150",
              "text-muted-foreground/55 hover:bg-[oklch(1_0_0/6%)] hover:text-foreground",
              "focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
              "data-[state=open]:bg-[oklch(1_0_0/6%)] data-[state=open]:text-foreground data-[state=open]:opacity-100",
              "opacity-0 group-hover:opacity-100",
            )}
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={4}>
          <DropdownMenuItem onSelect={() => void copy()}>
            <Copy /> Copy code
          </DropdownMenuItem>
          {onEdit && (
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> Edit
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
