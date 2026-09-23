import type { ReactNode } from "react";
import { detectLoginFields, fillLoginFields, isDrawn } from "@shardpass/autofill";
import type { LoginFieldSet } from "@shardpass/autofill";

import type { LoginFillContentPlatform } from "../../platform/extension-platform";
import { deepActiveElement } from "../deep-active-element";
import { createPickerHost, type PickerHandle } from "../createPickerHost";
import {
  filterSuggestions,
  LoginPicker,
  type LoginPickerState,
  type LoginPickerSuggestion,
} from "./LoginPicker";
import { SIGN_IN_PROVIDER_LABELS } from "@shardpass/domain";
import { findProviderButton } from "./provider-button";
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
/** Open shadow roots watched for changes over the page's lifetime. */
const MAX_WATCHED_SHADOW_ROOTS = 200;

/** The first `limit` characters of a node's text, without serialising the whole page. */
function textPrefixOf(root: Node, limit: number): string {
  const ownerDocument = root.ownerDocument;
  if (ownerDocument === null) return "";
  const walker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = "";
  for (let node = walker.nextNode(); node !== null && text.length < limit; node = walker.nextNode())
    text += node.nodeValue ?? "";
  return text.slice(0, limit);
}

/**
 * Whether two URLs name the same page. A single-page app rewriting its query or fragment is
 * not a navigation, and must not silently strand the picker the person is using.
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

/**
 * Whether the field a fill would land in is shown: laid out, and not hidden by a wrapper or
 * by transparency. A decoy form a script added invisibly is never the one that gets filled.
 */
function isRendered(fieldSet: LoginFieldSet): boolean {
  const field = fieldSet.passwordField ?? fieldSet.usernameField;
  return field !== null && field.getClientRects().length > 0 && isDrawn(field);
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
  /** A username for the sign-up form's username field, once the background has answered. */
  suggestedUsername: string | null;
  /** Whether the picker may offer a fresh @duck.com address as well. */
  duckAvailable: boolean;
  state: LoginPickerState;
  suggestions: readonly LoginPickerSuggestion[];
  /** What the person typed into the field since the picker opened; a prefill does not count. */
  filter: string;
  typed: boolean;
  activeIndex: number;
};

const SIGNUP_WORDS =
  /\b(?:sign\s?up|create (?:an? |your )?account|register|registration|join|get started)\b/iu;

/**
 * Whether this field set is where a password gets chosen rather than entered: the browser's
 * own new-password hint, a confirm field beside it, or a form that calls itself a sign-up.
 * Returns the fields a chosen password must go into.
 */
function signupFieldsOf(fieldSet: LoginFieldSet): HTMLInputElement[] | null {
  const password = fieldSet.passwordField;
  if (password === null) return null;
  const isCurrent = (field: HTMLInputElement) => field.autocomplete === "current-password";
  const isNew = (field: HTMLInputElement) => field.autocomplete === "new-password";
  // The current password is entered, never chosen: nothing is suggested for it.
  if (isCurrent(password)) return null;
  const scope = signupScopeOf(password, fieldSet.form);
  // Shown fields only, failing open where checkVisibility is missing (older engines, tests).
  const passwords = Array.from(
    scope.querySelectorAll<HTMLInputElement>('input[type="password"]'),
  ).filter(
    (field) =>
      !field.disabled && (typeof field.checkVisibility !== "function" || field.checkVisibility()),
  );
  const hinted = isNew(password);
  // New + confirm beside each other, with the current password (if any) left out.
  let chosen = passwords.filter((field) => !isCurrent(field));
  // Three password fields and no hints are a change-password form: current, new, confirm.
  // The first is entered, never chosen, so nothing is suggested for it and it is never written.
  if (!hinted && chosen.length >= 3) {
    if (chosen[0] === password) return null;
    chosen = chosen.slice(1);
  }
  const confirmBeside = chosen.length >= 2 && chosen.includes(password);
  // Only what names the form: its heading, legend or submit label. The whole text would
  // match every sign-in form's "Don't have an account? Sign up" line.
  const form = fieldSet.form;
  const naming = [
    form?.querySelector("h1, h2, h3, legend")?.textContent,
    form?.querySelector('button:not([type="button"]):not([type="reset"]), input[type="submit"]')
      ?.textContent,
    form?.querySelector<HTMLInputElement>('input[type="submit"]')?.value,
  ]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .slice(0, 500);
  if (!hinted && !confirmBeside && !SIGNUP_WORDS.test(naming)) return null;
  const twins = passwords.filter(
    (field) => field === password || isNew(field) || (confirmBeside && chosen.includes(field)),
  );
  return twins.length > 0 ? twins : [password];
}

