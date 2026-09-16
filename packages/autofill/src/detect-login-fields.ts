import { isDrawn } from "./visibility";

import { labelTextFor } from "./field-context";

export interface LoginFieldSet {
  usernameField: HTMLInputElement | null;
  /** null for a username-only step: the site asks for the password on a later step or page. */
  passwordField: HTMLInputElement | null;
  form: HTMLFormElement | null;
}

export interface DetectLoginFieldsOptions {
  /**
   * Inputs that were password fields earlier. A "show password" toggle flips the type to
   * text, and the field would otherwise vanish from detection in the middle of a login.
   */
  readonly previousPasswordFields?: Readonly<{ has(input: HTMLInputElement): boolean }> | undefined;
  /** Called for every open shadow root the scan enters, so a caller can watch it for changes. */
  readonly onShadowRoot?: ((root: ShadowRoot) => void) | undefined;
}

const MAX_SHADOW_ROOTS = 200;

/**
 * Every <input> under `root`, including those inside open shadow roots (web-component
 * login widgets), in document order per tree. Closed roots cannot be seen and are not.
 */
export function collectInputs(
  root: Document | ShadowRoot,
  onShadowRoot?: (root: ShadowRoot) => void,
): HTMLInputElement[] {
  const inputs: HTMLInputElement[] = [];
  const queue: Array<Document | ShadowRoot> = [root];
  let seen = 0;
  while (queue.length > 0) {
    const scope = queue.shift()!;
    inputs.push(...Array.from(scope.querySelectorAll<HTMLInputElement>("input")));
    for (const host of Array.from(scope.querySelectorAll<HTMLElement>("*"))) {
      const shadow = host.shadowRoot;
      if (shadow === null || seen >= MAX_SHADOW_ROOTS) continue;
      seen += 1;
      onShadowRoot?.(shadow);
      queue.push(shadow);
    }
  }
  return inputs;
}

const USERNAME_PATTERN = /user|email|login|account|phone|identifier|uid|uname/i;
/** Forms that take an email address for something other than signing in. */
const NOT_A_SIGN_IN =
  /\b(?:subscribe|subscription|newsletter|search|waitlist|notify|coupon|promo|unsubscribe|feedback|survey)\b/iu;
const TEXT_LIKE_TYPES: ReadonlySet<string> = new Set(["text", "email", "tel"]);

function autocompleteOf(input: HTMLInputElement): string {
  return (input.getAttribute("autocomplete") ?? "").trim().toLowerCase();
}

function isTextLike(input: HTMLInputElement): boolean {
  return TEXT_LIKE_TYPES.has(input.type);
}

function isUsernameCandidate(input: HTMLInputElement): boolean {
  if (input.type === "email" || input.type === "tel") return true;
  if (input.type !== "text") return false;
  const haystack = [
    input.name,
    input.id,
    input.placeholder,
    autocompleteOf(input),
    input.getAttribute("aria-label") ?? "",
  ].join(" ");
  if (USERNAME_PATTERN.test(haystack)) return true;
  // Plenty of forms name their fields only in the text beside them.
  return USERNAME_PATTERN.test(labelTextFor(input));
}

function isPasswordField(
  input: HTMLInputElement,
  previous: DetectLoginFieldsOptions["previousPasswordFields"],
): boolean {
  if (input.type === "password") return true;
  if (input.type === "hidden") return false;
  const autocomplete = autocompleteOf(input);
  if (autocomplete === "current-password" || autocomplete === "new-password") return true;
  return previous?.has(input) ?? false;
}

// jsdom does not implement layout, so `offsetParent`/`offsetWidth` always

/**
 * A field a person could see: drawn (itself and its wrappers, not only its own style), big
 * enough to be a field, and somewhere on the page. Sizes are judged only when the engine
 * reports them (jsdom reports zeros for everything).
 */
function isVisible(input: HTMLInputElement): boolean {
  if (input.type === "hidden") return false;
  const view = input.ownerDocument.defaultView;
  if (!view) return true;
  if (!isDrawn(input)) return false;
  const rect = input.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0 && rect.left === 0 && rect.top === 0) return true;
  if (rect.width < 10 || rect.height < 10) return false;
  const doc = input.ownerDocument.documentElement;
  const pageRight = Math.max(doc.scrollWidth, view.innerWidth);
  const pageBottom = Math.max(doc.scrollHeight, view.innerHeight);
  if (rect.right < 0 || rect.bottom < 0) return false;
  if (rect.left > pageRight + view.scrollX || rect.top > pageBottom + view.scrollY) return false;
  return true;
}

