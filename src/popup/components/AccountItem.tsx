import { useEffect, useMemo, useState } from "react";
import { Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { send, type AccountWithCode } from "@/lib/messages";
import { formatCode } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* Per-service dot color — distinct without iconography.
 * Restrained palette (low saturation), tied to known brand hues. */
const DOT_PALETTE = [
  "#e4e4e7", // github / generic light
  "#0070f3", // vercel blue
  "#ffba07", // cloudflare / amber
  "#ff9900", // aws orange
  "#5865f2", // discord indigo
  "#8a5cf5", // proton purple
  "#26d971", // microsoft / google-ish greens
  "#f471b5", // pink (rose-ish)
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
    const t = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(t);
  }, [copied]);

  const remaining = Math.max(0, account.remainingSeconds);
  const ratio = remaining / account.period;
  const urgent = remaining <= 5;
  const percent = Math.max(0, Math.min(100, ratio * 100));

  const dotColor = useMemo(() => {
    const key = (account.issuer || account.label || "?").toLowerCase();
    return DOT_PALETTE[hashStr(key) % DOT_PALETTE.length];
  }, [account.issuer, account.label]);

  async function copy(silent = false) {
    try {
      await navigator.clipboard.writeText(account.code);
      setCopied(true);
      if (!silent) toast.success("Code copied", { duration: 1600 });
      // Increment HOTP counter after use so next code generation advances
      if (account.type === "hotp") {
        void send({ kind: "incrementHotpCounter", id: account.id });
      }
    } catch {
      if (!silent) toast.error("Couldn't copy to clipboard");
    }
  }

  const name = account.issuer || "Untitled";
  const sub = account.label || `${account.digits} digits · ${account.period}s`;

  return (
    <div
      className={cn(
        "group relative flex items-center gap-2 py-3 pl-2 pr-1",
        "border-b border-border-soft",
        "transition-colors duration-100",
        "hover:bg-card/60",
        menuOpen && "bg-card/60",
      )}
    >
      {/* Vermillion accent rail on hover/focus */}
      <span
        className={cn(
          "pointer-events-none absolute left-0 top-3 bottom-3 w-[2px] bg-primary",
          "opacity-0 transition-opacity duration-100",
          "group-hover:opacity-100",
          menuOpen && "opacity-100",
        )}
      />

      {/* Click area: copy */}
      <button
        type="button"
        onClick={() => void copy()}
        className={cn(
          "flex flex-1 min-w-0 items-center gap-3 text-left outline-none",
          "rounded-sm py-1 pl-1",
          "focus-visible:ring-1 focus-visible:ring-primary",
        )}
        title="Click to copy"
      >
        {/* Info column */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="size-2 shrink-0 rounded-[1px]"
              style={{ backgroundColor: dotColor }}
              aria-hidden
            />
            <span className="truncate text-[13.5px] font-semibold leading-none tracking-[-0.015em] text-foreground">
              {name}
            </span>
          </div>
          <div className="mt-1 truncate pl-4 text-[10.5px] leading-none code-mono text-muted-foreground/85">
            {sub}
          </div>
        </div>

        {/* Code + timer */}
        <div className="flex shrink-0 items-center gap-2.5 pr-1">
          <div className="text-right leading-none">
            <div
              className={cn(
                "code-mono text-[15.5px] font-medium tracking-[0.04em] transition-colors duration-100",
                urgent ? "text-primary" : "text-foreground",
                copied && "text-primary",
              )}
              style={{ fontVariantNumeric: "tabular-nums" }}
              aria-label={`Code ${account.code}`}
            >
              {formatCode(account.code)}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 justify-end">
              <span
                className="block size-2.5 shrink-0"
                aria-label={`${remaining} seconds remaining`}
                style={{
                  background: urgent
                    ? `conic-gradient(var(--color-primary) ${percent}%, var(--color-border) 0)`
                    : `conic-gradient(var(--color-success) ${percent}%, var(--color-border) 0)`,
                  borderRadius: "50%",
                  position: "relative",
                  transition: "background 200ms ease",
                }}
              >
                <span
                  className="absolute inset-[2px] rounded-full bg-background"
                  aria-hidden
                />
              </span>
              <span
                className={cn(
                  "tnums code-mono text-[10px] font-medium leading-none",
                  urgent ? "text-primary" : "text-muted-foreground/85",
                )}
              >
                {remaining}s
              </span>
            </div>
          </div>
        </div>
      </button>

      {/* Overflow menu */}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More actions"
            className={cn(
              "grid size-6 shrink-0 place-items-center rounded-sm outline-none",
              "text-muted-foreground/55 transition-[opacity,background,color] duration-100",
              "hover:bg-card hover:text-foreground",
              "focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-primary",
              "data-[state=open]:bg-card data-[state=open]:text-foreground data-[state=open]:opacity-100",
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
