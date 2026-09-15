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
}

const USERNAME_PATTERN = /user|email|login|account|phone|identifier|uid|uname/i;
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
  return USERNAME_PATTERN.test(haystack);
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
// report as hidden. Fall back to computed style (which jsdom *does* resolve
// from inline styles / stylesheets) so this stays testable under jsdom while
// still filtering out honeypot/decoy fields in a real browser.
/** Clip shapes that leave nothing of the element visible. */
const HIDING_CLIPS = new Set([
  "inset(50%)",
  "inset(100%)",
  "circle(0)",
  "circle(0px)",
  "circle(0%)",
  "polygon(0 0,0 0,0 0)",
  "polygon(0px 0px,0px 0px,0px 0px)",
]);

/**
 * A field a person could see. Besides display/visibility this refuses the honeypot
 * tricks: opacity 0, a clip-path that hides everything, and a box parked far off-screen.
 * Sizes are judged only when the engine reports them (jsdom reports zeros for everything).
 */
function isVisible(input: HTMLInputElement): boolean {
  if (input.type === "hidden") return false;
  const view = input.ownerDocument.defaultView;
  if (!view) return true;
  const style = view.getComputedStyle(input);
  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse")
    return false;
  const opacity = Number.parseFloat(style.opacity);
  if (Number.isFinite(opacity) && opacity <= 0) return false;
  const clip = (style.clipPath ?? "").replace(/\s+/gu, "").toLowerCase();
  if (clip !== "" && HIDING_CLIPS.has(clip)) return false;
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
  const inputs = Array.from(root.querySelectorAll<HTMLInputElement>("input"));
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
    claimedForms.add(form);
    fieldSets.push({ usernameField: input, passwordField: null, form });
  }
  return fieldSets;
}
