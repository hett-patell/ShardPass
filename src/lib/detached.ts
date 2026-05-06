/**
 * Detached-window helpers.
 *
 * MV3 action popups are dismissed by Chromium the moment they lose focus,
 * which kills any flow that hands off to an OS dialog (file picker, etc.).
 * For those flows we re-open the same UI inside a real chrome.windows popup
 * so the React tree (and the file <input>) survives the focus change.
 */

import { log } from "@/lib/log";

export type DetachedView = "io" | "qr";

export function getDetachedView(): DetachedView | null {
  try {
    const v = new URL(window.location.href).searchParams.get("view");
    if (v === "io" || v === "qr") return v;
    return null;
  } catch {
    return null;
  }
}

// The popup body itself is locked to 360px (see globals.css). On Linux/Chromium
// a chrome.windows.create popup adds ~16-20px of OS frame, so 376px outer keeps
// the inner viewport ~= 360px and matches the toolbar popup's footprint.
const VIEW_SIZE: Record<DetachedView, { width: number; height: number }> = {
  io: { width: 376, height: 600 },
  qr: { width: 376, height: 500 },
};

function computeCenteredBounds(width: number, height: number): {
  left: number;
  top: number;
} {
  const sw = window.screen?.availWidth ?? 1280;
  const sh = window.screen?.availHeight ?? 800;
  const left = Math.max(0, Math.round((sw - width) / 2));
  const top = Math.max(0, Math.round((sh - height) / 2));
  return { left, top };
}

async function openDetachedWindow(view: DetachedView): Promise<boolean> {
  if (typeof chrome === "undefined" || !chrome.windows?.create) return false;
  try {
    const { width, height } = VIEW_SIZE[view];
    const { left, top } = computeCenteredBounds(width, height);
    const url = chrome.runtime.getURL("src/popup/index.html") + `?view=${view}`;
    log("detached", `opening view=${view}`, { url, left, top, width, height });
    await chrome.windows.create({
      url,
      type: "popup",
      width,
      height,
      left,
      top,
      focused: true,
    });
    return true;
  } catch (e) {
    log("detached", `open ${view} failed`, e);
    return false;
  }
}

export function openImportExportWindow(): Promise<boolean> {
  return openDetachedWindow("io");
}

export function openQRImportWindow(): Promise<boolean> {
  return openDetachedWindow("qr");
}
