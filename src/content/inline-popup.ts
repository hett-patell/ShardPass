import type { AccountWithCode } from "@/lib/messages";

export const CHIP_HOST_ID = "__shardpass_chip_host__";

interface ChipProps {
  anchor: HTMLElement;
  domain: string;
  locked: boolean;
  accounts: AccountWithCode[];
  onFill: (code: string) => void;
}

let host: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let lastProps: ChipProps | null = null;

const STYLE = `
  :host { all: initial; }
  .chip {
    position: fixed;
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
    color: #fafafa;
    background: oklch(0.18 0 0);
    border: 1px solid oklch(1 0 0 / 8%);
    border-radius: 10px;
    padding: 4px;
    box-shadow: 0 12px 32px rgba(0,0,0,0.55), 0 0 0 1px oklch(1 0 0 / 4%) inset;
    backdrop-filter: blur(8px);
    min-width: 240px;
    max-width: 340px;
    animation: in 140ms cubic-bezier(0.16, 1, 0.3, 1);
    -webkit-font-smoothing: antialiased;
  }
  @keyframes in {
    from { opacity: 0; transform: translateY(-4px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .header {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 8px 6px 8px;
  }
  .badge {
    width: 22px; height: 22px;
    border-radius: 6px;
    background: oklch(0.24 0 0);
    display: grid; place-items: center;
    font-size: 10.5px; font-weight: 700; color: oklch(0.85 0 0);
    flex-shrink: 0;
  }
  .header-title {
    font-size: 11px; font-weight: 600; color: oklch(0.95 0 0);
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .count {
    font-size: 10px; color: oklch(0.62 0 0);
    background: oklch(0.22 0 0); padding: 2px 6px; border-radius: 4px;
  }
  .closebtn {
    appearance: none; border: 0; background: transparent; cursor: pointer;
    color: oklch(0.55 0 0); padding: 2px 4px; font-size: 14px; line-height: 1;
    border-radius: 4px;
  }
  .closebtn:hover { color: oklch(0.95 0 0); background: oklch(0.22 0 0); }

  .row {
    appearance: none; border: 0; background: transparent; cursor: pointer;
    width: 100%;
    display: flex; align-items: center; gap: 10px;
    padding: 7px 8px;
    border-radius: 6px;
    color: inherit;
    text-align: left;
    transition: background 80ms ease;
  }
  .row:hover { background: oklch(0.22 0 0); }
  .row:focus-visible { outline: 2px solid oklch(0.62 0 0 / 40%); outline-offset: -2px; }

  .row-icon {
    width: 22px; height: 22px;
    border-radius: 5px;
    background: oklch(0.22 0 0);
    display: grid; place-items: center;
    font-size: 10.5px; font-weight: 700; color: oklch(0.78 0 0);
    flex-shrink: 0;
  }
  .row-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .row-title {
    font-size: 11.5px; font-weight: 500; color: oklch(0.95 0 0);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .row-sub {
    font-size: 10px; color: oklch(0.6 0 0);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .row-code {
    font-family: "SF Mono", "JetBrains Mono", ui-monospace, monospace;
    font-size: 13px; letter-spacing: 0.06em;
    color: oklch(0.95 0 0); font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .row-code.urgent { color: oklch(0.7 0.18 25); }
  .row-timer {
    width: 14px; height: 14px;
    flex-shrink: 0;
    transform: rotate(-90deg);
  }
  .row-timer circle.bg { fill: none; stroke: oklch(0.28 0 0); stroke-width: 2.5; }
  .row-timer circle.fg { fill: none; stroke: oklch(0.78 0 0); stroke-width: 2.5; transition: stroke-dashoffset 1s linear; }
  .row-timer circle.fg.urgent { stroke: oklch(0.7 0.18 25); }

  .single-row .row-code { font-size: 16px; font-weight: 300; }

  .divider { height: 1px; background: oklch(1 0 0 / 6%); margin: 2px 6px; }

  .list { max-height: 260px; overflow-y: auto; padding: 0 2px 2px 2px; }
  .list::-webkit-scrollbar { width: 4px; }
  .list::-webkit-scrollbar-thumb { background: oklch(1 0 0 / 8%); border-radius: 2px; }
  .list::-webkit-scrollbar-track { background: transparent; }

  .locked-state {
    padding: 10px 12px;
    font-size: 11px;
    color: oklch(0.78 0.12 80);
  }
  .empty {
    padding: 10px 12px;
    font-size: 11px;
    color: oklch(0.6 0 0);
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

function formatCode(code: string): string {
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`;
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`;
  if (code.length === 7) return `${code.slice(0, 3)} ${code.slice(3)}`;
  return code;
}

function rootDomain(host: string): string {
  const labels = host.toLowerCase().split(".").filter(Boolean);
  return labels.length >= 2 ? labels.slice(-2).join(".") : host;
}

function makeTimer(account: AccountWithCode, urgent: boolean): SVGSVGElement {
  const ratio = Math.max(0, account.remainingSeconds) / account.period;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "row-timer");
  svg.setAttribute("viewBox", "0 0 14 14");
  const bg = document.createElementNS(ns, "circle");
  bg.setAttribute("class", "bg");
  bg.setAttribute("cx", "7");
  bg.setAttribute("cy", "7");
  bg.setAttribute("r", "5");
  const fg = document.createElementNS(ns, "circle");
  fg.setAttribute("class", urgent ? "fg urgent" : "fg");
  fg.setAttribute("cx", "7");
  fg.setAttribute("cy", "7");
  fg.setAttribute("r", "5");
  const circ = 2 * Math.PI * 5;
  fg.setAttribute("stroke-dasharray", String(circ));
  fg.setAttribute("stroke-dashoffset", String(circ * (1 - ratio)));
  fg.setAttribute("stroke-linecap", "round");
  svg.appendChild(bg);
  svg.appendChild(fg);
  return svg;
}

function makeAccountRow(
  account: AccountWithCode,
  domain: string,
  onFill: (code: string) => void,
  large: boolean,
): HTMLButtonElement {
  const urgent = account.remainingSeconds <= 5;
  const row = document.createElement("button");
  row.type = "button";
  row.className = large ? "row single-row" : "row";
  row.title = `Fill code for ${account.issuer || account.label || domain}`;

  const icon = document.createElement("div");
  icon.className = "row-icon";
  icon.textContent = (account.issuer || account.label || "?")[0].toUpperCase();
  row.appendChild(icon);

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

  row.appendChild(makeTimer(account, urgent));

  row.addEventListener("mousedown", (e) => e.preventDefault());
  row.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onFill(account.code);
  });
  return row;
}

function render(): void {
  if (!shadow || !lastProps) return;
  shadow.querySelector(".chip")?.remove();
  const props = lastProps;
  const chip = document.createElement("div");
  chip.className = "chip";

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

  if (props.accounts.length === 0) {
    const header = document.createElement("div");
    header.className = "header";
    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = "S";
    header.appendChild(badge);
    const title = document.createElement("div");
    title.className = "header-title";
    title.textContent = "No matching accounts";
    header.appendChild(title);
    header.appendChild(makeCloseButton());
    chip.appendChild(header);

    const msg = document.createElement("div");
    msg.className = "empty";
    msg.textContent = `No saved TOTP for ${rootDomain(props.domain)}`;
    chip.appendChild(msg);

    shadow.appendChild(chip);
    position(props.anchor);
    return;
  }

  if (props.accounts.length === 1) {
    const row = makeAccountRow(props.accounts[0], props.domain, props.onFill, true);
    chip.appendChild(row);
    chip.appendChild(makeCloseButton({ floating: true }));
    shadow.appendChild(chip);
    position(props.anchor);
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
