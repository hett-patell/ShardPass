import "@testing-library/jest-dom/vitest";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createOtpFieldEligibility } from "../../../src/content/otp/field-eligibility";

function input(attributes: Record<string, string> = {}): HTMLInputElement {
  const element = document.createElement("input");
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  document.body.append(element);
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    x: 20,
    y: 20,
    top: 20,
    left: 20,
    right: 140,
    bottom: 52,
    width: 120,
    height: 32,
    toJSON: () => ({}),
  });
  return element;
}

function labeled(text: string, attributes: Record<string, string> = {}): HTMLInputElement {
  const label = document.createElement("label");
  label.textContent = text;
  const element = input(attributes);
  label.append(element);
  document.body.append(label);
  return element;
}

const eligibility = () => createOtpFieldEligibility(window);

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("OTP field eligibility", () => {
  it("accepts the explicit standard signal despite weak negative wording", () => {
    expect(
      eligibility().isEligible(labeled("Account PIN", { autocomplete: "one-time-code" })),
    ).toBe(true);
  });

  it.each([
    "One-time code",
    "OTP",
    "Verification code",
    "Authentication code",
    "2FA code",
    "MFA token",
  ])("accepts recognized bounded context: %s", (text) =>
    expect(eligibility().isEligible(labeled(text))).toBe(true),
  );

  it("requires a separate verification signal for a numeric 4–8 shape", () => {
    expect(
      eligibility().isEligible(labeled("Verification", { inputmode: "numeric", maxlength: "6" })),
    ).toBe(true);
    expect(eligibility().isEligible(input({ inputmode: "numeric", maxlength: "6" }))).toBe(false);
    expect(
      eligibility().isEligible(labeled("Verification", { inputmode: "numeric", maxlength: "9" })),
    ).toBe(false);
  });

  it.each([
    "PIN",
    "ZIP",
    "Postal",
    "CVV",
    "Card security",
    "Phone",
    "Account number",
    "Coupon",
    "Search",
    "Date",
    "Year",
    "Quantity",
  ])("rejects weak false-positive context: %s", (text) =>
    expect(eligibility().isEligible(labeled(`${text} verification code`))).toBe(false),
  );

  it("uses bounded aria context and immediately reflects changes", () => {
    const description = document.createElement("span");
    description.id = "otp-help";
    description.textContent = "Enter your one-time code";
    document.body.append(description);
    const element = input({ "aria-describedby": description.id });
    expect(eligibility().isEligible(element)).toBe(true);
    description.textContent = "ordinary profile value";
    expect(eligibility().isEligible(element)).toBe(false);
  });

  it("does not accept page shadow-tree fields", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = host.attachShadow({ mode: "open" });
    const element = document.createElement("input");
    element.autocomplete = "one-time-code";
    root.append(element);
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      x: 1,
      y: 1,
      top: 1,
      left: 1,
      right: 2,
      bottom: 2,
      width: 1,
      height: 1,
      toJSON: () => ({}),
    });
    expect(eligibility().isEligible(element)).toBe(false);
  });

  it("rejects hidden, transparent, inert, disabled, read-only, zero-size, offscreen, and unsupported fields", () => {
    const cases = [
      input({ autocomplete: "one-time-code", type: "hidden" }),
      input({ autocomplete: "one-time-code", disabled: "" }),
      input({ autocomplete: "one-time-code", readonly: "" }),
      input({ autocomplete: "one-time-code", type: "checkbox" }),
      input({ autocomplete: "one-time-code", style: "display:none" }),
      input({ autocomplete: "one-time-code", style: "visibility:hidden" }),
      input({ autocomplete: "one-time-code", style: "opacity:0" }),
      input({ autocomplete: "one-time-code", style: "pointer-events:none" }),
    ];
    const inertParent = document.createElement("div");
    inertParent.setAttribute("inert", "");
    const inertInput = input({ autocomplete: "one-time-code" });
    inertParent.append(inertInput);
    document.body.append(inertParent);
    cases.push(inertInput);
    const zero = input({ autocomplete: "one-time-code" });
    vi.spyOn(zero, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    });
    cases.push(zero);
    const offscreen = input({ autocomplete: "one-time-code" });
    vi.spyOn(offscreen, "getBoundingClientRect").mockReturnValue({
      x: -20,
      y: -20,
      top: -20,
      left: -20,
      right: -1,
      bottom: -1,
      width: 19,
      height: 19,
      toJSON: () => ({}),
    });
    cases.push(offscreen);
    expect(cases.every((element) => !eligibility().isEligible(element))).toBe(true);
  });

  it("rejects effective ancestor opacity and owner-realm disabled fieldset state", () => {
    const transparent = document.createElement("div");
    transparent.style.opacity = "0";
    const transparentInput = input({ autocomplete: "one-time-code" });
    transparent.append(transparentInput);
    document.body.append(transparent);

    const fieldset = document.createElement("fieldset");
    fieldset.disabled = true;
    const disabledInput = input({ autocomplete: "one-time-code" });
    fieldset.append(disabledInput);
    document.body.append(fieldset);

    expect(eligibility().isEligible(transparentInput)).toBe(false);
    expect(eligibility().isEligible(disabledInput)).toBe(false);
  });

  it("rejects a field fully clipped by a light-DOM overflow ancestor", () => {
    const clippingParent = document.createElement("div");
    clippingParent.style.overflow = "hidden";
    const element = input({ autocomplete: "one-time-code" });
    clippingParent.append(element);
    document.body.append(clippingParent);
    vi.spyOn(clippingParent, "getBoundingClientRect").mockReturnValue({
      x: 200,
      y: 200,
      top: 200,
      left: 200,
      right: 250,
      bottom: 250,
      width: 50,
      height: 50,
      toJSON: () => ({}),
    });

    expect(eligibility().isEligible(element)).toBe(false);
  });

  it("rejects fields inside the extension host", () => {
    const host = document.createElement("shardpass-picker-host");
    document.body.append(host);
    const element = input({ autocomplete: "one-time-code" });
    host.append(element);
    expect(eligibility().isEligible(element)).toBe(false);
  });

  it("uses owner-realm constructors and styles", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const frameWindow = frame.contentWindow;
    const frameDocument = frame.contentDocument;
    if (!frameWindow || !frameDocument) throw new Error("Missing frame realm");
    const element = frameDocument.createElement("input");
    element.autocomplete = "one-time-code";
    frameDocument.body.append(element);
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      x: 1,
      y: 1,
      top: 1,
      left: 1,
      right: 80,
      bottom: 20,
      width: 79,
      height: 19,
      toJSON: () => ({}),
    });
    expect(createOtpFieldEligibility(frameWindow).isEligible(element)).toBe(true);
  });
});
