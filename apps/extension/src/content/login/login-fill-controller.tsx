import { useEffect, useRef } from "react";
import { detectLoginFields, fillLoginFields } from "@shardpass/autofill";
import type { LoginFieldSet } from "@shardpass/autofill";

import type { LoginFillContentPlatform } from "../../platform/extension-platform";
import { createPickerHost, type PickerHandle } from "../createPickerHost";
import { LoginPicker, type LoginPickerSuggestion } from "./LoginPicker";
import { createSaveLoginPrompt, type SaveLoginPrompt } from "./save-login-prompt";

export interface LoginFillController {
  start(): void;
  dispose(): void;
}

type Owner = Readonly<{
  token: object;
  input: HTMLInputElement;
  fieldSet: LoginFieldSet;
  url: string;
  origin: string;
}>;

function originOf(ownerWindow: Window): string | null {
  try {
    const origin = new URL(ownerWindow.location.href).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

function fieldSetFor(
  input: HTMLInputElement,
  fieldSets: readonly LoginFieldSet[],
): LoginFieldSet | null {
  return (
    fieldSets.find(
      (fieldSet) => fieldSet.usernameField === input || fieldSet.passwordField === input,
    ) ?? null
  );
}

function LoginTrigger({ onActivate }: Readonly<{ onActivate: () => void }>) {
  return (
    <button
      type="button"
      className="loginTrigger"
      aria-label="Fill login with ShardPass"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onActivate}
    >
      <span aria-hidden="true">SP</span>
    </button>
  );
}

function FocusedLoginPicker(
  props: Readonly<{
    suggestions: readonly LoginPickerSuggestion[];
    state: "busy" | "ready" | "empty" | "error";
    onClose: () => void;
    onSelect: (suggestion: LoginPickerSuggestion) => void;
  }>,
) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    container.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
  }, [props.state]);
  return (
    <div ref={container}>
      <LoginPicker {...props} />
    </div>
  );
}