/**
 * The fields a chosen password belongs with. A form bounds them; without one, the nearest
 * ancestor that holds a second password field (new + confirm) does, so a page that shows
 * sign-in and sign-up side by side never pools them.
 */
function signupScopeOf(password: HTMLInputElement, form: HTMLFormElement | null): ParentNode {
  if (form !== null) return form;
  let node: HTMLElement | null = password.parentElement;
  for (let depth = 0; node !== null && depth < 6; depth += 1) {
    if (node.querySelectorAll('input[type="password"]').length >= 2) return node;
    node = node.parentElement;
  }
  return password.parentElement ?? password.ownerDocument;
}

const PROVIDER_PAGE_HINT =
  /\b(?:continue|sign\s?in|log\s?in)\s+with\s+(?:google|apple|microsoft|github|facebook|amazon|linkedin|slack)\b/iu;

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
  // Mutations inside a shadow root are invisible to an observer on the document: every open
  // root the scan enters is watched on its own, once.
  const watchedShadowRoots = new WeakSet<ShadowRoot>();
  // The observer keeps every root it watches alive, so the count is capped: a page that
  // creates and drops components all day watches the first roots it showed, not all of them.
  // Attributes are watched as on the document; class and style churn (a hover on a web
  // component) would otherwise rescan the whole page every time.
  let watchedShadowRootCount = 0;
  const watchShadowRoot = (root: ShadowRoot): void => {
    if (observer === null || watchedShadowRoots.has(root)) return;
    if (watchedShadowRootCount >= MAX_WATCHED_SHADOW_ROOTS) return;
    watchedShadowRootCount += 1;
    watchedShadowRoots.add(root);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["type", "autocomplete"],
    });
  };
  let rescanScheduled = false;
  let owner: Owner | null = null;
  let host: PickerHandle | null = null;
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
  const bannerAsked = new WeakSet<WeakKey>();
  /** Keys answered "not now" (locked, say); the next focus on the page asks about them afresh. */
  const askAgainOnFocus = new Set<WeakKey>();
  // A "show password" toggle flips a password field to text; remembering the field keeps it
  // a login field.
  const seenPasswordFields = new WeakSet<HTMLInputElement>();

  const owns = (candidate: Owner): boolean =>
    !disposed &&
    owner?.token === candidate.token &&
    candidate.input.isConnected &&
    samePage(options.window.location.href, candidate.url) &&
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
    pickerRequest = null;
    closeHost();
    if (restoreFocus && previousInput !== null && previousInput.isConnected) {
      previousInput.focus({ preventScroll: true });
    }
  };

  const rescan = (): void => {
    rescanScheduled = false;
    if (disposed) return;
    fieldSets = detectLoginFields(options.document, {
      previousPasswordFields: seenPasswordFields,
      onShadowRoot: watchShadowRoot,
    });
    for (const fieldSet of fieldSets) {
      if (fieldSet.passwordField !== null) seenPasswordFields.add(fieldSet.passwordField);
    }
    // A banner anchored to a field goes when the field does; one for a provider-only page stays.
    if (
      bannerHost !== null &&
      bannerFor !== null &&
      (!bannerFor.isConnected || bannerFor.getClientRects().length === 0)
    )
      closeBanner();
    maybeOfferSignIn();
  };

  // Mutations settle for a moment first: a page that re-renders continuously would otherwise
  // re-detect its fields, and ask the background about them, on every batch.
  const RESCAN_SETTLE_MS = 150;
  let rescanTimer: number | null = null;
  const scheduleRescan = (): void => {
    if (disposed || rescanScheduled) return;
    rescanScheduled = true;
    rescanTimer = options.window.setTimeout(() => {
      rescanTimer = null;
      rescan();
    }, RESCAN_SETTLE_MS);
  };

  /**
   * The chip belongs beside every login field, not only the ones ShardPass already has an
   * answer for: a site with nothing saved is exactly where a person reaches for the vault, to
   * take a generated password or to add the login. Its presence also stops saying whether
   * this site is in the vault.
   */
  const chipAvailable = (): boolean => owner !== null;

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

  /** Opens the vault at a new login, for a site the person has nothing saved for yet. */
  const addLoginForThisSite = async (candidate: Owner): Promise<void> => {
    dismissPicker(candidate);
    try {
      await options.platform.openVaultPage({ newItem: "login" });
    } catch {
      // The vault page could not be opened (the extension was reloaded); nothing else to do.
    }
  };

  const useGenerated = (view: PickerView): void => {
    const password = view.candidate.fieldSet.passwordField;
    const fields =
      signupFieldsOf(view.candidate.fieldSet) ?? (password === null ? null : [password]);
    if (view.generated === null || fields === null || !owns(view.candidate)) return;
    for (const field of fields)
      fillLoginFields(
        { usernameField: null, passwordField: field, form: null },
        "",
        view.generated,
      );
    view.candidate.input.focus({ preventScroll: true });
    closeHost();
  };

  const useSuggestedUsername = (view: PickerView): void => {
    if (view.suggestedUsername === null || !owns(view.candidate)) return;
    fillLoginFields(
      { usernameField: view.candidate.input, passwordField: null, form: null },
      view.suggestedUsername,
      "",
    );
    view.candidate.input.focus({ preventScroll: true });
    closeHost();
  };

  /** Only a sign-up form's username field asks; the answer is whatever the person configured. */
  const requestUsername = async (view: PickerView): Promise<void> => {
    try {
      const response = await options.platform.sendLoginFillMessage({
        version: 1,
        kind: "login.suggestUsername",
      });
      if (picker !== view || response.kind !== "login.usernameSuggestion") return;
      view.suggestedUsername = response.username;
      view.duckAvailable = response.duckAvailable === true;
      refreshPicker();
    } catch {
      // No suggestion is not an error the page needs to hear about.
    }
  };

  /** A forwarding address is minted only when asked for, since each one is a real mailbox. */
  const useDuckAddress = async (view: PickerView): Promise<void> => {
    try {
      const response = await options.platform.sendLoginFillMessage({
        version: 1,
        kind: "login.suggestUsername",
        source: "duck",
      });
      if (picker !== view || response.kind !== "login.usernameSuggestion") return;
      if (response.username === null) return;
      view.suggestedUsername = response.username;
      useSuggestedUsername(view);
    } catch {
      // Nothing to fill; the picker stays as it was.
    }
  };
  const pickerContent = (view: PickerView) => (
    <LoginPicker
      suggestions={view.suggestions}
      state={view.state}
      filter={view.typed ? view.filter : ""}
      activeIndex={view.activeIndex}
      suggestedUsername={
        view.suggestedUsername === null
          ? undefined
          : {
              username: view.suggestedUsername,
              onUse: () => useSuggestedUsername(view),
              onAnother: () => void requestUsername(view),
            }
      }
      onDuckAddress={
        view.duckAvailable && view.candidate.fieldSet.usernameField === view.candidate.input
          ? () => void useDuckAddress(view)
          : undefined
      }
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
      onAddLogin={
        view.state === "empty" ? () => void addLoginForThisSite(view.candidate) : undefined
      }
      domain={domainFor()}
      onClose={() => dismissPicker(view.candidate)}
      onSelect={(suggestion) => void selectSuggestion(view.candidate, suggestion)}
    />
  );

  const visibleRows = (view: PickerView): LoginPickerSuggestion[] =>
    view.state === "ready"
      ? filterSuggestions(view.suggestions, view.typed ? view.filter : "")
      : [];

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
      // Taking a row hands out a credential, so it takes a real key press: a script on the
      // page can dispatch keys at the field it owns, but it cannot press one.
      if (chosen === undefined || !event.isTrusted) return;
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
    const signup = signupFieldsOf(candidate.fieldSet) !== null;
    // Nothing saved for this site: a fresh password is the useful offer, on a sign-in form
    // as much as a sign-up one (this is where a new account gets made).
    const offerPassword =
      signup || (state === "empty" && candidate.fieldSet.passwordField !== null);
    const view: PickerView = {
      candidate,
      generated: previous?.generated ?? (offerPassword ? suggestPassword() : null),
      suggestedUsername: previous?.suggestedUsername ?? null,
      duckAvailable: previous?.duckAvailable ?? false,
      state,
      suggestions,
      filter: previous?.filter ?? "",
      typed: previous?.typed ?? false,
      activeIndex: -1,
    };
    picker = view;
    if (
      signup &&
      view.suggestedUsername === null &&
      candidate.fieldSet.usernameField === candidate.input
    )
      void requestUsername(view);
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
      if (response.kind !== "login.fillSuggestionsResult")
        return { state: "error", suggestions: [] };
      // A login that asks for the master password first is the popup's to fill, after asking.
      const suggestions = response.suggestions.filter((suggestion) => suggestion.reprompt !== true);
      return { state: suggestions.length === 0 ? "empty" : "ready", suggestions };
    } catch (error) {
      return { state: errorCode(error) === "VAULT_LOCKED" ? "locked" : "error", suggestions: [] };
    }
  };

  // The chip appears beside the field itself; what the vault holds for this site is asked
  // only when the picker opens, so nothing is fetched merely because a field took focus.
  const offerChip = (candidate: Owner): void => {
    if (chipAvailable()) showChip(candidate);
  };

  const openPicker = (candidate: Owner): void => {
    // The field, or the chip beside it once tabbed to (the host is what the document sees).
    const active = options.document.activeElement;
    if (
      !owns(candidate) ||
      (active !== candidate.input && active?.localName !== "shardpass-picker-host")
    )
      return;
    renderPicker(candidate, "busy", []);
    const request = {};
    pickerRequest = request;
    void fetchSuggestions().then((result) => {
      if (pickerRequest !== request || !owns(candidate)) return;
      renderPicker(candidate, result.state, result.suggestions);
    });
  };

  const sendConfirm = async (itemId: string, releaseId: string): Promise<void> => {
    try {
      await options.platform.sendLoginFillMessage({
        version: 1,
        kind: "login.fillConfirm",
        itemId,
        releaseId,
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
    Array.from(options.document.querySelectorAll(CAPTCHA_SELECTOR)).some(
      (element) => element.getClientRects().length > 0,
    );

  const submitForm = (fieldSet: LoginFieldSet): void => {
    const form = fieldSet.passwordField?.form ?? fieldSet.usernameField?.form ?? null;
    if (form === null || captchaPresent()) return;
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.submit();
  };

  /**
   * A provider account has nothing to fill: the page's own "Continue with Google" button is
   * pressed instead. When the page has no such button, the person is told where to look.
   */
  const signInThroughProvider = async (
    candidate: Owner | null,
    suggestion: LoginPickerSuggestion,
  ): Promise<void> => {
    const provider = suggestion.signInWith;
    if (provider === undefined) return;
    closeHost();
    bannerDismissedBy = bannerDismissedBy ?? "fill";
    closeBanner();
    const label = SIGN_IN_PROVIDER_LABELS[provider];
    const button = findProviderButton(options.document, provider);
    // The release names the login for this page and mints the confirmation's capability;
    // a refusal (the login is not for this site) still lets the person use the button.
    let releaseId: string | null = null;
    try {
      const response = await options.platform.sendLoginFillMessage({
        version: 1,
        kind: "login.fillSelect",
        itemId: suggestion.itemId,
        expectedRevision: suggestion.expectedRevision,
      });
      if (response.kind === "login.fillRelease") releaseId = response.releaseId;
    } catch {
      // Not recorded as used; the sign-in itself goes ahead.
    }
    if (releaseId !== null) void sendConfirm(suggestion.itemId, releaseId);
    if (button !== null) {
      button.focus({ preventScroll: true });
      button.click();
      return;
    }
    const notice = createPickerHost(candidate?.input ?? options.document.body, {
      positionToAnchor: true,
      slot: "notice",
      content: (
        <p className="loginNotice" role="status">
          {`This account signs in with ${label}. Use the page's ${label} button; ShardPass could not find it.`}
        </p>
      ),
    });
    options.window.setTimeout(() => notice.close(), 6_000);
  };

  const selectSuggestion = async (
    candidate: Owner,
    suggestion: LoginPickerSuggestion,
    mode: Readonly<{ submit: boolean }> = { submit: false },
  ): Promise<void> => {
    if (!owns(candidate)) return;
    if (suggestion.signInWith !== undefined) {
      void signInThroughProvider(candidate, suggestion);
      return;
    }
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
      await sendConfirm(suggestion.itemId, response.releaseId);
      if (mode.submit) submitForm(candidate.fieldSet);
      if (response.linkedOtpCode !== undefined)
        await offerOtpCode(candidate.input, response.linkedOtpCode);
    } catch (error) {
      sendCancel(suggestion.itemId);
      if (errorCode(error) === "VAULT_LOCKED" && owns(candidate)) {
        renderPicker(candidate, "locked", []);
        return;
      }
      invalidate(false);
    }
  };

  const onFocusIn = (event?: FocusEvent): void => {
    if (disposed) return;
    if (askAgainOnFocus.size > 0) {
      for (const key of askAgainOnFocus) bannerAsked.delete(key);
      askAgainOnFocus.clear();
      scheduleRescan();
    }
    if (event?.target instanceof Element && event.target.localName === "shardpass-picker-host")
      return;
    const active = deepActiveElement(options.document);
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
    offerChip(candidate);
  };

  const onPageInvalidated = (): void => invalidate(false);

  // A press anywhere but the field or the chip closes what is open, the way a menu closes;
  // a press on a non-focusable area moves no focus, so focusin alone would leave it up.
  const onPointerDownOutside = (event: MouseEvent): void => {
    if (disposed || host === null || owner === null) return;
    const target = event.target;
    if (target === owner.input) return;
    // Seen from the document the press is retargeted to the host; a listener that still sees
    // the inner element finds the host as its root's owner.
    if (target instanceof Element && target.localName === "shardpass-picker-host") return;
    const root = target instanceof Node ? target.getRootNode() : null;
    if (root instanceof ShadowRoot && root.host.localName === "shardpass-picker-host") return;
    closeHost();
  };

  /** The top frame, or a frame with room for the banner (a bank's login iframe, say). */
  const frameCanHostBanner = (): boolean => {
    try {
      if (options.window.top === options.window) return true;
    } catch {
      // Cross-origin parent: fall through to the size check.
    }
    return options.window.innerWidth >= 360 && options.window.innerHeight >= 160;
  };

  const bestSuggestion = (
    fieldSet: LoginFieldSet | null,
    suggestions: readonly LoginPickerSuggestion[],
  ) => {
    const typed = fieldSet?.usernameField?.value.trim().toLocaleLowerCase() ?? "";
    const sorted = filterSuggestions(suggestions, "");
    return (
      sorted.find((item) => typed !== "" && item.username.toLocaleLowerCase() === typed) ??
      sorted[0] ??
      null
    );
  };

  const ownerFor = (fieldSet: LoginFieldSet): Owner | null => {
    const input = fieldSet.usernameField ?? fieldSet.passwordField;
    const origin = originOf(options.window);
    if (input === null || origin === null) return null;
    return { token: Object.freeze({}), input, fieldSet, url: options.window.location.href, origin };
  };

  const signInFromBanner = async (
    fieldSet: LoginFieldSet | null,
    suggestion: LoginPickerSuggestion,
  ): Promise<void> => {
    if (bannerBusy || disposed) return;
    if (suggestion.signInWith !== undefined) {
      // A provider account needs no field: the page's own button is pressed.
      void signInThroughProvider(fieldSet === null ? null : ownerFor(fieldSet), suggestion);
      return;
    }
    if (fieldSet === null) return;
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

  const showBanner = (
    fieldSet: LoginFieldSet | null,
    suggestions: readonly LoginPickerSuggestion[],
  ): void => {
    const best = bestSuggestion(fieldSet, suggestions);
    const anchor =
      fieldSet === null
        ? options.document.body
        : (fieldSet.passwordField ?? fieldSet.usernameField);
    if (best === null || anchor === null || !options.document.body.isConnected) return;
    const render = () => (
      <SignInBanner
        name={best.name}
        username={best.username}
        otherCount={fieldSet === null ? 0 : suggestions.length - 1}
        busy={bannerBusy}
        // A username-only first step only gets the name in; the password step follows. A
        // provider account gets its own verb.
        action={
          best.signInWith !== undefined
            ? `Continue with ${SIGN_IN_PROVIDER_LABELS[best.signInWith]}`
            : fieldSet?.passwordField === null
              ? "Continue"
              : "Sign in"
        }
        onSignIn={() => void signInFromBanner(fieldSet, best)}
        onOtherOptions={() => {
          if (fieldSet !== null) otherOptions(fieldSet);
        }}
        onClose={() => {
          bannerDismissedBy = "user";
          closeBanner();
        }}
      />
    );
    bannerRender = render;
    bannerFor = anchor instanceof HTMLInputElement ? anchor : null;
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
  /** A page with provider buttons and no login fields at all ("Continue with Google" only). */
  const providerOnlyPage = (): boolean =>
    PROVIDER_PAGE_HINT.test(textPrefixOf(options.document.body, 20_000)) ||
    options.document.querySelector(
      'a[href*="accounts.google.com"], a[href*="appleid.apple.com"], a[href*="/auth/"], a[href*="/oauth"]',
    ) !== null;

  function maybeOfferSignIn(): void {
    if (disposed || bannerDismissedBy === "user" || bannerHost !== null || !frameCanHostBanner())
      return;
    // A shown form with a password first; failing that, a shown username-only first step.
    const fieldSet =
      fieldSets.find((candidate) => candidate.passwordField !== null && isRendered(candidate)) ??
      fieldSets.find((candidate) => candidate.usernameField !== null && isRendered(candidate)) ??
      null;
    const field = fieldSet === null ? null : (fieldSet.passwordField ?? fieldSet.usernameField);
    // No fields: only a page that offers provider sign-in is worth asking about, and only
    // an account that signs in through a provider whose button is on the page is offered.
    const key: WeakKey = field ?? options.document.body;
    if (fieldSet !== null && field === null) return;
    if (bannerAsked.has(key)) return;
    if (fieldSet === null && !providerOnlyPage()) return;
    bannerAsked.add(key);
    void fetchSuggestions().then((result) => {
      if (disposed || bannerDismissedBy === "user" || bannerHost !== null) return;
      if (
        result.state !== "ready" ||
        (field !== null && (!field.isConnected || !isRendered(fieldSet!)))
      ) {
        // Not now (locked, or the form went away before the answer). The key stays asked so
        // a page that keeps mutating does not keep asking; the next focus on the page, e.g.
        // after an unlock in the popup, or the field changing, asks afresh.
        askAgainOnFocus.add(key);
        return;
      }
      if (fieldSet === null) {
        const viaProvider = result.suggestions.filter(
          (item) =>
            item.signInWith !== undefined &&
            findProviderButton(options.document, item.signInWith) !== null,
        );
        if (viaProvider.length === 0) return;
        showBanner(null, viaProvider);
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
    const request = payload as {
      version?: unknown;
      kind?: unknown;
      itemId?: unknown;
      expectedRevision?: unknown;
    } | null;
    if (request?.kind !== "login.fillFromPopup") return new Promise(() => undefined);
    const meta = senderMetadata as { extensionId?: unknown; tabId?: unknown } | null;
    if (meta?.extensionId !== options.platform.extensionId || meta.tabId !== undefined)
      return Promise.resolve({ version: 1, kind: "login.fillFromPopupResult", status: "failed" });
    if (typeof request.itemId !== "string" || typeof request.expectedRevision !== "number")
      return Promise.resolve({ version: 1, kind: "login.fillFromPopupResult", status: "failed" });
    rescan();
    if (fieldSets.length === 0) return new Promise(() => undefined);
    const active = deepActiveElement(options.document);
    const focused = active instanceof HTMLInputElement ? fieldSetFor(active, fieldSets) : null;
    const fieldSet =
      (focused !== null && isRendered(focused) ? focused : null) ??
      fieldSets.find((candidate) => candidate.passwordField !== null && isRendered(candidate)) ??
      fieldSets.find(isRendered) ??
      null;
    // Only hidden forms is the same as none: say nothing. The popup hears the frame that
    // fills, or reads silence as "no form" once its own timeout passes. Answering "no-form"
    // after a delay lost the race whenever the filling frame waited longer than the delay --
    // behind a commit on a large vault, say -- and the popup contradicted a fill that happened.
    if (fieldSet === null) return new Promise(() => undefined);
    return fillFromPopup(fieldSet, request.itemId, request.expectedRevision);
  };

  /**
   * Every answer but "filled" waits a moment. A tab hands the popup's request to all of its
   * frames and the first reply wins, so a frame with nothing to fill must not get in before
   * the frame that is filling.
   */
  const answerLater = (status: "no-form" | "failed") =>
    new Promise((resolve) =>
      options.window.setTimeout(
        () => resolve({ version: 1, kind: "login.fillFromPopupResult", status }),
        NO_FORM_ANSWER_DELAY_MS,
      ),
    );

  const fillFromPopup = async (
    fieldSet: LoginFieldSet,
    itemId: string,
    expectedRevision: number,
  ) => {
    try {
      const response = await options.platform.sendLoginFillMessage({
        version: 1,
        kind: "login.fillSelect",
        itemId,
        expectedRevision,
      });
      if (response.kind !== "login.fillRelease") return answerLater("failed");
      if (response.signInWith !== undefined) {
        const button = findProviderButton(options.document, response.signInWith);
        if (button === null) return answerLater("no-form");
        button.focus({ preventScroll: true });
        button.click();
        await sendConfirm(itemId, response.releaseId);
        return { version: 1, kind: "login.fillFromPopupResult", status: "filled" };
      }
      if (!fieldsReady(fieldSet)) {
        sendCancel(itemId);
        return answerLater("no-form");
      }
      fillLoginFields(fieldSet, response.username, response.password);
      invalidate(false);
      if (bannerDismissedBy === null) bannerDismissedBy = "fill";
      closeBanner();
      await sendConfirm(itemId, response.releaseId);
      // Answer first so the popup can close; the code offer waits for focus on its own.
      const anchor = fieldSet.passwordField ?? fieldSet.usernameField;
      if (response.linkedOtpCode !== undefined && anchor !== null)
        void offerOtpCode(anchor, response.linkedOtpCode);
      return { version: 1, kind: "login.fillFromPopupResult", status: "filled" };
    } catch (error) {
      // Not this frame's login (an embedded frame on another origin): stay silent so the
      // frame that can fill answers the popup, or nobody does and it reads "no form".
      if (errorCode(error) === "LOGIN_FILL_NOT_FOUND") return new Promise<never>(() => undefined);
      sendCancel(itemId);
      return answerLater("failed");
    }
  };

  return {
    start() {
      if (started || disposed) return;
      started = true;
      // The observer exists before the first scan, so the shadow roots that scan finds are
      // watched from the start.
      const Observer = options.document.defaultView?.MutationObserver ?? MutationObserver;
      observer = new Observer(scheduleRescan);
      observer.observe(options.document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["type", "autocomplete"],
      });
      rescan();
      options.document.addEventListener("focusin", onFocusIn, true);
      options.document.addEventListener("mousedown", onPointerDownOutside, true);
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
      options.document.removeEventListener("mousedown", onPointerDownOutside, true);
      if (rescanTimer !== null) options.window.clearTimeout(rescanTimer);
      rescanTimer = null;
      rescanScheduled = false;
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
