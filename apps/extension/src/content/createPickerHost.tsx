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
}

interface PickerRecord {
  readonly handle: PickerHandle;
  readonly host: HTMLElement;
}

const pickerByDocument = new WeakMap<Document, PickerRecord>();

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
  options: Readonly<{ content?: ReactNode; positionToAnchor?: boolean }> = {},
): PickerHandle {
  const ownerDocument = anchor.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  const existing = pickerByDocument.get(ownerDocument);
  if (existing !== undefined && existing.handle.status === "open") {
    if (existing.host.isConnected) {
      return existing.handle;
    }
    existing.handle.close();
  }

  if (!anchor.isConnected) {
    throw new Error("Picker anchor must be connected to its document.");
  }

  const previousFocus =
    ownerDocument.activeElement instanceof HTMLElement ? ownerDocument.activeElement : null;
  const host = ownerDocument.createElement("shardpass-picker-host");
  const shadow = host.attachShadow({ mode: "closed" });
  const mount = ownerDocument.createElement("div");
  shadow.append(createStyle(ownerDocument), mount);
  ownerDocument.body.append(host);

  let status: "open" | "closed" = "open";
  let root: Root | null = createRoot(mount);
  let closeQueued = false;
  let positionFrame: number | null = null;

  const position = (): void => {
    positionFrame = null;
    if (!options.positionToAnchor || !anchor.isConnected || !host.isConnected) return;
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const measuredWidth = host.getBoundingClientRect().width;
    const width = Math.min(
      measuredWidth > 0 ? measuredWidth : 320,
      Math.max(0, (ownerWindow?.innerWidth ?? 320) - margin * 2),
    );
    const hostHeight = host.getBoundingClientRect().height || 32;
    const viewportHeight = ownerWindow?.innerHeight ?? 640;
    const below = rect.bottom + margin;
    const top =
      below + hostHeight <= viewportHeight - margin
        ? below
        : Math.max(margin, rect.top - hostHeight - margin);
    const left = Math.max(
      margin,
      Math.min(rect.left, (ownerWindow?.innerWidth ?? 320) - width - margin),
    );
    host.style.position = "fixed";
    host.style.left = `${Math.round(left)}px`;
    host.style.top = `${Math.round(top)}px`;
    host.style.right = "auto";
  };

  const schedulePosition = (): void => {
    if (!options.positionToAnchor || positionFrame !== null) return;
    positionFrame = ownerWindow?.requestAnimationFrame(position) ?? window.setTimeout(position, 16);
  };

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
    anchorObserver.disconnect();

    const activeElement = ownerDocument.activeElement;
    const focusRemainedInPicker = activeElement === host || activeElement === ownerDocument.body;

    root?.unmount();
    root = null;
    shadow.replaceChildren();
    host.remove();
    pickerByDocument.delete(ownerDocument);

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
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      requestClose();
    }
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
  };

  pickerByDocument.set(ownerDocument, { handle, host });
  ownerDocument.addEventListener("keydown", onKeyDown, true);
  ownerWindow?.addEventListener("pagehide", close, { once: true });
  ownerWindow?.addEventListener("popstate", close, { once: true });
  ownerWindow?.addEventListener("hashchange", close, { once: true });
  if (options.positionToAnchor) {
    ownerWindow?.addEventListener("scroll", schedulePosition, true);
    ownerWindow?.addEventListener("resize", schedulePosition);
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
