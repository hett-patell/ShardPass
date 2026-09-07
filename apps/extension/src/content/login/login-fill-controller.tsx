import { useEffect, useRef } from "react";
import { detectLoginFields, fillLoginFields } from "@shardpass/autofill";
import type { LoginFieldSet } from "@shardpass/autofill";

import type { LoginFillContentPlatform } from "../../platform/extension-platform";
import { createPickerHost, type PickerHandle } from "../createPickerHost";
import { LoginPicker, type LoginPickerState, type LoginPickerSuggestion } from "./LoginPicker";
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

type SuggestionsResult = Readonly<{
  state: Exclude<LoginPickerState, "busy">;
  suggestions: readonly LoginPickerSuggestion[];
}>;

/**
 * A frame whose only login form is not shown answers the popup "no form", but only after a
 * moment, so a frame that is filling a shown form gets to answer first.
 */
const NO_FORM_ANSWER_DELAY_MS = 1_000;

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

function fieldsReady(fieldSet: LoginFieldSet): boolean {
  return (
    (fieldSet.passwordField !== null || fieldSet.usernameField !== null) &&
    (fieldSet.passwordField === null || fieldSet.passwordField.isConnected) &&
    (fieldSet.usernameField === null || fieldSet.usernameField.isConnected)
  );
}

/** Whether the field a fill would land in is laid out at all (not a collapsed or hidden form). */
function isRendered(fieldSet: LoginFieldSet): boolean {
  const field = fieldSet.passwordField ?? fieldSet.usernameField;
  return field !== null && field.getClientRects().length > 0;
}

