import "@testing-library/jest-dom/vitest";

import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { createOtpFieldEligibility } from "../../../src/content/otp/field-eligibility";
import { createOtpFieldHandleRegistry } from "../../../src/content/otp/field-handles";
import { createOtpFillAttempt, fillOtpField } from "../../../src/content/otp/fill-otp-field";

function eligible(): HTMLInputElement {
  const element = document.createElement("input");
  element.autocomplete = "one-time-code";
  document.body.append(element);
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    x: 1,
    y: 1,
    top: 1,
    left: 1,
    right: 100,
    bottom: 30,
    width: 99,
    height: 29,
    toJSON: () => ({}),
  });
  return element;
}

function setup() {
  const element = eligible();
  const registry = createOtpFieldHandleRegistry();
  const handle = registry.activate(element);
  return { element, registry, handle, eligibility: createOtpFieldEligibility(window) };
}

function fill(options: ReturnType<typeof setup>, overrides: Record<string, unknown> = {}) {
  return fillOtpField({
    input: options.element,
    fieldHandle: options.handle,
    registry: options.registry,
    eligibility: options.eligibility,
    code: "synthetic-value",
    expiresAt: Date.now() + 5_000,
    expectedUrl: window.location.href,
    expectedOrigin: window.location.origin,
    now: () => Date.now(),
    attempt: createOtpFillAttempt(),
    ...overrides,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("native OTP field fill primitive", () => {
  it("uses the owner-realm native setter and dispatches bubbling composed input then change", () => {
    const options = setup();
    const order: string[] = [];
    options.element.addEventListener("input", (event) => {
      order.push(event.type);
      expect(event.bubbles).toBe(true);
      expect(event.composed).toBe(true);
    });
    options.element.addEventListener("change", (event) => {
      order.push(event.type);
      expect(event.bubbles).toBe(true);
      expect(event.composed).toBe(true);
    });
    const pageSetter = vi.fn(() => {
      throw new Error("page setter");
    });
    const nativeGetter = Reflect.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.get;
    if (nativeGetter === undefined) throw new Error("Missing native getter");
    Object.defineProperty(options.element, "value", {
      configurable: true,
      get: nativeGetter,
      set: pageSetter,
    });
    expect(fill(options)).toEqual({ status: "filled" });
    expect(pageSetter).not.toHaveBeenCalled();
    expect(order).toEqual(["input", "change"]);
  });

  it("updates a React-style controlled tracker through the native setter", () => {
    const options = setup();
    let observed = "";
    options.element.addEventListener("input", () => {
      observed = options.element.value;
    });
    expect(fill(options)).toEqual({ status: "filled" });
    expect(observed).toBe("synthetic-value");
  });

  it("returns fixed failures for expiry, changed identity, and ineligible fields", () => {
    const expired = setup();
    expect(fill(expired, { expiresAt: Date.now() - 1 })).toEqual({ status: "expired" });
    const changed = setup();
    changed.registry.activate(eligible());
    expect(fill(changed)).toEqual({ status: "field-changed" });
    const ineligible = setup();
    ineligible.element.readOnly = true;
    expect(fill(ineligible)).toEqual({ status: "field-ineligible" });
  });

  it("fails closed when URL or origin changed", () => {
    const options = setup();
    expect(fill(options, { expectedUrl: "https://invalid.example/" })).toEqual({
      status: "field-changed",
    });
    expect(fill(options, { expectedOrigin: "https://invalid.example" })).toEqual({
      status: "field-changed",
    });
  });

  it("reports setter and event failures without reflecting exception text", () => {
    const setter = setup();
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    if (!descriptor) throw new Error("Missing native descriptor");
    vi.spyOn(window.Object, "getOwnPropertyDescriptor").mockReturnValue({
      ...descriptor,
      set: () => {
        throw new Error("sensitive setter detail");
      },
    });
    expect(fill(setter)).toEqual({ status: "setter-failed" });
    vi.restoreAllMocks();

    const event = setup();
    vi.spyOn(event.element, "dispatchEvent").mockImplementation(() => {
      throw new Error("sensitive event detail");
    });
    expect(fill(event)).toEqual({ status: "event-failed" });
  });

  it("does not retry a same-markup replacement created during events", () => {
    const options = setup();
    const replacement = options.element.cloneNode() as HTMLInputElement;
    vi.spyOn(replacement, "getBoundingClientRect").mockReturnValue(
      options.element.getBoundingClientRect(),
    );
    options.element.addEventListener("input", () => options.element.replaceWith(replacement), {
      once: true,
    });
    expect(fill(options)).toEqual({ status: "verification-failed" });
    expect(replacement.value).toBe("");
  });

  it("requires a genuine local attempt for every public invocation", () => {
    const options = setup();
    expect(fill(options, { attempt: undefined })).toEqual({ status: "field-changed" });
    expect(
      fill(options, {
        attempt: { consumed: false, consume: () => true },
      }),
    ).toEqual({ status: "field-changed" });
    expect(options.element.value).toBe("");
  });

  it.each(["focus", "setter", "event"] as const)(
    "cannot reuse a genuine attempt after a %s failure",
    (failure) => {
      const options = setup();
      const attempt = createOtpFillAttempt();
      if (failure === "focus") {
        vi.spyOn(options.element, "focus").mockImplementation(() => {
          throw new Error("focus failure");
        });
      } else if (failure === "setter") {
        const descriptor = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        );
        if (!descriptor) throw new Error("Missing native descriptor");
        vi.spyOn(window.Object, "getOwnPropertyDescriptor").mockReturnValue({
          ...descriptor,
          set: () => {
            throw new Error("setter failure");
          },
        });
      } else {
        vi.spyOn(options.element, "dispatchEvent").mockImplementation(() => {
          throw new Error("event failure");
        });
      }
      expect(fill(options, { attempt }).status).toBe(
        failure === "setter"
          ? "setter-failed"
          : failure === "event"
            ? "event-failed"
            : "field-changed",
      );
      vi.restoreAllMocks();
      expect(fill(options, { attempt })).toEqual({ status: "field-changed" });
    },
  );

  it("exposes only an opaque frozen attempt token", () => {
    const attempt = createOtpFillAttempt();
    expect(Object.isFrozen(attempt)).toBe(true);
    expect(Reflect.ownKeys(attempt)).toEqual([]);

    type Attempt = Parameters<typeof fillOtpField>[0]["attempt"];
    expectTypeOf<{ readonly consumed: boolean; consume(): boolean }>().not.toMatchTypeOf<Attempt>();
  });

  it("consumes a genuine attempt before focus", () => {
    const options = setup();
    const attempt = createOtpFillAttempt();
    let reuseResult: ReturnType<typeof fillOtpField> | undefined;
    options.element.addEventListener("focus", () => {
      reuseResult = fill(options, { attempt });
    });
    expect(fill(options, { attempt })).toEqual({ status: "filled" });
    expect(reuseResult).toEqual({ status: "field-changed" });
  });

  it("focuses the exact OTP target from a picker-like control without advancing", () => {
    const options = setup();
    const pickerControl = document.createElement("button");
    document.body.append(pickerControl);
    pickerControl.focus();
    const focus = vi.spyOn(options.element, "focus");
    expect(fill(options)).toEqual({ status: "filled" });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(options.element).toHaveFocus();
  });

  it("fails closed when a focus handler replaces the target", () => {
    const options = setup();
    const replacement = options.element.cloneNode() as HTMLInputElement;
    vi.spyOn(replacement, "getBoundingClientRect").mockReturnValue(
      options.element.getBoundingClientRect(),
    );
    options.element.addEventListener("focus", () => options.element.replaceWith(replacement), {
      once: true,
    });
    expect(fill(options)).toEqual({ status: "field-changed" });
    expect(replacement.value).toBe("");
  });

  it("fails closed when visibility changes in a focus handler before fill", () => {
    const options = setup();
    options.element.addEventListener(
      "focus",
      () => {
        options.element.style.visibility = "hidden";
      },
      { once: true },
    );
    expect(fill(options)).toEqual({ status: "field-ineligible" });
    expect(options.element.value).toBe("");
  });

  it("never submits, clicks, presses Enter, or advances focus", () => {
    const form = document.createElement("form");
    const options = setup();
    form.append(options.element);
    document.body.append(form);
    const other = document.createElement("button");
    form.append(other);
    const submit = vi.fn((event: Event) => event.preventDefault());
    const click = vi.fn();
    const keydown = vi.fn();
    form.addEventListener("submit", submit);
    other.addEventListener("click", click);
    options.element.addEventListener("keydown", keydown);
    options.element.focus();
    expect(fill(options)).toEqual({ status: "filled" });
    expect(options.element).toHaveFocus();
    expect(submit).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(keydown).not.toHaveBeenCalled();
  });

  it("spreads a code over the boxes of a segmented widget, one character each", () => {
    const wrap = document.createElement("div");
    const boxes = Array.from({ length: 6 }, () => {
      const box = document.createElement("input");
      box.setAttribute("maxlength", "1");
      box.setAttribute("inputmode", "numeric");
      vi.spyOn(box, "getBoundingClientRect").mockReturnValue({
        x: 1,
        y: 1,
        top: 1,
        left: 1,
        right: 40,
        bottom: 30,
        width: 39,
        height: 29,
        toJSON: () => ({}),
      });
      return box;
    });
    wrap.append(...boxes);
    document.body.append(wrap);
    const registry = createOtpFieldHandleRegistry();
    const first = boxes[0]!;
    const handle = registry.activate(first);
    const result = fillOtpField({
      input: first,
      fieldHandle: handle,
      registry,
      eligibility: createOtpFieldEligibility(window),
      code: "246810",
      expiresAt: Date.now() + 5_000,
      expectedUrl: window.location.href,
      expectedOrigin: window.location.origin,
      now: () => Date.now(),
      attempt: createOtpFillAttempt(),
    });
    expect(result).toEqual({ status: "filled" });
    expect(boxes.map((box) => box.value)).toEqual(["2", "4", "6", "8", "1", "0"]);
    expect(document.activeElement).toBe(boxes[5]);
  });
});

describe("the page a code was released for", () => {
  it("still fills after the page rewrote its query or fragment, and refuses another path", () => {
    const here = new URL(window.location.href);
    expect(fill(setup(), { expectedUrl: `${here.origin}${here.pathname}?step=code` })).toEqual({
      status: "filled",
    });
    expect(fill(setup(), { expectedUrl: `${here.origin}${here.pathname}#code` })).toEqual({
      status: "filled",
    });
    expect(fill(setup(), { expectedUrl: `${here.origin}/somewhere-else` })).toEqual({
      status: "field-changed",
    });
  });
});
