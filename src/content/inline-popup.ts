import type { AccountWithCode } from "@/lib/messages";
import { formatCode } from "@/lib/format";

export const CHIP_HOST_ID = "__shardpass_chip_host__";

interface ChipProps {
  anchor: HTMLElement;
  domain: string;
  locked: boolean;
  accounts: AccountWithCode[];
  onFill: (code: string, accountId?: string, accountType?: string) => void;
}

let host: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let lastProps: ChipProps | null = null;

const STYLE = `
  :host {
    all: initial;
    --sp-bg: #131316;
    --sp-bg-hover: #1c1c20;
    --sp-border: #26262b;
    --sp-border-soft: #1d1d21;
    --sp-fg: #f4f4f5;
    --sp-muted: #a1a1aa;
    --sp-muted-dim: #71717a;
    --sp-accent: #ff4d2e;
    --sp-success: #4ade80;
    --sp-warning: #f59e0b;
  }
  .chip {
    position: fixed;
    z-index: 2147483647;
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    letter-spacing: -0.005em;
    color: var(--sp-fg);
    background: var(--sp-bg);
    border: 1px solid var(--sp-border);
    border-radius: 2px;
    padding: 0;
    box-shadow: 0 12px 32px rgba(0,0,0,0.55);
    min-width: 248px;
    max-width: 340px;
    animation: in 160ms cubic-bezier(0.16, 1, 0.3, 1);
    -webkit-font-smoothing: antialiased;
  }
  @keyframes in {
    from { opacity: 0; transform: translateY(-2px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .header {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 10px 7px 10px;
    border-bottom: 1px solid var(--sp-border-soft);
  }
  .badge {
    width: 18px; height: 18px;
    border-radius: 2px;
    background: var(--sp-accent);
    color: #fff;
    display: grid; place-items: center;
    font-size: 11px; font-weight: 700; line-height: 1;
    letter-spacing: -0.04em;
    flex-shrink: 0;
  }
  .header-title {
    font-size: 12px; font-weight: 600; color: var(--sp-fg);
    letter-spacing: -0.015em;
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .count {
    font-family: "IBM Plex Mono", "SF Mono", ui-monospace, monospace;
    font-size: 9.5px; font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--sp-muted);
  }
  .closebtn {
    appearance: none; border: 0; background: transparent; cursor: pointer;
    color: var(--sp-muted-dim);
    width: 18px; height: 18px;
    display: grid; place-items: center;
    font-size: 14px; line-height: 1;
    border-radius: 2px;
    transition: background 100ms ease, color 100ms ease;
  }
  .closebtn:hover { color: var(--sp-fg); background: var(--sp-bg-hover); }

  .row {
    appearance: none; border: 0; background: transparent; cursor: pointer;
    width: 100%;
    display: flex; align-items: center; gap: 10px;
    padding: 8px 10px;
    color: inherit;
    text-align: left;
    transition: background 100ms ease;
    font-family: inherit;
    letter-spacing: -0.005em;
    border-bottom: 1px solid var(--sp-border-soft);
    position: relative;
  }
  .row:last-child { border-bottom: 0; }
  .row:hover { background: var(--sp-bg-hover); }
  .row:hover::before, .row:focus-visible::before {
    content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 2px;
    background: var(--sp-accent);
  }
  .row:focus-visible { outline: none; background: var(--sp-bg-hover); }

  .row-dot {
    width: 8px; height: 8px;
    border-radius: 1px;
    flex-shrink: 0;
    background: #e4e4e7;
  }
  .row-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .row-title {
    font-size: 12.5px; font-weight: 600; color: var(--sp-fg);
    letter-spacing: -0.015em;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .row-sub {
    font-family: "IBM Plex Mono", "SF Mono", ui-monospace, monospace;
    font-size: 10px; color: var(--sp-muted);
    letter-spacing: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .row-code {
    font-family: "IBM Plex Mono", "SF Mono", ui-monospace, monospace;
    font-size: 13px; font-weight: 500;
    letter-spacing: 0.04em;
    color: var(--sp-fg);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .row-code.urgent { color: var(--sp-accent); }
  .row-timer {
    width: 10px; height: 10px;
    flex-shrink: 0;
    border-radius: 50%;
    position: relative;
  }
  .row-timer::after {
    content: ""; position: absolute; inset: 2px;
    background: var(--sp-bg);
    border-radius: 50%;
  }

  .single-row { padding: 10px 12px; border-bottom: 0; }
  .single-row .row-code { font-size: 15px; }

  .list { max-height: 260px; overflow-y: auto; }
  .list::-webkit-scrollbar { width: 4px; }
  .list::-webkit-scrollbar-thumb { background: var(--sp-border); border-radius: 0; }
  .list::-webkit-scrollbar-track { background: transparent; }

  .locked-state {
    padding: 10px 12px;
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--sp-warning);
    border-left: 2px solid var(--sp-warning);
  }

`;