function errorCode(error: unknown): unknown {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return (error as { readonly code?: unknown }).code;
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
    state: LoginPickerState;
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
  /** The vault was locked when last asked: the chip stays, and a click asks again. */
  let locked = false;
  let pickerRequest: object | null = null;
  let disposeRuntimeMessages: (() => void) | null = null;
  // A "show password" toggle flips a password field to text; remembering the field keeps it
  // a login field.
  const seenPasswordFields = new WeakSet<HTMLInputElement>();

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
    locked = false;
    pickerRequest = null;
    closeHost();
    if (restoreFocus && previousInput !== null && previousInput.isConnected) {
      previousInput.focus({ preventScroll: true });
    }
  };

  const rescan = (): void => {
    rescanScheduled = false;
    if (disposed) return;
    fieldSets = detectLoginFields(options.document, { previousPasswordFields: seenPasswordFields });
    for (const fieldSet of fieldSets) {
      if (fieldSet.passwordField !== null) seenPasswordFields.add(fieldSet.passwordField);
    }
  };

  const scheduleRescan = (): void => {
    if (disposed || rescanScheduled) return;
    rescanScheduled = true;
    queueMicrotask(rescan);
  };

  const chipAvailable = (): boolean => cachedSuggestions.length > 0 || locked;

  const showChip = (candidate: Owner): void => {
    if (!owns(candidate)) return;
    closeHost();
    if (!owns(candidate)) return;
    host = createPickerHost(candidate.input, {
      positionToAnchor: true,
      content: <LoginTrigger onActivate={() => openPicker(candidate)} />,
    });
  };

  /** Escape or the close button: the picker goes, the field keeps its chip and its focus. */
  const dismissPicker = (candidate: Owner): void => {
    pickerRequest = null;
    if (!owns(candidate)) {
      invalidate(true);
      return;
    }
    closeHost();
    // Closing may have handed focus back to the field already, whose focusin restored the chip.
    if (host === null && chipAvailable()) showChip(candidate);
    candidate.input.focus({ preventScroll: true });
  };

  const renderPicker = (
    candidate: Owner,
    state: LoginPickerState,
    suggestions: readonly LoginPickerSuggestion[],
  ): void => {
    if (!owns(candidate)) return;
    closeHost();
    if (!owns(candidate)) return;
    host = createPickerHost(candidate.input, {
      positionToAnchor: true,
      onRequestClose: () => dismissPicker(candidate),
      content: (
        <FocusedLoginPicker
          suggestions={suggestions}
          state={state}
          onClose={() => dismissPicker(candidate)}
          onSelect={(suggestion) => void selectSuggestion(candidate, suggestion)}
        />
      ),
    });
  };

  const domainFor = (): string => options.window.location.hostname;

  const fetchSuggestions = async (): Promise<SuggestionsResult> => {
    try {
      const response = await options.platform.sendLoginFillMessage({
        version: 1,
        kind: "login.fillSuggestions",
        domain: domainFor(),
        pageUrl: options.window.location.href,
      });
      if (response.kind !== "login.fillSuggestionsResult") return { state: "error", suggestions: [] };
      return {
        state: response.suggestions.length === 0 ? "empty" : "ready",
        suggestions: response.suggestions,
      };
    } catch (error) {
      return { state: errorCode(error) === "VAULT_LOCKED" ? "locked" : "error", suggestions: [] };
    }
  };

  // Suggestions are fetched once on focus purely to decide whether a chip should appear at
  // all: it shows once there is something to offer, or when the vault is locked (so the
  // person learns why nothing is offered). Opening the picker asks again, since an unlock or
  // a new login may have happened since the chip appeared.
  const loadSuggestions = async (candidate: Owner): Promise<void> => {
    const result = await fetchSuggestions();
    if (!owns(candidate)) return;
    cachedSuggestions = result.suggestions;
    locked = result.state === "locked";
    if (chipAvailable()) showChip(candidate);
  };

  const openPicker = (candidate: Owner): void => {
    if (!owns(candidate) || options.document.activeElement !== candidate.input) return;
    renderPicker(candidate, "busy", []);
    const request = {};
    pickerRequest = request;
    void fetchSuggestions().then((result) => {
      if (pickerRequest !== request || !owns(candidate)) return;
      cachedSuggestions = result.suggestions;
      locked = result.state === "locked";
      renderPicker(candidate, result.state, result.suggestions);
    });
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
      if (!fieldsReady(candidate.fieldSet)) {
        sendCancel(suggestion.itemId);
        invalidate(false);
        return;
      }
      fillLoginFields(candidate.fieldSet, response.username, response.password);
      // Focus first: a focusin on a chip-less owner would bring the chip straight back.
      candidate.input.focus({ preventScroll: true });
      closeHost();
      await sendConfirm(suggestion.itemId);
      if (response.linkedOtpCode !== undefined) await offerOtpCode(candidate.input, response.linkedOtpCode);
    } catch (error) {
      sendCancel(suggestion.itemId);
      if (errorCode(error) === "VAULT_LOCKED" && owns(candidate)) {
        cachedSuggestions = [];
        locked = true;
        renderPicker(candidate, "locked", []);
        return;
      }
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
    if (owner?.input === input) {
      // Back on the same field after Escape closed its chip: offer it again.
      if ((host === null || host.status !== "open") && chipAvailable()) showChip(owner);
      return;
    }
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

  const pageFocused = (): Promise<boolean> =>
    new Promise((resolve) => {
      if (options.window.document.hasFocus()) {
        resolve(true);
        return;
      }
      const onFocus = () => {
        options.window.clearTimeout(timer);
        resolve(true);
      };
      const timer = options.window.setTimeout(() => {
        options.window.removeEventListener("focus", onFocus);
        resolve(false);
      }, 8_000);
      options.window.addEventListener("focus", onFocus, { once: true });
    });

  /**
   * After a fill, the login's one-time code goes to the clipboard so the site's next step is
   * a paste away -- what 1Password and Bitwarden do. Shown for a few seconds by the field;
   * a clipboard refusal (no gesture, a locked-down page) is simply not mentioned.
   */
  const offerOtpCode = async (anchor: HTMLInputElement, code: string): Promise<void> => {
    // A fill from the popup lands while the popup still has focus; the clipboard write is
    // refused from an unfocused document, so wait for focus to come back to the page.
    if (!(await pageFocused())) return;
    try {
      await options.window.navigator.clipboard.writeText(code);
    } catch {
      return;
    }
    if (disposed || !anchor.isConnected) return;
    const notice = createPickerHost(anchor, {
      positionToAnchor: true,
      content: (
        <p className="loginNotice" role="status">
          2FA code copied. Paste it when the site asks.
        </p>
      ),
    });
    options.window.setTimeout(() => notice.close(), 3_500);
  };

  /**
   * The popup's "Fill" for a login. Only the extension's own pages may ask (no tab in the
   * sender), and the credential is still released to this frame under the content-only
   * `login.fillSelect` policy, which hands it out only to a page the login was saved for.
   * A frame without a login form never answers, so the popup hears from the frame that
   * filled -- or from nobody, which its timeout reads as "no form". A frame whose forms are
   * all hidden says so, after a moment.
   */
  const onRuntimeMessage = (payload: unknown, senderMetadata: unknown): Promise<unknown> => {
    const request = payload as { version?: unknown; kind?: unknown; itemId?: unknown; expectedRevision?: unknown } | null;
    if (request?.kind !== "login.fillFromPopup") return new Promise(() => undefined);
    const meta = senderMetadata as { extensionId?: unknown; tabId?: unknown } | null;
    if (meta?.extensionId !== options.platform.extensionId || meta.tabId !== undefined)
      return Promise.resolve({ version: 1, kind: "login.fillFromPopupResult", status: "failed" });
    if (typeof request.itemId !== "string" || typeof request.expectedRevision !== "number")
      return Promise.resolve({ version: 1, kind: "login.fillFromPopupResult", status: "failed" });
    rescan();
    if (fieldSets.length === 0) return new Promise(() => undefined);
    const active = options.document.activeElement;
    const focused = active instanceof HTMLInputElement ? fieldSetFor(active, fieldSets) : null;
    const fieldSet =
      (focused !== null && isRendered(focused) ? focused : null) ??
      fieldSets.find((candidate) => candidate.passwordField !== null && isRendered(candidate)) ??
      fieldSets.find(isRendered) ??
      null;
    if (fieldSet === null)
      return new Promise((resolve) =>
        options.window.setTimeout(
          () => resolve({ version: 1, kind: "login.fillFromPopupResult", status: "no-form" }),
          NO_FORM_ANSWER_DELAY_MS,
        ),
      );
    return fillFromPopup(fieldSet, request.itemId, request.expectedRevision);
  };

  const fillFromPopup = async (fieldSet: LoginFieldSet, itemId: string, expectedRevision: number) => {
    try {
      const response = await options.platform.sendLoginFillMessage({
        version: 1,
        kind: "login.fillSelect",
        itemId,
        expectedRevision,
      });
      if (response.kind !== "login.fillRelease")
        return { version: 1, kind: "login.fillFromPopupResult", status: "failed" };
      if (!fieldsReady(fieldSet)) {
        sendCancel(itemId);
        return { version: 1, kind: "login.fillFromPopupResult", status: "no-form" };
      }
      fillLoginFields(fieldSet, response.username, response.password);
      invalidate(false);
      await sendConfirm(itemId);
      // Answer first so the popup can close; the code offer waits for focus on its own.
      const anchor = fieldSet.passwordField ?? fieldSet.usernameField;
      if (response.linkedOtpCode !== undefined && anchor !== null)
        void offerOtpCode(anchor, response.linkedOtpCode);
      return { version: 1, kind: "login.fillFromPopupResult", status: "filled" };
    } catch {
      sendCancel(itemId);
      return { version: 1, kind: "login.fillFromPopupResult", status: "failed" };
    }
  };

  return {
    start() {
      if (started || disposed) return;
      started = true;
      rescan();
      const Observer = options.document.defaultView?.MutationObserver ?? MutationObserver;
      observer = new Observer(scheduleRescan);
      observer.observe(options.document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["type", "autocomplete"],
      });
      options.document.addEventListener("focusin", onFocusIn, true);
      options.window.addEventListener("pagehide", onPageInvalidated, { once: true });
      options.window.addEventListener("popstate", onPageInvalidated);
      options.window.addEventListener("hashchange", onPageInvalidated);
      disposeRuntimeMessages = options.platform.onMessage(onRuntimeMessage);
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
      disposeRuntimeMessages?.();
      disposeRuntimeMessages = null;
      invalidate(false);
      savePrompt.dispose();
    },
  };
}
