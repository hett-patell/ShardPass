import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createOtpFieldDiscovery,
  OTP_DISCOVERY_LIMITS,
} from "../../../src/content/otp/field-discovery";

function visible(element: HTMLInputElement): void {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    x: 4,
    y: 4,
    top: 4,
    left: 4,
    right: 104,
    bottom: 28,
    width: 100,
    height: 24,
    toJSON: () => ({}),
  });
}

function addOtp(): HTMLInputElement {
  const element = document.createElement("input");
  element.autocomplete = "one-time-code";
  document.body.append(element);
  visible(element);
  return element;
}

async function settle(): Promise<void> {
  await vi.runAllTimersAsync();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("bounded OTP field discovery", () => {
  it("initially discovers connected eligible light-DOM fields and caps the snapshot", () => {
    const fields = Array.from(
      { length: OTP_DISCOVERY_LIMITS.maxDiscoveredFieldsPerFrame + 5 },
      addOtp,
    );
    const discovery = createOtpFieldDiscovery({ document, window });
    discovery.start();
    expect(discovery.snapshot()).toHaveLength(OTP_DISCOVERY_LIMITS.maxDiscoveredFieldsPerFrame);
    expect(discovery.snapshot()[0]).toBe(fields[0]);
    discovery.dispose();
  });

  it("coalesces insertion, removal, and relevant attribute mutations", async () => {
    vi.useFakeTimers();
    const discovery = createOtpFieldDiscovery({ document, window });
    discovery.start();
    const element = addOtp();
    element.setAttribute("aria-label", "Verification code");
    element.setAttribute("inputmode", "numeric");
    await settle();
    expect(discovery.snapshot()).toEqual([element]);
    element.removeAttribute("autocomplete");
    element.setAttribute("aria-label", "Search");
    await settle();
    expect(discovery.snapshot()).toEqual([]);
    element.remove();
    await settle();
    expect(discovery.snapshot()).toEqual([]);
    discovery.dispose();
  });

  it.each([
    [
      "placeholder",
      (element: HTMLInputElement) => element.setAttribute("placeholder", "One-time code"),
    ],
    ["name", (element: HTMLInputElement) => element.setAttribute("name", "verification_code")],
    ["id", (element: HTMLInputElement) => element.setAttribute("id", "authentication_code")],
    [
      "label for",
      (element: HTMLInputElement) => {
        element.id = "dynamic-field";
        const label = document.createElement("label");
        label.htmlFor = element.id;
        label.textContent = "OTP";
        document.body.append(label);
      },
    ],
  ])(
    "discovers an initially ineligible unfocused field after a %s semantic change",
    async (_name, mutate) => {
      vi.useFakeTimers();
      const element = document.createElement("input");
      document.body.append(element);
      visible(element);
      const discovery = createOtpFieldDiscovery({ document, window });
      discovery.start();
      mutate(element);
      await settle();
      expect(discovery.snapshot()).toEqual([element]);
      discovery.dispose();
    },
  );

  it.each(["aria-hidden", "class", "style"])(
    "discovers an initially hidden unfocused OTP field after an %s change",
    async (attribute) => {
      vi.useFakeTimers();
      const style = document.createElement("style");
      style.textContent = ".hidden-otp { opacity: 0 }";
      document.head.append(style);
      const container = document.createElement("div");
      const element = document.createElement("input");
      element.autocomplete = "one-time-code";
      container.append(element);
      document.body.append(container);
      visible(element);
      if (attribute === "aria-hidden") container.setAttribute("aria-hidden", "true");
      if (attribute === "class") container.className = "hidden-otp";
      if (attribute === "style") container.style.opacity = "0";
      const discovery = createOtpFieldDiscovery({ document, window });
      discovery.start();
      if (attribute === "aria-hidden") container.removeAttribute("aria-hidden");
      if (attribute === "class") container.className = "";
      if (attribute === "style") container.style.opacity = "1";
      await settle();
      expect(discovery.snapshot()).toEqual([element]);
      discovery.dispose();
      style.remove();
    },
  );

  it("discovers an initially ineligible unfocused field after bounded context character data changes", async () => {
    vi.useFakeTimers();
    const description = document.createElement("span");
    description.id = "dynamic-description";
    description.textContent = "ordinary value";
    const element = document.createElement("input");
    element.setAttribute("aria-describedby", description.id);
    document.body.append(description, element);
    visible(element);
    const discovery = createOtpFieldDiscovery({ document, window });
    discovery.start();
    description.firstChild!.textContent = "Verification code";
    await settle();
    expect(discovery.snapshot()).toEqual([element]);
    discovery.dispose();
  });

  it("does not examine beyond-budget nodes until a later bounded pass", async () => {
    vi.useFakeTimers();
    const eligibility = {
      isEligible: vi.fn((element: HTMLInputElement) => element.autocomplete === "one-time-code"),
    };
    for (let index = 0; index < OTP_DISCOVERY_LIMITS.maxDiscoveryNodesPerPass; index += 1) {
      document.body.append(document.createElement("span"));
    }
    const field = addOtp();
    const discovery = createOtpFieldDiscovery({ document, window, eligibility });
    discovery.start();
    expect(eligibility.isEligible).not.toHaveBeenCalledWith(field);
    expect(discovery.snapshot()).toEqual([]);
    await settle();
    expect(eligibility.isEligible).toHaveBeenCalledWith(field);
    expect(discovery.snapshot()).toContain(field);
    discovery.dispose();
  });

  it("revalidates a focused dynamic field immediately", () => {
    const discovery = createOtpFieldDiscovery({ document, window });
    discovery.start();
    const element = addOtp();
    element.focus();
    expect(discovery.snapshot()).toEqual([]);
    expect(discovery.revalidateFocusedField()).toBe(element);
    element.readOnly = true;
    expect(discovery.revalidateFocusedField()).toBeNull();
    discovery.dispose();
  });

  it("does not pierce page shadow roots", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const element = document.createElement("input");
    element.autocomplete = "one-time-code";
    host.attachShadow({ mode: "open" }).append(element);
    visible(element);
    const discovery = createOtpFieldDiscovery({ document, window });
    discovery.start();
    expect(discovery.snapshot()).toEqual([]);
    discovery.dispose();
  });

  it("examines bounded nodes and pauses sustained churn until one second of quiescence", async () => {
    vi.useFakeTimers();
    const discovery = createOtpFieldDiscovery({ document, window });
    discovery.start();
    for (let pass = 0; pass <= OTP_DISCOVERY_LIMITS.maxDiscoveryPassesPerSecond; pass += 1) {
      const container = document.createElement("div");
      for (let index = 0; index < OTP_DISCOVERY_LIMITS.maxDiscoveryNodesPerPass + 10; index += 1)
        container.append(document.createElement("span"));
      document.body.append(container);
      await vi.advanceTimersByTimeAsync(1);
    }
    const field = addOtp();
    await vi.advanceTimersByTimeAsync(999);
    expect(discovery.snapshot()).not.toContain(field);
    await vi.advanceTimersByTimeAsync(5_002);
    expect(discovery.snapshot()).toContain(field);
    discovery.dispose();
  });

  it("start and dispose are idempotent and disposal cancels queued work", async () => {
    vi.useFakeTimers();
    const discovery = createOtpFieldDiscovery({ document, window });
    discovery.start();
    discovery.start();
    addOtp();
    discovery.dispose();
    discovery.dispose();
    await settle();
    expect(discovery.snapshot()).toEqual([]);
  });
});
