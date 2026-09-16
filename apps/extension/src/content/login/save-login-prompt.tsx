import { detectLoginFields, type LoginFieldSet } from "@shardpass/autofill";
import { deepEventTarget } from "../deep-active-element";
import type { LoginFillRequest, LoginFillResponse } from "@shardpass/messaging";

import type { LoginFillContentPlatform } from "../../platform/extension-platform";
import { createPickerHost, type PickerHandle } from "../createPickerHost";

export interface SaveLoginPrompt {
  start(): void;
  dispose(): void;
}

/** "locked": the vault could not say what it holds; only "Not now" is on offer. */
type BannerMode = "new" | "update" | "locked";

type OfferSummary = Readonly<{
  offerId: string;
  domain: string;
  username: string;
  mode: BannerMode;
  existingName: string | undefined;
}>;

type PendingOffer = NonNullable<
  Extract<LoginFillResponse, { kind: "login.pendingOfferResult" }>["offer"]
>;

/** The offer being handled: in flight (no id yet), shown, or hidden until the page settles. */
type Entry = { readonly token: object; offerId: string | null; mode: BannerMode | null };

/** How long "Saved to ShardPass" stays on screen. */
const CONFIRMATION_MS = 2_500;

function modeOf(existing: PendingOffer["existing"]): BannerMode {
  if (existing === "different-password") return "update";
  return existing === "locked" ? "locked" : "new";
}

function SaveLoginBanner(
  props: Readonly<{
    summary: OfferSummary;
    busy: boolean;
    onSave: () => void;
    onDismiss: () => void;
    onFocusChange: (inside: boolean) => void;
  }>,
) {
  const { summary } = props;
  const title =
    summary.mode === "update"
      ? `Update password for ${summary.existingName ?? summary.domain}?`
      : summary.mode === "locked"
        ? "Unlock ShardPass to save this login"
        : "Save this login?";
  return (
    <section
      className="saveBanner"
      role="region"
      aria-label="ShardPass save login prompt"
      onFocus={() => props.onFocusChange(true)}
      onBlur={() => props.onFocusChange(false)}
    >
      <div className="headingRow">
        <div>
          <p className="eyebrow">SHARDPASS / SAVE LOGIN</p>
          <h2 className="title">{title}</h2>
        </div>
        <button
          className="closeButton"
          type="button"
          aria-label="Dismiss save prompt"
          onClick={props.onDismiss}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <p className="saveDetail">
        <span className="saveUsername" title={summary.username}>
          {summary.username === "" ? "(no username)" : summary.username}
        </span>
        <span className="saveDomain">{summary.domain}</span>
      </p>
      <div className="saveActions">
        {summary.mode === "locked" ? null : (
          <button type="button" className="saveButton" disabled={props.busy} onClick={props.onSave}>
            {summary.mode === "update" ? "Update password" : "Save new login"}
          </button>
        )}
        <button type="button" className="dismissButton" onClick={props.onDismiss}>
          Not now
        </button>
      </div>
    </section>
  );
}

/** A control that submits: a button without a type is one, a "Show password" type=button is not. */
function isSubmitControl(element: Element): element is HTMLButtonElement | HTMLInputElement {
  if (element instanceof HTMLButtonElement) return element.type === "submit";
  return (
    element instanceof HTMLInputElement && (element.type === "submit" || element.type === "image")
  );
}

function autocompleteOf(input: HTMLInputElement): string {
  return (input.getAttribute("autocomplete") ?? "").trim().toLowerCase();
}

/**
 * Watches sign-ins for a username/password pair and offers to keep it. The background holds
 * the credential as an offer, bound to this tab, and says what the vault already has for this
 * host and username: nothing (offer "save new"), the same password (say nothing), or a
 * different one (offer "update"). Several accounts on one site are simply several logins
 * with different usernames.
 *
 * A submission is noticed on the form's submit event, on a click of its submit control and on
 * Enter in the password field, since many sites navigate before a submit event ever fires.
 * The offer outlives the page: the landing page asks the background for it and shows the
 * banner there.
 */
/**
 * A short digest of a credential, so the prompt remembers what it already offered on this
 * page without keeping the password itself in memory for the page's lifetime. A collision
 * only means one credential goes unoffered.
 */
function fingerprint(username: string, password: string): string {
  const text = `${username}\u0000${password}`;
  let low = 0x811c9dc5;
  let high = 0x01000193;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    low = Math.imul(low ^ unit, 0x01000193);
    high = Math.imul(high ^ unit, 0x2f2f2f2f) ^ (high >>> 13);
  }
  return `${(low >>> 0).toString(16)}-${(high >>> 0).toString(16)}`;
}

