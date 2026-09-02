import { createPickerHost } from "../../../apps/extension/src/content/createPickerHost";

declare global {
  interface Window {
    __shardpassPickerRoot?: ShadowRoot;
  }
}

const controls = new URL(window.location.href).searchParams;
const pickerEnabled = controls.get("picker") !== "off";
const testHeading = controls.get("pickerHeading");
const testOrigin = controls.get("pickerOrigin");
const testStatus = controls.get("pickerStatus");
const anchor = document.querySelector<HTMLElement>("#foundation-email");
if (anchor === null) throw new Error("Picker harness anchor is missing.");
if (controls.get("focusAnchor") === "on") anchor.focus();

// The harness deliberately captures the native method before temporary instrumentation.
// eslint-disable-next-line @typescript-eslint/unbound-method
const nativeAttachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function attachShadow(init: ShadowRootInit): ShadowRoot {
  const shadow = nativeAttachShadow.call(this, init);
  if (this.localName === "shardpass-picker-host") {
    Object.defineProperty(window, "__shardpassPickerRoot", { value: shadow, configurable: true });
  }
  return shadow;
};

try {
  if (pickerEnabled) createPickerHost(anchor);
  const shadow = window.__shardpassPickerRoot;
  if (shadow !== undefined) {
    const heading = shadow.querySelector<HTMLElement>(".eyebrow");
    const origin = shadow.querySelector<HTMLElement>(".originValue");
    const status = shadow.querySelector<HTMLElement>(".status");
    if (heading !== null && testHeading !== null) heading.textContent = testHeading;
    if (origin !== null && testOrigin !== null) {
      origin.textContent = testOrigin;
      origin.title = testOrigin;
      origin.setAttribute("aria-label", `Origin: ${testOrigin}`);
    }
    if (status !== null && testStatus !== null) status.textContent = testStatus;
  }
} finally {
  Element.prototype.attachShadow = nativeAttachShadow;
}
