import type { ReactNode } from "react";
import { detectLoginFields, fillLoginFields } from "@shardpass/autofill";
import type { LoginFieldSet } from "@shardpass/autofill";

import type { LoginFillContentPlatform } from "../../platform/extension-platform";
import { createPickerHost, type PickerHandle } from "../createPickerHost";
import { filterSuggestions, LoginPicker, type LoginPickerState, type LoginPickerSuggestion } from "./LoginPicker";
import { SignInBanner } from "./SignInBanner";
import { suggestPassword } from "./suggest-password";
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

type PickerView = {
  candidate: Owner;
  /** A sign-up form's suggested password, when this is one. */
  generated: string | null;
  state: LoginPickerState;
  suggestions: readonly LoginPickerSuggestion[];
  /** What the person typed into the field since the picker opened; a prefill does not count. */
  filter: string;
  typed: boolean;
  activeIndex: number;
};

const SIGNUP_WORDS = /\b(?:sign\s?up|create (?:an? |your )?account|register|registration|join|get started)\b/iu;

/**
 * Whether this field set is where a password gets chosen rather than entered: the browser's
 * own new-password hint, a confirm field beside it, or a form that calls itself a sign-up.
 * Returns the fields a chosen password must go into.
 */
function signupFieldsOf(fieldSet: LoginFieldSet): HTMLInputElement[] | null {
  const password = fieldSet.passwordField;
  if (password === null) return null;
  const scope: ParentNode = fieldSet.form ?? password.ownerDocument;
  const passwords = Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="password"]')).filter(
    (field) => !field.disabled,
  );
  const twins = passwords.filter((field) => field === password || field.autocomplete === "new-password" || passwords.length >= 2);
  const hinted = password.autocomplete === "new-password";
  const text = `${fieldSet.form?.textContent ?? ""} ${fieldSet.form?.querySelector("h1, h2, h3")?.textContent ?? ""}`.slice(0, 2_000);
  if (!hinted && passwords.length < 2 && !SIGNUP_WORDS.test(text)) return null;
  return twins.length > 0 ? twins : [password];
}