export function createLoginFillController(
  options: Readonly<{
    document: Document;
    window: Window;
    platform: LoginFillContentPlatform;
  }>,
): LoginFillController {
  const savePrompt: SaveLoginPrompt = createSaveLoginPrompt(options);
  let fieldSets: LoginFieldSet[] = [];
  let started = false;
  let disposed = false;
  let observer: MutationObserver | null = null;
  let rescanScheduled = false;
  let owner: Owner | null = null;
  let host: PickerHandle | null = null;
  let cachedSuggestions: readonly LoginPickerSuggestion[] = [];

  const owns = (candidate: Owner): boolean =>
    !disposed &&
    owner?.token === candidate.token &&
    candidate.input.isConnected &&
    options.window.location.href === candidate.url &&
    originOf(options.window) === candidate.origin;

  const closeHost = (): void => {
    const current = host;
    host = null;
    current?.close();
  };

  const invalidate = (restoreFocus: boolean): void => {
    const previousInput = owner?.input ?? null;
    owner = null;
    cachedSuggestions = [];
    closeHost();
    if (restoreFocus && previousInput !== null && previousInput.isConnected) {
      previousInput.focus({ preventScroll: true });
    }
  };

  const rescan = (): void => {
    rescanScheduled = false;
    if (disposed) return;
    fieldSets = detectLoginFields(options.document);
  };

  const scheduleRescan = (): void => {
    if (disposed || rescanScheduled) return;
    rescanScheduled = true;
    queueMicrotask(rescan);
  };

  const showChip = (candidate: Owner): void => {
    if (!owns(candidate)) return;
    closeHost();
    if (!owns(candidate)) return;
    host = createPickerHost(candidate.input, {
      positionToAnchor: true,
      content: <LoginTrigger onActivate={() => openPicker(candidate)} />,
    });
  };

  const renderPicker = (
    candidate: Owner,
    state: "busy" | "ready" | "empty" | "error",
    suggestions: readonly LoginPickerSuggestion[],
  ): void => {
    if (!owns(candidate)) return;
    closeHost();
    if (!owns(candidate)) return;
    host = createPickerHost(candidate.input, {
      positionToAnchor: true,
      content: (
        <FocusedLoginPicker
          suggestions={suggestions}
          state={state}
          onClose={() => invalidate(true)}
          onSelect={(suggestion) => void selectSuggestion(candidate, suggestion)}
        />
      ),
    });
  };

  // Suggestions are already fetched once (in `loadSuggestions`) purely to decide
  // whether a chip should appear at all — the chip only shows once we know there
  // is something to offer, unlike OtpFillController's always-shown trigger. That
  // same response is reused here so opening the picker never re-fetches.
  const openPicker = (candidate: Owner): void => {
    if (!owns(candidate) || options.document.activeElement !== candidate.input) return;
    renderPicker(candidate, cachedSuggestions.length === 0 ? "empty" : "ready", cachedSuggestions);
  };

  const domainFor = (): string => options.window.location.hostname;

  const loadSuggestions = async (candidate: Owner): Promise<void> => {
    try {
      const response = await options.platform.sendLoginFillMessage({
        version: 1,
        kind: "login.fillSuggestions",
        domain: domainFor(),
        pageUrl: options.window.location.href,
      });
      if (!owns(candidate) || response.kind !== "login.fillSuggestionsResult") return;
      if (response.suggestions.length === 0) return;
      cachedSuggestions = response.suggestions;
      showChip(candidate);
    } catch {
      // No suggestions available for this field right now; leave no chip behind.
    }
  };

  const sendConfirm = async (itemId: string): Promise<void> => {
    try {
      await options.platform.sendLoginFillMessage({
        version: 1,
        kind: "login.fillConfirm",
        itemId,
      });
    } catch {
      // Confirmation is a best-effort acknowledgement; a failure here cannot
      // undo the fill that already happened.
    }
  };

  const sendCancel = (itemId: string): void => {
    void options.platform
      .sendLoginFillMessage({ version: 1, kind: "login.fillCancel", itemId })
      .catch(() => undefined);
  };

  const selectSuggestion = async (
    candidate: Owner,
    suggestion: LoginPickerSuggestion,
  ): Promise<void> => {
    if (!owns(candidate)) return;
    try {
      const response = await options.platform.sendLoginFillMessage({
        version: 1,
        kind: "login.fillSelect",
        itemId: suggestion.itemId,
        expectedRevision: suggestion.expectedRevision,
      });
      if (response.kind !== "login.fillRelease") return;
      if (!owns(candidate)) {
        sendCancel(suggestion.itemId);
        return;
      }
      const fieldsReady =
        candidate.fieldSet.passwordField.isConnected &&
        (candidate.fieldSet.usernameField === null || candidate.fieldSet.usernameField.isConnected);
      if (!fieldsReady) {
        sendCancel(suggestion.itemId);
        invalidate(false);
        return;
      }
      fillLoginFields(candidate.fieldSet, response.username, response.password);
      closeHost();
      candidate.input.focus({ preventScroll: true });
      await sendConfirm(suggestion.itemId);
    } catch {
      sendCancel(suggestion.itemId);
      invalidate(false);
    }
  };

  const onFocusIn = (event?: FocusEvent): void => {
    if (disposed) return;
    if (event?.target instanceof Element && event.target.localName === "shardpass-picker-host")
      return;
    const active = options.document.activeElement;
    if (active?.tagName !== "INPUT" || active.ownerDocument.defaultView !== options.window) {
      invalidate(false);
      return;
    }
    const input = active as HTMLInputElement;
    const fieldSet = fieldSetFor(input, fieldSets);
    if (fieldSet === null) {
      invalidate(false);
      return;
    }
    if (owner?.input === input) return;
    const origin = originOf(options.window);
    if (origin === null) return;
    invalidate(false);
    const candidate: Owner = {
      token: Object.freeze({}),
      input,
      fieldSet,
      url: options.window.location.href,
      origin,
    };
    owner = candidate;
    void loadSuggestions(candidate);
  };

  const onPageInvalidated = (): void => invalidate(false);

  return {
    start() {
      if (started || disposed) return;
      started = true;
      rescan();
      const Observer = options.document.defaultView?.MutationObserver ?? MutationObserver;
      observer = new Observer(scheduleRescan);
      observer.observe(options.document.body, { childList: true, subtree: true });
      options.document.addEventListener("focusin", onFocusIn, true);
      options.window.addEventListener("pagehide", onPageInvalidated, { once: true });
      options.window.addEventListener("popstate", onPageInvalidated);
      options.window.addEventListener("hashchange", onPageInvalidated);
      savePrompt.start();
      onFocusIn();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      started = false;
      observer?.disconnect();
      observer = null;
      options.document.removeEventListener("focusin", onFocusIn, true);
      options.window.removeEventListener("pagehide", onPageInvalidated);
      options.window.removeEventListener("popstate", onPageInvalidated);
      options.window.removeEventListener("hashchange", onPageInvalidated);
      invalidate(false);
      savePrompt.dispose();
    },
  };
}