export function mountChip(props: ChipProps): void {
  lastProps = props;
  if (!host) {
    host = document.createElement("div");
    host.id = CHIP_HOST_ID;
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    shadow.appendChild(style);
  }
  render();
  position(props.anchor);
}

export function unmountChip(): void {
  if (host?.parentNode) host.parentNode.removeChild(host);
  host = null;
  shadow = null;
  lastProps = null;
}

export function updateChip(anchor: HTMLElement): void {
  if (!host || !lastProps) return;
  position(anchor);
}

export function isInsideChip(node: Node | null): boolean {
  const h = document.getElementById(CHIP_HOST_ID);
  if (!h || !node) return false;
  if (node === h) return true;
  const sr = h.shadowRoot;
  if (sr) return sr.contains(node);
  return false;
}

function position(anchor: HTMLElement): void {
  if (!shadow) return;
  const chip = shadow.querySelector(".chip") as HTMLElement | null;
  if (!chip) return;
  const rect = anchor.getBoundingClientRect();
  const chipWidth = chip.offsetWidth || 260;
  const chipHeight = chip.offsetHeight || 60;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top = rect.bottom + 6;
  let left = rect.left;
  if (top + chipHeight > vh - 8) top = Math.max(8, rect.top - chipHeight - 6);
  if (left + chipWidth > vw - 8) left = Math.max(8, vw - chipWidth - 8);
  chip.style.top = `${Math.round(top)}px`;
  chip.style.left = `${Math.round(left)}px`;
}

function rootDomain(host: string): string {
  const labels = host.toLowerCase().split(".").filter(Boolean);
  return labels.length >= 2 ? labels.slice(-2).join(".") : host;
}

const DOT_PALETTE = [
  "#ff4d2e",
  "#f59e0b",
  "#4ade80",
  "#22d3ee",
  "#a78bfa",
  "#f472b6",
  "#facc15",
  "#94a3b8",
];

function hashIndex(key: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h) % mod;
}

function makeTimer(account: AccountWithCode, urgent: boolean): HTMLDivElement {
  const ratio =
    account.period > 0 ? Math.max(0, account.remainingSeconds) / account.period : 0;
  const pct = Math.round(ratio * 100);
  const color = urgent ? "var(--sp-accent)" : "var(--sp-fg)";
  const div = document.createElement("div");
  div.className = "row-timer";
  div.style.background = `conic-gradient(${color} ${pct}%, var(--sp-border) ${pct}%)`;
  return div;
}

function makeAccountRow(
  account: AccountWithCode,
  domain: string,
  onFill: (code: string, accountId?: string, accountType?: string) => void,
  large: boolean,
): HTMLButtonElement {
  const isHotp = account.type === "hotp";
  const urgent = !isHotp && account.remainingSeconds <= 5;
  const row = document.createElement("button");
  row.type = "button";
  row.className = large ? "row single-row" : "row";
  row.dataset.accountId = account.id;
  row.title = `Fill code for ${account.issuer || account.label || domain}`;

  const dot = document.createElement("div");
  dot.className = "row-dot";
  const dotKey = account.issuer || account.label || account.id || "?";
  dot.style.background = DOT_PALETTE[hashIndex(dotKey, DOT_PALETTE.length)];
  row.appendChild(dot);

  const meta = document.createElement("div");
  meta.className = "row-meta";
  const title = document.createElement("div");
  title.className = "row-title";
  title.textContent = account.issuer || account.label || "Account";
  meta.appendChild(title);
  if (account.label && account.issuer) {
    const sub = document.createElement("div");
    sub.className = "row-sub";
    sub.textContent = account.label;
    meta.appendChild(sub);
  } else if (!account.issuer && !account.label) {
    const sub = document.createElement("div");
    sub.className = "row-sub";
    sub.textContent = rootDomain(domain);
    meta.appendChild(sub);
  }
  row.appendChild(meta);

  const code = document.createElement("div");
  code.className = urgent ? "row-code urgent" : "row-code";
  code.textContent = formatCode(account.code);
  row.appendChild(code);

  if (!isHotp) row.appendChild(makeTimer(account, urgent));

  row.addEventListener("mousedown", (e) => e.preventDefault());
  row.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onFill(account.code, account.id, account.type);
  });
  return row;
}

