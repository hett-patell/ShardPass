import { useEffect, type RefObject } from "react";

/**
 * Drives a native <dialog> as a modal: opens it on mount, closes it on unmount, and routes
 * the element's own close paths (Escape, `closedby` light-dismiss) to `onCancel`. The
 * element supplies focus containment, inertness of the page behind it, and the backdrop,
 * so nothing here re-implements a focus trap.
 *
 * While `locked` (a submission in flight) the cancel request is refused, matching the
 * buttons being disabled.
 */
export function useModalDialog(
  ref: RefObject<HTMLDialogElement | null>,
  options: Readonly<{ onCancel: () => void; locked?: boolean }>,
): void {
  const { onCancel, locked = false } = options;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null || dialog.open) return;
    // Whoever had focus is the opener; the browser only restores focus to it when the dialog
    // closes while attached, and React detaches first, so it is put back by hand below.
    const opener =
      dialog.ownerDocument.activeElement instanceof HTMLElement
        ? dialog.ownerDocument.activeElement
        : null;
    // Some DOM implementations used in tests lack showModal(); fall back to plain open so the
    // content still renders. Browsers always take the modal path.
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    return () => {
      if (typeof dialog.close === "function" && dialog.open) dialog.close();
      else dialog.removeAttribute("open");
      const active = dialog.ownerDocument.activeElement;
      const focusLost =
        active === null || active === dialog.ownerDocument.body || dialog.contains(active);
      if (focusLost && opener !== null && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [ref]);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    const cancel = (event: Event) => {
      // The user pressed Escape or dismissed via `closedby`. Vetoed while locked.
      if (locked) event.preventDefault();
    };
    const close = () => {
      if (!locked) onCancel();
    };
    dialog.addEventListener("cancel", cancel);
    dialog.addEventListener("close", close);
    return () => {
      dialog.removeEventListener("cancel", cancel);
      dialog.removeEventListener("close", close);
    };
  }, [ref, onCancel, locked]);
}
