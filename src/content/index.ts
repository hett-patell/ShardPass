import { findOtpInputs, isLikelyOtpInput } from "@/lib/detect";
import { send, type AccountWithCode } from "@/lib/messages";
import { log } from "@/lib/log";
import { mountChip, unmountChip, updateChip, isInsideChip } from "./inline-popup";

interface State {
  matches: AccountWithCode[];
  locked: boolean;
  lastFetched: number;
  activeInput: HTMLInputElement | null;
}

const state: State = {
  matches: [],
  locked: true,
  lastFetched: 0,
  activeInput: null,
};

async function refreshMatches(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - state.lastFetched < 1500) return;
  state.lastFetched = now;
  const res = await send<{ locked: boolean; matches: AccountWithCode[] }>({
    kind: "findForDomain",
    domain: location.hostname,
  });
  if (res.ok) {
    state.locked = res.data.locked;
    state.matches = res.data.matches;
    if (state.activeInput) renderForActive();
  }
}

function describeInput(input: HTMLInputElement): string {
  return JSON.stringify({
    name: input.name || undefined,
    id: input.id || undefined,
    type: input.type,
    autocomplete: input.getAttribute("autocomplete") || undefined,
    inputmode: input.getAttribute("inputmode") || undefined,
    maxLength: input.maxLength > 0 ? input.maxLength : undefined,
    placeholder: input.getAttribute("placeholder") || undefined,
    ariaLabel: input.getAttribute("aria-label") || undefined,
  });
}

function attachInput(input: HTMLInputElement): void {
  state.activeInput = input;
  log("content", `attach on ${location.hostname}:`, describeInput(input));
  void refreshMatches();
}

function detachInput(input: HTMLInputElement): void {
  if (state.activeInput === input) {
    state.activeInput = null;
    log("content", `detach on ${location.hostname}`);
    unmountChip();
  }
}

function fillCode(code: string): void {
  const input = state.activeInput;
  if (!input) return;
  const proto = Object.getPrototypeOf(input) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(input, code);
  else input.value = code;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.focus();
}

function renderForActive(): void {
  const input = state.activeInput;
  if (!input || !document.contains(input)) {
    unmountChip();
    return;
  }
  if (state.locked) {
    mountChip({
      anchor: input,
      domain: location.hostname,
      locked: true,
      accounts: [],
      onFill: () => {},
    });
    return;
  }
  if (state.matches.length === 0) {
    unmountChip();
    return;
  }
  mountChip({
    anchor: input,
    domain: location.hostname,
    locked: false,
    accounts: state.matches,
    onFill: (code) => fillCode(code),
  });
}

document.addEventListener(
  "focusin",
  (e) => {
    const target = e.target;
    if (target instanceof HTMLInputElement && isLikelyOtpInput(target)) {
      attachInput(target);
    }
  },
  true,
);

document.addEventListener(
  "focusout",
  (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return;
    const related = e.relatedTarget;
    window.setTimeout(() => {
      const active = document.activeElement;
      const relNode = related instanceof Node ? related : null;
      const actNode = active instanceof Node ? active : null;
      if (isInsideChip(relNode) || isInsideChip(actNode)) {
        return;
      }
      if (document.activeElement !== target) {
        detachInput(target);
      }
    }, 200);
  },
  true,
);

const mo = new MutationObserver(() => {
  if (state.activeInput && !document.contains(state.activeInput)) {
    unmountChip();
    state.activeInput = null;
  }
});
mo.observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener("resize", () => {
  if (state.activeInput) updateChip(state.activeInput);
});
window.addEventListener(
  "scroll",
  () => {
    if (state.activeInput) updateChip(state.activeInput);
  },
  true,
);

window.setInterval(() => {
  if (!state.activeInput) return;
  if (state.locked) return;
  if (state.matches.length === 0) return;
  void refreshMatches(true);
}, 1000);

void findOtpInputs();