/**
 * Without a <form>, the password's own wrapper rarely holds the username: single-page apps
 * put each field in a div of its own. Climb a few levels to the nearest ancestor that also
 * holds another text-like field, and stop at the document otherwise.
 */
function formlessContainerOf(
  passwordField: HTMLInputElement,
  isPassword: (input: HTMLInputElement) => boolean,
): ParentNode {
  let node: HTMLElement | null = passwordField.parentElement;
  for (let depth = 0; node !== null && depth < 6; depth += 1) {
    const holdsAnother = Array.from(node.querySelectorAll<HTMLInputElement>("input")).some(
      (input) => input !== passwordField && !isPassword(input) && isTextLike(input),
    );
    if (holdsAnother) return node;
    node = node.parentElement;
  }
  return passwordField.parentElement ?? passwordField.ownerDocument;
}

function findUsernameField(
  passwordField: HTMLInputElement,
  isPassword: (input: HTMLInputElement) => boolean,
): HTMLInputElement | null {
  const form = passwordField.closest("form");
  const container = form ?? formlessContainerOf(passwordField, isPassword);
  const all = Array.from(container.querySelectorAll<HTMLInputElement>("input"));
  const others = all.filter((input) => !isPassword(input));
  const preceding = all
    .slice(0, Math.max(0, all.indexOf(passwordField)))
    .reverse()
    .filter((input) => !isPassword(input));

  const named = (input: HTMLInputElement) => isUsernameCandidate(input) && isVisible(input);
  const byName = preceding.find(named) ?? others.find(named);
  if (byName !== undefined) return byName;
  // Nothing is named like a username. The nearest visible text-like field before the password
  // is the best remaining guess: plenty of sign-in forms name their fields nothing at all.
  return preceding.find((input) => isTextLike(input) && isVisible(input)) ?? null;
}

/**
 * A newsletter box or a site search also has one email field and a button; what the form,
 * its button and the field call themselves tells them apart from a sign-in's first step.
 */
function takesEmailForSomethingElse(form: HTMLFormElement, input: HTMLInputElement): boolean {
  const submit = form.querySelector<HTMLElement>(
    'button:not([type="button"]):not([type="reset"]), input[type="submit"], input[type="image"]',
  );
  const naming = [
    form.id,
    form.getAttribute("name"),
    form.getAttribute("class"),
    form.getAttribute("action"),
    form.getAttribute("aria-label"),
    submit?.textContent,
    submit?.getAttribute("value"),
    submit?.getAttribute("aria-label"),
    input.id,
    input.getAttribute("placeholder"),
    input.getAttribute("aria-label"),
  ]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .slice(0, 1_000);
  return NOT_A_SIGN_IN.test(naming);
}

function hasSubmitControl(form: HTMLFormElement): boolean {
  return (
    form.querySelector(
      'button:not([type="button"]):not([type="reset"]), input[type="submit"], input[type="image"]',
    ) !== null
  );
}

/**
 * Every password field with its username field, followed by username-only steps: a visible
 * email or `autocomplete="username"` field in a form that has a submit control but no
 * password (the first page of a two-step sign-in). Forms with a textarea are messages, not
 * sign-ins, and are left alone.
 */
export function detectLoginFields(
  root: Document | ShadowRoot,
  options: DetectLoginFieldsOptions = {},
): LoginFieldSet[] {
  const isPassword = (input: HTMLInputElement) =>
    isPasswordField(input, options.previousPasswordFields);
  const inputs = collectInputs(root, options.onShadowRoot);
  const fieldSets: LoginFieldSet[] = inputs.filter(isPassword).map((passwordField) => ({
    usernameField: findUsernameField(passwordField, isPassword),
    passwordField,
    form: passwordField.closest("form"),
  }));

  const claimed = new Set<HTMLInputElement>();
  const claimedForms = new Set<HTMLFormElement>();
  for (const fieldSet of fieldSets) {
    if (fieldSet.usernameField !== null) claimed.add(fieldSet.usernameField);
    if (fieldSet.form !== null) claimedForms.add(fieldSet.form);
  }
  for (const input of inputs) {
    if (claimed.has(input) || isPassword(input)) continue;
    if (input.type !== "email" && autocompleteOf(input) !== "username") continue;
    const form = input.form;
    if (form === null || claimedForms.has(form) || !isVisible(input)) continue;
    if (!hasSubmitControl(form) || form.querySelector("textarea") !== null) continue;
    if (takesEmailForSomethingElse(form, input)) continue;
    claimedForms.add(form);
    fieldSets.push({ usernameField: input, passwordField: null, form });
  }
  return fieldSets;
}
