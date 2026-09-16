import type { OtpFillResponse } from "@shardpass/messaging";

import type { OtpFillContentPlatform } from "../../platform/extension-platform";
import { createPickerHost, type PickerHandle } from "../createPickerHost";
import { createOtpFieldDiscovery } from "./field-discovery";
import { createOtpFieldEligibility } from "./field-eligibility";
import { createOtpFieldHandleRegistry } from "./field-handles";
import { createOtpFillAttempt, fillOtpField } from "./fill-otp-field";
import { OtpPicker, type OtpPickerSuggestion } from "./OtpPicker";

export interface OtpFillController {
  start(): void;
  dispose(): void;
}

type Owner = Readonly<{
  token: object;
  input: HTMLInputElement;
  fieldHandle: string;
  url: string;
  origin: string;
}>;

type MutableRelease = Extract<OtpFillResponse, { kind: "otp.fillRelease" }> & { code: string };

function randomOpaqueId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Whether two URLs name the same page. A single-page app rewriting its query or fragment is
 * not a navigation, and must not silently strand the chip the person is using.
 */
function samePage(left: string, right: string): boolean {
  if (left === right) return true;
  try {
    const a = new URL(left);
    const b = new URL(right);
    return a.origin === b.origin && a.pathname === b.pathname;
  } catch {
    return false;
  }
}

/** The background's own error code, when the failure carried one. */
function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

