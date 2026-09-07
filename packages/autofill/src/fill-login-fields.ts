import type { LoginFieldSet } from "./detect-login-fields";

function setNativeValue(el: HTMLInputElement, value: string): void {
  // Bypass React/Vue/etc. controlled-input state by writing through the
  // native property setter before dispatching the input/change events the
  // framework listens for. Setting `el.value` directly would be intercepted
  // by the framework's own setter and silently discarded.
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  if (descriptor?.set) descriptor.set.call(el, value);
  else el.value = value;
}

/**
 * Sets the value and then tells the page about it the way typing would: focus, a key going
 * down, beforeinput and input carrying the text, the key coming up, change, and -- when the
 * field was not the one being typed in -- blur, so validation that waits for a field to be
 * left runs too. No key names are sent; the events only carry the value itself.
 */
function fillLikeTyping(el: HTMLInputElement, value: string): void {
  const wasFocused = el.ownerDocument.activeElement === el;
  if (!wasFocused) el.dispatchEvent(new FocusEvent("focus"));
  el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true }));
  el.dispatchEvent(
    new InputEvent("beforeinput", {
      inputType: "insertText",
      data: value,
      bubbles: true,
      cancelable: true,
    }),
  );
  setNativeValue(el, value);
  el.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: value, bubbles: true }));
  el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  if (!wasFocused) el.dispatchEvent(new FocusEvent("blur"));
}

/** A username-only step (no password field) gets just the username. */
export function fillLoginFields(fieldSet: LoginFieldSet, username: string, password: string): void {
  if (fieldSet.usernameField && username) {
    fillLikeTyping(fieldSet.usernameField, username);
  }
  if (fieldSet.passwordField) fillLikeTyping(fieldSet.passwordField, password);
}
