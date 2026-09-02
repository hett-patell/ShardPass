import type { LoginFieldSet } from "./detect-login-fields";

function setNativeValue(el: HTMLInputElement, value: string): void {
  // Bypass React/Vue/etc. controlled-input state by writing through the
  // native property setter before dispatching the input/change events the
  // framework listens for. Setting `el.value` directly would be intercepted
  // by the framework's own setter and silently discarded.
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  if (descriptor?.set) descriptor.set.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export function fillLoginFields(fieldSet: LoginFieldSet, username: string, password: string): void {
  if (fieldSet.usernameField && username) {
    setNativeValue(fieldSet.usernameField, username);
  }
  setNativeValue(fieldSet.passwordField, password);
}
