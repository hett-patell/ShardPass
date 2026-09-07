/// <reference types="vite/client" />

import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import { FoundationPicker } from "./FoundationPicker";
import loginPickerCss from "./login/login-picker.css?raw";
import otpPickerCss from "./otp/otp-picker.css?raw";
import pickerCss from "./picker.css?raw";

export interface PickerHandle {
  close(): void;
  readonly status: "open" | "closed";
  /** Re-renders the host's content in place; a no-op once closed. */
  update(content: ReactNode): void;
}

/**
 * What a host is for. Hosts in different slots coexist -- a save banner above a login chip, a
 * passkey prompt over both -- while a new host in an occupied slot replaces the one there.
 */
export type PickerSlot = "chip" | "banner" | "prompt" | "notice" | "signin";

interface PickerRecord {
  readonly handle: PickerHandle;
  readonly host: HTMLElement;
}

const pickersByDocument = new WeakMap<Document, Map<PickerSlot, PickerRecord>>();

function slotsOf(document: Document): Map<PickerSlot, PickerRecord> {
  let slots = pickersByDocument.get(document);
  if (slots === undefined) {
    slots = new Map();
    pickersByDocument.set(document, slots);
  }
  return slots;
}

function normalizedOrigin(document: Document): string {
  try {
    const origin = new URL(document.location.href).origin;
    return origin === "null" ? "Local document" : origin;
  } catch {
    return "Unknown origin";
  }
}

function createStyle(document: Document): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = `${pickerCss}\n${otpPickerCss}\n${loginPickerCss}`;
  return style;
}

