export interface LoginFieldSet {
  usernameField: HTMLInputElement | null;
  passwordField: HTMLInputElement;
  form: HTMLFormElement | null;
}

const USERNAME_PATTERN = /user|email|login|account|phone|identifier|uid|uname/i;

function isUsernameCandidate(input: HTMLInputElement): boolean {
  if (input.type === "email") return true;
  if (input.type !== "text") return false;
  const haystack = [
    input.name,
    input.id,
    input.placeholder,
    input.autocomplete,
    input.getAttribute("aria-label") ?? "",
  ].join(" ");
  return USERNAME_PATTERN.test(haystack);
}

// jsdom does not implement layout, so `offsetParent`/`offsetWidth` always
// report as hidden. Fall back to computed style (which jsdom *does* resolve
// from inline styles / stylesheets) so this stays testable under jsdom while
// still filtering out honeypot/decoy fields in a real browser.
function isVisible(input: HTMLInputElement): boolean {
  if (input.type === "hidden") return false;
  const view = input.ownerDocument.defaultView;
  if (!view) return true;
  const style = view.getComputedStyle(input);
  return style.display !== "none" && style.visibility !== "hidden";
}

function findUsernameField(passwordField: HTMLInputElement): HTMLInputElement | null {
  const form = passwordField.closest("form");
  const container = form ?? passwordField.parentElement ?? passwordField.ownerDocument;
  const inputs = Array.from(container.querySelectorAll<HTMLInputElement>("input"));
  const pwIdx = inputs.indexOf(passwordField);

  for (let i = pwIdx - 1; i >= 0; i--) {
    const candidate = inputs[i];
    if (candidate && isUsernameCandidate(candidate) && isVisible(candidate)) {
      return candidate;
    }
  }

  for (const input of inputs) {
    if (input !== passwordField && isUsernameCandidate(input) && isVisible(input)) {
      return input;
    }
  }

  return null;
}

export function detectLoginFields(root: Document | ShadowRoot): LoginFieldSet[] {
  const passwordFields = Array.from(
    root.querySelectorAll<HTMLInputElement>('input[type="password"]'),
  );

  return passwordFields.map((passwordField) => ({
    usernameField: findUsernameField(passwordField),
    passwordField,
    form: passwordField.closest("form"),
  }));
}