const CAPTCHA_SELECTOR =
  'iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i], iframe[src*="turnstile" i], [class*="captcha" i], [id*="captcha" i]';

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
  let picker: PickerView | null = null;
  let disposeRuntimeMessages: (() => void) | null = null;
  // The sign-in banner: one per page load, for the page's own login form, until dismissed
  // or used. Only the top frame offers it, so a page with login iframes shows one.
  let bannerHost: PickerHandle | null = null;
  let bannerFor: HTMLInputElement | null = null;
  /** Closed by the person (gone for this page load) or by a fill (a later step may offer again). */
  let bannerDismissedBy: "user" | "fill" | null = null;
  let bannerBusy = false;
  let bannerRender: (() => ReactNode) | null = null;
  const bannerAsked = new WeakSet<HTMLInputElement>();
  // A "show password" toggle flips a password field to text; remembering the field keeps it
  // a login field.
  const seenPasswordFields = new WeakSet<HTMLInputElement>();

  const owns = (candidate: Owner): boolean =>
    !disposed &&
    owner?.token === candidate.token &&
    candidate.input.isConnected &&
    options.window.location.href === candidate.url &&
    originOf(options.window) === candidate.origin;

  const detachPickerKeys = (): void => {
    const view = picker;
    picker = null;
    if (view === null) return;
    view.candidate.input.removeEventListener("keydown", onPickerKeyDown, true);
    view.candidate.input.removeEventListener("input", onPickerInput);
  };

  const closeHost = (): void => {
    detachPickerKeys();
    const current = host;
    host = null;
    current?.close();
  };

  const closeBanner = (): void => {
    const current = bannerHost;
    bannerHost = null;
    bannerFor = null;
    bannerRender = null;
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
    if (bannerHost !== null && (bannerFor === null || !bannerFor.isConnected || bannerFor.getClientRects().length === 0))
      closeBanner();
    maybeOfferSignIn();
  };

  const scheduleRescan = (): void => {
    if (disposed || rescanScheduled) return;
    rescanScheduled = true;
    queueMicrotask(rescan);
  };

  const chipAvailable = (): boolean =>
    cachedSuggestions.length > 0 || locked || (owner !== null && signupFieldsOf(owner.fieldSet) !== null);

  const showChip = (candidate: Owner): void => {
    if (!owns(candidate)) return;
    closeHost();
    if (!owns(candidate)) return;
    host = createPickerHost(candidate.input, {
      positionToAnchor: true,
      fit: "content",
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

  const useGenerated = (view: PickerView): void => {
    const fields = signupFieldsOf(view.candidate.fieldSet);
    if (view.generated === null || fields === null || !owns(view.candidate)) return;
    for (const field of fields) fillLoginFields({ usernameField: null, passwordField: field, form: null }, "", view.generated);
    view.candidate.input.focus({ preventScroll: true });
    closeHost();
  };

  const pickerContent = (view: PickerView) => (
    <LoginPicker
      suggestions={view.suggestions}
      state={view.state}
      filter={view.typed ? view.filter : ""}
      activeIndex={view.activeIndex}
      generated={
        view.generated === null
          ? undefined
          : {
              password: view.generated,
              onUse: () => useGenerated(view),
              onAnother: () => {
                view.generated = suggestPassword();
                refreshPicker();
              },
            }
      }
      onClose={() => dismissPicker(view.candidate)}
      onSelect={(suggestion) => void selectSuggestion(view.candidate, suggestion)}
    />
  );

  const visibleRows = (view: PickerView): LoginPickerSuggestion[] =>
    view.state === "ready" ? filterSuggestions(view.suggestions, view.typed ? view.filter : "") : [];

  const refreshPicker = (): void => {
    if (picker !== null) host?.update(pickerContent(picker));
  };

  /** Typing in the page's field narrows the rows; a value nothing matches sends the picker away. */
  function onPickerInput(): void {
    const view = picker;
    if (view === null) return;
    view.typed = true;
    view.filter = view.candidate.input.value;
    view.activeIndex = -1;
    if (view.state === "ready" && view.filter.trim() !== "" && visibleRows(view).length === 0) {
      dismissPicker(view.candidate);
      return;
    }
    refreshPicker();
  }

  /** Arrow keys walk the rows and Enter takes one, all without leaving the field. */
  function onPickerKeyDown(event: KeyboardEvent): void {
    const view = picker;
    if (view === null || view.state !== "ready") return;
    const rows = visibleRows(view);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      view.activeIndex = (view.activeIndex + step + rows.length) % rows.length;
      refreshPicker();
    } else if (event.key === "Enter" && view.activeIndex >= 0) {
      const chosen = rows[view.activeIndex];
      if (chosen === undefined) return;
      event.preventDefault();
      void selectSuggestion(view.candidate, chosen);
    } else if (event.key === "Tab") {
      dismissPicker(view.candidate);
    }
  }

  const renderPicker = (
    candidate: Owner,
    state: LoginPickerState,
    suggestions: readonly LoginPickerSuggestion[],
  ): void => {
    if (!owns(candidate)) return;
    const previous = picker !== null && picker.candidate === candidate ? picker : null;
    closeHost();
    if (!owns(candidate)) return;
    const view: PickerView = {
      candidate,
      generated: previous?.generated ?? (signupFieldsOf(candidate.fieldSet) === null ? null : suggestPassword()),
      state,
      suggestions,
      filter: previous?.filter ?? "",
      typed: previous?.typed ?? false,
      activeIndex: -1,
    };
    picker = view;
    candidate.input.addEventListener("keydown", onPickerKeyDown, true);
    candidate.input.addEventListener("input", onPickerInput);
    host = createPickerHost(candidate.input, {
      positionToAnchor: true,
      fit: "anchor",
      onRequestClose: () => dismissPicker(candidate),
      content: pickerContent(view),
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

  /** A visible CAPTCHA means the site wants a human on the submit; filling still helps. */
  const captchaPresent = (): boolean =>
    Array.from(options.document.querySelectorAll(CAPTCHA_SELECTOR)).some((element) => element.getClientRects().length > 0);

  const submitForm = (fieldSet: LoginFieldSet): void => {
    const form = fieldSet.passwordField?.form ?? fieldSet.usernameField?.form ?? null;
    if (form === null || captchaPresent()) return;
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.submit();
  };

  const selectSuggestion = async (
    candidate: Owner,
    suggestion: LoginPickerSuggestion,
    mode: Readonly<{ submit: boolean }> = { submit: false },
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
      if (bannerDismissedBy === null) bannerDismissedBy = "fill";
      closeBanner();
      await sendConfirm(suggestion.itemId);
      if (mode.submit) submitForm(candidate.fieldSet);
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
    // A form that appeared without a DOM change (a modal shown by a class flip) is noticed here.
    maybeOfferSignIn();
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

  /** The top frame, or a frame with room for the banner (a bank's login iframe, say). */
  const frameCanHostBanner = (): boolean => {
    try {
      if (options.window.top === options.window) return true;
    } catch {
      // Cross-origin parent: fall through to the size check.
    }
    return options.window.innerWidth >= 360 && options.window.innerHeight >= 160;
  };

  const bestSuggestion = (fieldSet: LoginFieldSet, suggestions: readonly LoginPickerSuggestion[]) => {
    const typed = fieldSet.usernameField?.value.trim().toLocaleLowerCase() ?? "";
    const sorted = filterSuggestions(suggestions, "");
    return sorted.find((item) => typed !== "" && item.username.toLocaleLowerCase() === typed) ?? sorted[0] ?? null;
  };

  const ownerFor = (fieldSet: LoginFieldSet): Owner | null => {
    const input = fieldSet.usernameField ?? fieldSet.passwordField;
    const origin = originOf(options.window);
    if (input === null || origin === null) return null;
    return { token: Object.freeze({}), input, fieldSet, url: options.window.location.href, origin };
  };

  const signInFromBanner = async (fieldSet: LoginFieldSet, suggestion: LoginPickerSuggestion): Promise<void> => {
    if (bannerBusy || disposed) return;
    const candidate = ownerFor(fieldSet);
    if (candidate === null) return;
    bannerBusy = true;
    if (bannerRender !== null) bannerHost?.update(bannerRender());
    invalidate(false);
    owner = candidate;
    try {
      await selectSuggestion(candidate, suggestion, { submit: true });
    } finally {
      bannerBusy = false;
      if (bannerRender !== null) bannerHost?.update(bannerRender());
    }
  };

  const otherOptions = (fieldSet: LoginFieldSet): void => {
    bannerDismissedBy = "user";
    closeBanner();
    const input = fieldSet.usernameField ?? fieldSet.passwordField;
    if (input === null) return;
    input.focus({ preventScroll: true });
    onFocusIn();
    if (owner !== null && owner.input === input) openPicker(owner);
  };

  const showBanner = (fieldSet: LoginFieldSet, suggestions: readonly LoginPickerSuggestion[]): void => {
    const best = bestSuggestion(fieldSet, suggestions);
    const anchor = fieldSet.passwordField ?? fieldSet.usernameField;
    if (best === null || anchor === null || !options.document.body.isConnected) return;
    const render = () => (
      <SignInBanner
        name={best.name}
        username={best.username}
        otherCount={suggestions.length - 1}
        busy={bannerBusy}
        // A username-only first step only gets the name in; the password step follows.
        action={fieldSet.passwordField === null ? "Continue" : "Sign in"}
        onSignIn={() => void signInFromBanner(fieldSet, best)}
        onOtherOptions={() => otherOptions(fieldSet)}
        onClose={() => {
          bannerDismissedBy = "user";
          closeBanner();
        }}
      />
    );
    bannerRender = render;
    bannerFor = anchor;
    bannerHost = createPickerHost(options.document.body, {
      positionToAnchor: false,
      slot: "signin",
      placement: "top-center",
      content: render(),
    });
  };

  /**
   * The banner is offered once per password field, when the page has a shown login form and
   * the vault has something for it. Nothing is drawn while the vault is locked: the chip by
   * the field already explains that.
   */
  function maybeOfferSignIn(): void {
    if (disposed || bannerDismissedBy === "user" || bannerHost !== null || !frameCanHostBanner()) return;
    // A shown form with a password first; failing that, a shown username-only first step.
    const fieldSet =
      fieldSets.find((candidate) => candidate.passwordField !== null && isRendered(candidate)) ??
      fieldSets.find((candidate) => candidate.usernameField !== null && isRendered(candidate)) ??
      null;
    const field = fieldSet === null ? null : (fieldSet.passwordField ?? fieldSet.usernameField);
    if (fieldSet === null || field === null || bannerAsked.has(field)) return;
    bannerAsked.add(field);
    void fetchSuggestions().then((result) => {
      if (disposed || bannerDismissedBy === "user" || bannerHost !== null) return;
      if (result.state !== "ready" || !field.isConnected || !isRendered(fieldSet)) {
        // Not now (locked, or the form went away before the answer): ask again on the next look.
        bannerAsked.delete(field);
        return;
      }
      showBanner(fieldSet, result.suggestions);
    });
  }

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
      if (bannerDismissedBy === null) bannerDismissedBy = "fill";
      closeBanner();
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
      closeBanner();
      savePrompt.dispose();
    },
  };
}