export function createSaveLoginPrompt(
  options: Readonly<{
    document: Document;
    window: Window;
    platform: LoginFillContentPlatform;
  }>,
): SaveLoginPrompt {
  let started = false;
  let disposed = false;
  let host: PickerHandle | null = null;
  let current: Entry | null = null;
  let pendingProbe: object | null = null;
  let bannerFocused = false;
  let confirmationTimer: number | null = null;
  /** The last username typed on this page, for a step or form that shows no username field. */
  let lastUsername = "";
  const offered = new Set<string>();
  const seenPasswordFields = new WeakSet<HTMLInputElement>();

  const fieldSetsNow = (): LoginFieldSet[] => {
    const fieldSets = detectLoginFields(options.document, {
      previousPasswordFields: seenPasswordFields,
    });
    for (const fieldSet of fieldSets) {
      if (fieldSet.passwordField !== null) seenPasswordFields.add(fieldSet.passwordField);
    }
    return fieldSets;
  };

  const clearConfirmation = (): void => {
    if (confirmationTimer !== null) options.window.clearTimeout(confirmationTimer);
    confirmationTimer = null;
  };

  const closeHost = (): void => {
    clearConfirmation();
    const target = host;
    host = null;
    bannerFocused = false;
    target?.close();
  };

  const send = (request: LoginFillRequest) => options.platform.sendLoginFillMessage(request);

  const dismiss = (): void => {
    const offerId = current?.offerId ?? null;
    current = null;
    closeHost();
    if (offerId !== null)
      void send({ version: 1, kind: "login.saveDismiss", offerId }).catch(() => undefined);
  };

  const showConfirmation = (text: string): void => {
    closeHost();
    if (disposed || !options.document.body.isConnected) return;
    host = createPickerHost(options.document.body, {
      positionToAnchor: false,
      slot: "banner",
      content: (
        <p className="loginNotice" role="status">
          {text}
        </p>
      ),
    });
    confirmationTimer = options.window.setTimeout(closeHost, CONFIRMATION_MS);
  };

  const showBanner = (entry: Entry, summary: OfferSummary): void => {
    if (disposed || current !== entry || !options.document.body.isConnected) return;
    closeHost();
    if (current !== entry) return;
    entry.mode = summary.mode;
    let busy = false;
    const save = (): void => {
      if (busy || summary.mode === "locked") return;
      busy = true;
      void send({
        version: 1,
        kind: "login.saveConfirm",
        offerId: summary.offerId,
        choice: summary.mode,
      })
        .then((response) => {
          if (current !== entry) return;
          current = null;
          showConfirmation(
            response.kind === "login.saveResult" && response.saved === "updated"
              ? "Password updated"
              : "Saved to ShardPass",
          );
        })
        .catch((error: unknown) => {
          if (current !== entry) return;
          if (errorCode(error) === "VAULT_LOCKED") {
            showBanner(entry, { ...summary, mode: "locked" });
            return;
          }
          current = null;
          closeHost();
        });
    };
    host = createPickerHost(options.document.body, {
      positionToAnchor: false,
      slot: "banner",
      // Escape inside the banner is a "not now"; elsewhere on the page it only hides the banner
      // (the page keeps its own Escape) and the offer stays held.
      onRequestClose: () => {
        if (bannerFocused) dismiss();
        else closeHost();
      },
      content: (
        <SaveLoginBanner
          summary={summary}
          busy={busy}
          onSave={save}
          onDismiss={dismiss}
          onFocusChange={(inside) => {
            bannerFocused = inside;
          }}
        />
      ),
    });
  };

  const summaryOf = (offer: PendingOffer): OfferSummary => ({
    offerId: offer.offerId,
    domain: offer.domain,
    username: offer.username,
    mode: modeOf(offer.existing),
    existingName: offer.existingName,
  });

  /** Asks for the offer held for this tab and shows it, unless it is already on screen. */
  const requestPending = (): void => {
    if (disposed) return;
    const probe = {};
    pendingProbe = probe;
    void send({ version: 1, kind: "login.pendingOffer" })
      .then((response) => {
        if (disposed || pendingProbe !== probe || response.kind !== "login.pendingOfferResult")
          return;
        const offer = response.offer;
        if (offer === null) {
          if (current !== null && current.offerId !== null) {
            // Consumed, dismissed or expired elsewhere: nothing to keep showing.
            current = null;
            closeHost();
          }
          return;
        }
        const mode = modeOf(offer.existing);
        if (current?.offerId === offer.offerId && current.mode === mode && host?.status === "open")
          return;
        const entry: Entry = { token: {}, offerId: offer.offerId, mode: null };
        current = entry;
        showBanner(entry, summaryOf(offer));
      })
      .catch(() => undefined);
  };

  const offer = (username: string, password: string): void => {
    const key = fingerprint(username, password);
    if (offered.has(key)) return;
    offered.add(key);
    const domain = options.window.location.hostname;
    const entry: Entry = { token: {}, offerId: null, mode: null };
    current = entry;
    void send({ version: 1, kind: "login.saveOffer", domain, username, password })
      .then((response) => {
        if (current !== entry || response.kind !== "login.saveOfferResult") return;
        if (response.existing === "same") {
          current = null;
          closeHost();
          return;
        }
        entry.offerId = response.offerId;
        showBanner(entry, {
          offerId: response.offerId,
          domain,
          username,
          mode: modeOf(response.existing),
          existingName: response.existingName,
        });
      })
      .catch(() => {
        if (current === entry) current = null;
      });
  };

  /**
   * Picks the credential a submission carries: the field marked as a new password when there
   * is one (a change-password form), else the last filled password (the confirmation on such
   * a form, or the only one on a sign-in). A form without a username field gets the last
   * username typed on this page.
   */
  const snapshot = (candidates: readonly LoginFieldSet[]): void => {
    const filled = candidates.filter(
      (fieldSet): fieldSet is LoginFieldSet & { passwordField: HTMLInputElement } =>
        fieldSet.passwordField !== null && fieldSet.passwordField.value !== "",
    );
    const chosen =
      filled.find((fieldSet) => autocompleteOf(fieldSet.passwordField) === "new-password") ??
      filled[filled.length - 1];
    if (chosen === undefined) return;
    const typed = (fieldSet: LoginFieldSet) => fieldSet.usernameField?.value.trim() ?? "";
    const username =
      typed(chosen) || filled.map(typed).find((value) => value !== "") || lastUsername;
    offer(username, chosen.passwordField.value);
  };

  const snapshotForm = (form: HTMLFormElement): void => {
    snapshot(fieldSetsNow().filter((fieldSet) => fieldSet.form === form));
  };

  const ownsElement = (target: unknown): target is Element =>
    target instanceof Element && target.ownerDocument.defaultView === options.window;

  const handleSubmit = (event: Event): void => {
    const target = deepEventTarget(event);
    if (disposed || !ownsElement(target) || !(target instanceof HTMLFormElement)) return;
    snapshotForm(target);
  };

  const handleClick = (event: Event): void => {
    const target = deepEventTarget(event);
    if (disposed || !ownsElement(target)) return;
    const control = target.closest("button, input");
    if (control === null || !isSubmitControl(control)) return;
    const form = control.form;
    if (form !== null) snapshotForm(form);
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    const target = deepEventTarget(event);
    if (disposed || event.key !== "Enter" || !ownsElement(target)) return;
    if (!(target instanceof HTMLInputElement)) return;
    const fieldSets = fieldSetsNow();
    const own = fieldSets.find((fieldSet) => fieldSet.passwordField === target);
    if (own === undefined) return;
    snapshot(
      own.form === null ? [own] : fieldSets.filter((fieldSet) => fieldSet.form === own.form),
    );
  };

  // Typing runs a full field scan at most every so often: a search box or a comment field
  // would otherwise re-detect the page's login fields on every keystroke.
  let scanCache: { at: number; fieldSets: LoginFieldSet[] } | null = null;
  const fieldSetsRecent = (): LoginFieldSet[] => {
    const now = Date.now();
    if (scanCache === null || now - scanCache.at > 500)
      scanCache = { at: now, fieldSets: fieldSetsNow() };
    return scanCache.fieldSets;
  };
  const handleInput = (event: Event): void => {
    const target = deepEventTarget(event);
    if (disposed || !ownsElement(target)) return;
    if (!(target instanceof HTMLInputElement) || target.value.trim() === "") return;
    if (target.type !== "text" && target.type !== "email" && target.type !== "tel") return;
    if (fieldSetsRecent().some((fieldSet) => fieldSet.usernameField === target))
      lastUsername = target.value.trim();
  };

  // A hash or history navigation closes every host; a banner still held comes back after it.
  const handleNavigation = (): void => requestPending();

  // The popup closing after an unlock hands focus back to the page: a locked banner asks again.
  const handleFocus = (): void => {
    if (current?.mode === "locked") requestPending();
  };

  return {
    start() {
      if (started || disposed) return;
      started = true;
      options.document.addEventListener("submit", handleSubmit, true);
      options.document.addEventListener("click", handleClick, true);
      options.document.addEventListener("keydown", handleKeyDown, true);
      options.document.addEventListener("input", handleInput, true);
      options.window.addEventListener("hashchange", handleNavigation);
      options.window.addEventListener("popstate", handleNavigation);
      options.window.addEventListener("focus", handleFocus);
      requestPending();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      started = false;
      options.document.removeEventListener("submit", handleSubmit, true);
      options.document.removeEventListener("click", handleClick, true);
      options.document.removeEventListener("keydown", handleKeyDown, true);
      options.document.removeEventListener("input", handleInput, true);
      options.window.removeEventListener("hashchange", handleNavigation);
      options.window.removeEventListener("popstate", handleNavigation);
      options.window.removeEventListener("focus", handleFocus);
      current = null;
      closeHost();
    },
  };
}

function errorCode(error: unknown): unknown {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return (error as { readonly code?: unknown }).code;
}
