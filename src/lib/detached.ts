/**
 * Detached-window helpers.
 *
 * MV3 action popups close the moment they lose focus, which kills any flow
 * that hands off to an OS dialog (file picker, drag from another window, etc.).
 * The Import/Export flow has to spawn a real chrome.windows popup instead so
 * the React tree (and the file <input>) survives the blur.
 */

import { log } from "@/lib/log";

export type DetachedView = "io";

export function getDetachedView(): DetachedView | null {
  try {
    const v = new URL(window.location.href).searchParams.get("view");
    return v === "io" ? "io" : null;
  } catch {
    return null;
  }
}

const DETACHED_WIDTH = 400;
const DETACHED_HEIGHT = 640;

export async function openImportExportWindow(): Promise<boolean> {
  if (typeof chrome === "undefined" || !chrome.windows?.create) return false;
  try {
    const url = chrome.runtime.getURL("src/popup/index.html") + "?view=io";
    log("detached", "opening import/export window", url);
    await chrome.windows.create({
      url,
      type: "popup",
      width: DETACHED_WIDTH,
      height: DETACHED_HEIGHT,
      focused: true,
    });
    return true;
  } catch (e) {
    log("detached", "openImportExportWindow failed", e);
    return false;
  }
}