function originOf(ownerWindow: Window): string | null {
  try {
    const origin = new URL(ownerWindow.location.href).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

function OtpTrigger({ onActivate }: Readonly<{ onActivate: () => void }>) {
  return (
    <button
      type="button"
      className="otpTrigger"
      aria-label="Fill one-time code with ShardPass"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onActivate}
    >
      <span aria-hidden="true">SP</span>
    </button>
  );
}

export function createOtpFillController(
  options: Readonly<{
    document: Document;
    window: Window;
    platform: OtpFillContentPlatform;
  }>,
): OtpFillController {
  const eligibility = createOtpFieldEligibility(options.window);
  const discovery = createOtpFieldDiscovery({
    document: options.document,
    window: options.window,
    eligibility,
  });
  const registry = createOtpFieldHandleRegistry();
  let started = false;
  let disposed = false;
  let owner: Owner | null = null;
  let host: PickerHandle | null = null;
  let release: MutableRelease | null = null;
  let capability: string | null = null;

  const owns = (candidate: Owner): boolean =>
    !disposed &&
    owner?.token === candidate.token &&
    registry.resolveActive(candidate.fieldHandle) === candidate.input &&
    candidate.input.isConnected &&
    samePage(options.window.location.href, candidate.url) &&
    originOf(options.window) === candidate.origin;

  const clearRelease = (): Readonly<{
    releaseId: string;
    code: string;
    expiresAt: number;
  }> | null => {
    if (release === null) return null;
    const terminal = {
      releaseId: release.releaseId,
      code: release.code,
      expiresAt: release.expiresAt,
    };
    release.code = "";
    release = null;
    return terminal;
  };

  const closeHost = (): void => {
    stopRefresh();
    const current = host;
    host = null;
    current?.close();
  };

  const invalidate = (restoreFocus: boolean): void => {
    owner = null;
    capability = null;
    clearRelease();
    registry.clearActive();
    closeHost();
    if (restoreFocus) {
      const focused = discovery.revalidateFocusedField();
      focused?.focus({ preventScroll: true });
    }
  };

  const sendCancel = (candidate: Owner, releaseId: string): void => {
    void options.platform
      .sendOtpFillMessage({
        version: 1,
        kind: "otp.fillCancel",
        releaseId,
        fieldHandle: candidate.fieldHandle,
      })
      .catch(() => undefined);
  };

  const showTrigger = (input: HTMLInputElement): void => {
    invalidate(false);
    const origin = originOf(options.window);
    if (origin === null) return;
    const candidate: Owner = {
      token: Object.freeze({}),
      input,
      fieldHandle: registry.activate(input),
      url: options.window.location.href,
      origin,
    };
    owner = candidate;
    host = createPickerHost(input, {
      slot: "otp-chip",
      positionToAnchor: true,
      fit: "content",
      content: <OtpTrigger onActivate={() => void openPicker(candidate)} />,
    });
  };

  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  const stopRefresh = (): void => {
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = null;
  };

  const pickerContent = (
    candidate: Owner,
    state: "busy" | "ready" | "empty" | "error" | "failed" | "stale",
    suggestions: readonly OtpPickerSuggestion[],
  ) => (
    <OtpPicker
      suggestions={suggestions}
      state={state}
      now={Date.now()}
      onClose={() => invalidate(true)}
      onSelect={(suggestion) => void selectSuggestion(candidate, suggestion)}
    />
  );

  const renderPicker = (
    candidate: Owner,
    state: "busy" | "ready" | "empty" | "error" | "failed" | "stale",
    suggestions: readonly OtpPickerSuggestion[],
  ): void => {
    if (!owns(candidate)) return;
    stopRefresh();
    closeHost();
    if (!owns(candidate)) return;
    host = createPickerHost(candidate.input, {
      slot: "otp-chip",
      positionToAnchor: true,
      fit: "anchor",
      onRequestClose: () => invalidate(true),
      content: pickerContent(candidate, state, suggestions),
    });
    // Shown codes tick down each second and are fetched again when one runs out.
    if (state === "ready" && suggestions.some((item) => item.preview !== undefined)) {
      const soonest = Math.min(
        ...suggestions.map((item) => item.preview?.expiresAt ?? Number.POSITIVE_INFINITY),
      );
      const tick = () => {
        refreshTimer = null;
        if (host === null || host.status !== "open" || !owns(candidate)) return;
        if (Date.now() >= soonest) {
          void openPicker(candidate);
          return;
        }
        host.update(pickerContent(candidate, state, suggestions));
        refreshTimer = setTimeout(tick, 1_000);
      };
      refreshTimer = setTimeout(tick, 1_000);
    }
  };

  const openPicker = async (candidate: Owner): Promise<void> => {
    if (!owns(candidate) || options.document.activeElement !== candidate.input) return;
    renderPicker(candidate, "busy", []);
    try {
      const response = await options.platform.sendOtpFillMessage({
        version: 1,
        kind: "otp.fillSuggestions",
        requestId: randomOpaqueId(),
        fieldHandle: candidate.fieldHandle,
      });
      if (!owns(candidate) || response.kind !== "otp.fillSuggestionsResult") return;
      capability = response.capability;
      renderPicker(
        candidate,
        response.suggestions.length === 0 ? "empty" : "ready",
        response.suggestions,
      );
    } catch {
      if (owns(candidate)) renderPicker(candidate, "error", []);
    }
  };

  /**
   * Asks for the code, once, and again with a fresh capability if the first attempt was
   * refused for being out of date. The permission and the item's revision are both pinned at
   * the moment the list was fetched, and either can move while the person is choosing (the
   * vault syncing, or simply a slow read): the answer to that is to ask again, not to close
   * in silence, which is what "clicking the code does nothing" was.
   */
  const requestRelease = async (
    candidate: Owner,
    suggestion: OtpPickerSuggestion,
    permission: string,
  ): Promise<OtpFillResponse | "stale"> => {
    try {
      return await options.platform.sendOtpFillMessage({
        version: 1,
        kind: "otp.fillSelect",
        capability: permission,
        itemId: suggestion.itemId,
        expectedRevision: suggestion.expectedRevision,
        fieldHandle: candidate.fieldHandle,
      });
    } catch (error) {
      const code = errorCode(error);
      if (
        code !== "OTP_FILL_ITEM_CHANGED" &&
        code !== "OTP_FILL_EXPIRED" &&
        code !== "OTP_FILL_INVALID"
      )
        throw error;
      return "stale";
    }
  };

  /** A fresh capability and the same account's current revision, for one retry. */
  const refreshSuggestion = async (
    candidate: Owner,
    suggestion: OtpPickerSuggestion,
  ): Promise<Readonly<{ permission: string; suggestion: OtpPickerSuggestion }> | null> => {
    const response = await options.platform.sendOtpFillMessage({
      version: 1,
      kind: "otp.fillSuggestions",
      requestId: randomOpaqueId(),
      fieldHandle: candidate.fieldHandle,
    });
    if (response.kind !== "otp.fillSuggestionsResult") return null;
    capability = response.capability;
    const fresh = response.suggestions.find((item) => item.itemId === suggestion.itemId);
    return fresh === undefined ? null : { permission: response.capability, suggestion: fresh };
  };

  /** Says why a click did nothing, but only into a picker that is still on screen. */
  const reportStale = (candidate: Owner): void => {
    if (host?.status === "open" && owns(candidate)) renderPicker(candidate, "stale", []);
  };

  const selectSuggestion = async (
    candidate: Owner,
    suggestion: OtpPickerSuggestion,
  ): Promise<void> => {
    const selectedCapability = capability;
    capability = null;
    if (!owns(candidate) || selectedCapability === null) {
      // The list on screen no longer matches what the background will release: say so rather
      // than letting the click disappear.
      reportStale(candidate);
      return;
    }
    try {
      let chosen = suggestion;
      let response = await requestRelease(candidate, chosen, selectedCapability);
      if (response === "stale") {
        const refreshed = owns(candidate) ? await refreshSuggestion(candidate, chosen) : null;
        if (refreshed === null) {
          reportStale(candidate);
          return;
        }
        chosen = refreshed.suggestion;
        capability = null;
        response = await requestRelease(candidate, chosen, refreshed.permission);
      }
      if (response === "stale" || response.kind !== "otp.fillRelease") {
        reportStale(candidate);
        return;
      }
      release = response;
      if (!owns(candidate)) {
        const stale = clearRelease();
        if (stale !== null) sendCancel(candidate, stale.releaseId);
        return;
      }
      const current = release;
      const result = fillOtpField({
        input: candidate.input,
        fieldHandle: candidate.fieldHandle,
        registry,
        eligibility,
        code: current.code,
        expiresAt: current.expiresAt,
        expectedUrl: candidate.url,
        expectedOrigin: candidate.origin,
        attempt: createOtpFillAttempt(),
      });
      const terminal = clearRelease();
      if (terminal === null) return;
      if (result.status !== "filled") {
        // The field would not take it (a widget that rewrites itself, a changed page): the
        // code goes to the clipboard so the person can still paste it, and the picker says so.
        sendCancel(candidate, terminal.releaseId);
        try {
          await options.window.navigator.clipboard.writeText(terminal.code);
        } catch {
          // No clipboard here; the message still explains what happened.
        }
        if (owns(candidate)) renderPicker(candidate, "failed", []);
        return;
      }
      closeHost();
      candidate.input.focus({ preventScroll: true });
      void options.platform
        .sendOtpFillMessage({
          version: 1,
          kind: "otp.fillConfirm",
          releaseId: terminal.releaseId,
          fieldHandle: candidate.fieldHandle,
          result: "filled",
        })
        .catch(() => undefined);
    } catch {
      const stale = clearRelease();
      if (stale !== null) sendCancel(candidate, stale.releaseId);
      // The picker stays, saying what happened: closing it made a refused click look like a
      // click that did nothing at all.
      if (host?.status === "open" && owns(candidate)) reportStale(candidate);
      else invalidate(false);
    }
  };

  // A code field is often focused the moment its step renders, while it is still fading in
  // or sits in a container that is still inert: not eligible yet, eligible a moment later. Look again.
  const RECHECK_DELAYS_MS = [300, 1_200];
  let recheckTimers: number[] = [];
  const clearRechecks = (): void => {
    for (const timer of recheckTimers) options.window.clearTimeout(timer);
    recheckTimers = [];
  };
  const recheckLater = (input: HTMLInputElement): void => {
    clearRechecks();
    recheckTimers = RECHECK_DELAYS_MS.map((delay) =>
      options.window.setTimeout(() => {
        if (disposed || options.document.activeElement !== input) return;
        if (discovery.revalidateFocusedField() !== input) return;
        if (owner?.input === input && host?.status === "open") return;
        showTrigger(input);
      }, delay),
    );
  };

  const onFocusIn = (event?: FocusEvent): void => {
    if (disposed) return;
    if (event?.target instanceof Element && event.target.localName === "shardpass-picker-host")
      return;
    clearRechecks();
    const input = discovery.revalidateFocusedField();
    if (input === null) {
      invalidate(false);
      const active = options.document.activeElement;
      if (active instanceof HTMLInputElement && active.ownerDocument.defaultView === options.window)
        recheckLater(active);
      return;
    }
    if (owner?.input === input && host?.status === "open") return;
    showTrigger(input);
  };

  const onPageInvalidated = (): void => invalidate(false);

  return {
    start() {
      if (started || disposed) return;
      started = true;
      // Only the focused field is ever asked about (revalidateFocusedField); the discovery's
      // document-wide scan would cost layout work on every mutation for nothing.
      options.document.addEventListener("focusin", onFocusIn, true);
      options.window.addEventListener("pagehide", onPageInvalidated, { once: true });
      options.window.addEventListener("popstate", onPageInvalidated);
      options.window.addEventListener("hashchange", onPageInvalidated);
      onFocusIn();
    },
    dispose() {
      clearRechecks();
      if (disposed) return;
      disposed = true;
      started = false;
      options.document.removeEventListener("focusin", onFocusIn, true);
      options.window.removeEventListener("pagehide", onPageInvalidated);
      options.window.removeEventListener("popstate", onPageInvalidated);
      options.window.removeEventListener("hashchange", onPageInvalidated);
      const terminal = clearRelease();
      const candidate = owner;
      if (terminal !== null && candidate !== null) sendCancel(candidate, terminal.releaseId);
      invalidate(false);
      discovery.dispose();
    },
  };
}