function render(): void {
  if (!shadow || !lastProps) return;
  const prevChip = shadow.querySelector(".chip") as HTMLElement | null;
  // The chip re-renders every second while open; capture focus and scroll
  // so the rebuild is invisible, and only animate the very first mount.
  const focusedAccountId =
    (shadow.activeElement as HTMLElement | null)?.dataset?.accountId ?? null;
  const prevScrollTop =
    (shadow.querySelector(".list") as HTMLElement | null)?.scrollTop ?? 0;
  prevChip?.remove();
  const props = lastProps;
  const chip = document.createElement("div");
  chip.className = "chip";
  if (prevChip) chip.style.animation = "none";
  const restore = () => {
    const list = chip.querySelector(".list") as HTMLElement | null;
    if (list && prevScrollTop) list.scrollTop = prevScrollTop;
    if (focusedAccountId) {
      const row = chip.querySelector(
        `[data-account-id="${CSS.escape(focusedAccountId)}"]`,
      ) as HTMLElement | null;
      row?.focus();
    }
  };

  if (props.locked) {
    const header = document.createElement("div");
    header.className = "header";
    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = "S";
    header.appendChild(badge);

    const title = document.createElement("div");
    title.className = "header-title";
    title.textContent = "ShardPass is locked";
    header.appendChild(title);

    const close = makeCloseButton();
    header.appendChild(close);
    chip.appendChild(header);

    const msg = document.createElement("div");
    msg.className = "locked-state";
    msg.textContent = `Open the extension to unlock (${rootDomain(props.domain)})`;
    chip.appendChild(msg);

    shadow.appendChild(chip);
    position(props.anchor);
    return;
  }

  // The content script unmounts the chip when matches.length === 0
  // (content/index.ts:90-92), so this branch is never reached at runtime.
  // Keep as a safety net in case mount is called directly with empty matches.
  if (props.accounts.length === 0) {
    unmountChip();
    return;
  }

  if (props.accounts.length === 1) {
    const row = makeAccountRow(props.accounts[0], props.domain, props.onFill, true);
    chip.appendChild(row);
    chip.appendChild(makeCloseButton({ floating: true }));
    shadow.appendChild(chip);
    position(props.anchor);
    restore();
    return;
  }

  const header = document.createElement("div");
  header.className = "header";
  const badge = document.createElement("div");
  badge.className = "badge";
  badge.textContent = (props.accounts[0].issuer || rootDomain(props.domain))[0].toUpperCase();
  header.appendChild(badge);

  const title = document.createElement("div");
  title.className = "header-title";
  title.textContent = `${props.accounts[0].issuer || rootDomain(props.domain)} accounts`;
  header.appendChild(title);

  const count = document.createElement("div");
  count.className = "count";
  count.textContent = String(props.accounts.length);
  header.appendChild(count);

  header.appendChild(makeCloseButton());
  chip.appendChild(header);

  const divider = document.createElement("div");
  divider.className = "divider";
  chip.appendChild(divider);

  const list = document.createElement("div");
  list.className = "list";
  for (const acc of props.accounts) {
    list.appendChild(makeAccountRow(acc, props.domain, props.onFill, false));
  }
  chip.appendChild(list);

  shadow.appendChild(chip);
  position(props.anchor);
  restore();
}

function makeCloseButton(opts: { floating?: boolean } = {}): HTMLButtonElement {
  const close = document.createElement("button");
  close.className = "closebtn";
  close.textContent = "×";
  close.title = "Dismiss";
  if (opts.floating) {
    close.style.position = "absolute";
    close.style.top = "4px";
    close.style.right = "4px";
  }
  close.addEventListener("mousedown", (e) => e.preventDefault());
  close.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    unmountChip();
  });
  return close;
}