export function createPickerHost(
  anchor: HTMLElement,
  options: Readonly<{
    content?: ReactNode;
    positionToAnchor?: boolean;
    /** Which surface this host carries; "chip" when not given. */
    slot?: PickerSlot;
    /**
     * Size the host to its content and sit it inside the anchor's right edge, centred on the
     * anchor's height -- for the small chip beside a field. Pickers, banners and notices keep
     * the host's full width and hang below the anchor. Only meaningful with positionToAnchor.
     */
    fit?: "content" | "anchor";
    /** Where a host that is not anchored to a field sits; the default is the top-right corner. */
    placement?: "top-center";
    /**
     * Runs on Escape instead of closing outright, so a prompt can answer its caller first (a
     * passkey ceremony falls back to the browser, a banner dismisses its offer) and then close.
     */
    onRequestClose?: () => void;
  }> = {},
): PickerHandle {
  const ownerDocument = anchor.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  const slot = options.slot ?? "chip";
  const slots = slotsOf(ownerDocument);
  // A slot holds one host at a time: the newcomer replaces whatever is there.
  slots.get(slot)?.handle.close();

  if (!anchor.isConnected) {
    throw new Error("Picker anchor must be connected to its document.");
  }

  const previousFocus =
    ownerDocument.activeElement instanceof HTMLElement ? ownerDocument.activeElement : null;
  const host = ownerDocument.createElement("shardpass-picker-host");
  const shadow = host.attachShadow({ mode: "closed" });
  const mount = ownerDocument.createElement("div");
  shadow.append(createStyle(ownerDocument), mount);
  if (options.fit === "content") host.style.width = "max-content";
  if (!options.positionToAnchor && options.placement === "top-center") {
    host.style.left = "50%";
    host.style.right = "auto";
    host.style.top = "12px";
    host.style.transform = "translateX(-50%)";
    host.style.width = "max-content";
    host.style.maxWidth = "calc(100vw - 24px)";
  }
  ownerDocument.body.append(host);

  let status: "open" | "closed" = "open";
  let root: Root | null = createRoot(mount);
  let closeQueued = false;
  let positionFrame: number | null = null;
  const margin = 8;

  const position = (): void => {
    if (!options.positionToAnchor || !anchor.isConnected || !host.isConnected) return;
    const rect = anchor.getBoundingClientRect();
    const viewportWidth = ownerWindow?.innerWidth ?? 320;
    // A picker takes the field's own width (within reason), so it reads as part of the form.
    if (options.fit === "anchor")
      host.style.width = `${Math.round(Math.min(Math.max(rect.width, 260), 360, Math.max(0, viewportWidth - margin * 2)))}px`;
    const measured = host.getBoundingClientRect();
    const viewportHeight = ownerWindow?.innerHeight ?? 640;
    let left: number;
    let top: number;
    if (options.fit === "content") {
      const inset = 6;
      const width = measured.width || 30;
      const height = measured.height || 30;
      left = Math.max(margin, rect.right - inset - width);
      top = rect.top + (rect.height - height) / 2;
    } else {
      const width = Math.min(
        measured.width > 0 ? measured.width : 320,
        Math.max(0, viewportWidth - margin * 2),
      );
      const height = measured.height || 32;
      const below = rect.bottom + margin;
      top =
        below + height <= viewportHeight - margin
          ? below
          : Math.max(margin, rect.top - height - margin);
      left = Math.max(margin, Math.min(rect.left, viewportWidth - width - margin));
    }
    host.style.position = "fixed";
    host.style.left = `${Math.round(left)}px`;
    host.style.top = `${Math.round(top)}px`;
    host.style.right = "auto";
  };

  // Never dismiss on a question the engine cannot answer: without checkVisibility (jsdom, an
  // old engine) a 0x0 box says nothing, so the host stays.
  const anchorRendered = (): boolean => {
    if (typeof anchor.checkVisibility !== "function") return true;
    if (!anchor.checkVisibility()) return false;
    const rect = anchor.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  };

  // Every later reposition (scroll, resize, a layout shift) also notices when the anchor has
  // stopped being rendered -- a wizard step hidden, a dialog closed -- and lets go of it.
  const reposition = (): void => {
    positionFrame = null;
    if (status === "closed" || !anchor.isConnected || !host.isConnected) return;
    if (!anchorRendered()) {
      close();
      return;
    }
    position();
  };

  const schedulePosition = (): void => {
    if (!options.positionToAnchor || positionFrame !== null) return;
    positionFrame =
      ownerWindow?.requestAnimationFrame(reposition) ?? window.setTimeout(reposition, 16);
  };

  const ResizeObserverCtor = ownerWindow?.ResizeObserver;
  const resizeObserver =
    options.positionToAnchor && ResizeObserverCtor !== undefined
      ? new ResizeObserverCtor(schedulePosition)
      : null;

  const close = (): void => {
    if (status === "closed") {
      return;
    }

    status = "closed";
    closeQueued = false;
    ownerDocument.removeEventListener("keydown", onKeyDown, true);
    ownerWindow?.removeEventListener("pagehide", close);
    ownerWindow?.removeEventListener("popstate", close);
    ownerWindow?.removeEventListener("hashchange", close);
    ownerWindow?.removeEventListener("scroll", schedulePosition, true);
    ownerWindow?.removeEventListener("resize", schedulePosition);
    if (positionFrame !== null) {
      if (ownerWindow !== null) ownerWindow.cancelAnimationFrame(positionFrame);
      else window.clearTimeout(positionFrame);
      positionFrame = null;
    }
    resizeObserver?.disconnect();
    anchorObserver.disconnect();

    const activeElement = ownerDocument.activeElement;
    const focusRemainedInPicker = activeElement === host || activeElement === ownerDocument.body;

    root?.unmount();
    root = null;
    shadow.replaceChildren();
    host.remove();
    if (slots.get(slot)?.handle === handle) slots.delete(slot);

    if (focusRemainedInPicker && previousFocus?.isConnected) {
      previousFocus.focus({ preventScroll: true });
    }
  };

  const requestClose = (): void => {
    if (status === "closed" || closeQueued) {
      return;
    }
    closeQueued = true;
    queueMicrotask(close);
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    // Only claim the key when it was pressed in the host. A chip beside a field the person is
    // typing in still closes, but the page keeps its own Escape (closing its dialog, say).
    if (event.target === host || ownerDocument.activeElement === host) event.preventDefault();
    if (options.onRequestClose) options.onRequestClose();
    else requestClose();
  }

  const anchorObserver = new MutationObserver(() => {
    if (!anchor.isConnected || !host.isConnected) {
      close();
    }
  });

  const handle: PickerHandle = {
    close,
    get status() {
      return status;
    },
    update(content) {
      if (status === "closed" || root === null) return;
      flushSync(() => root?.render(content));
      schedulePosition();
    },
  };

  slots.set(slot, { handle, host });
  ownerDocument.addEventListener("keydown", onKeyDown, true);
  ownerWindow?.addEventListener("pagehide", close, { once: true });
  ownerWindow?.addEventListener("popstate", close, { once: true });
  ownerWindow?.addEventListener("hashchange", close, { once: true });
  if (options.positionToAnchor) {
    ownerWindow?.addEventListener("scroll", schedulePosition, true);
    ownerWindow?.addEventListener("resize", schedulePosition);
    resizeObserver?.observe(anchor);
    resizeObserver?.observe(ownerDocument.documentElement);
  }
  anchorObserver.observe(ownerDocument, { childList: true, subtree: true });

  flushSync(() => {
    root?.render(
      options.content ?? (
        <FoundationPicker origin={normalizedOrigin(ownerDocument)} onClose={requestClose} />
      ),
    );
  });
  position();

  return handle;
}
