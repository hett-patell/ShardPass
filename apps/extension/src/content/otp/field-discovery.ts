import { createOtpFieldEligibility, type OtpFieldEligibility } from "./field-eligibility";

export const OTP_DISCOVERY_LIMITS = Object.freeze({
  maxDiscoveryNodesPerPass: 256,
  maxDiscoveredFieldsPerFrame: 32,
  maxDiscoveryPassesPerSecond: 10,
});

export interface OtpFieldDiscovery {
  start(): void;
  revalidateFocusedField(): HTMLInputElement | null;
  snapshot(): readonly HTMLInputElement[];
  dispose(): void;
}

export function createOtpFieldDiscovery(
  options: Readonly<{
    document: Document;
    window: Window;
    eligibility?: OtpFieldEligibility;
  }>,
): OtpFieldDiscovery {
  const eligibility = options.eligibility ?? createOtpFieldEligibility(options.window);
  let fields: HTMLInputElement[] = [];
  let observer: MutationObserver | null = null;
  let scheduled: number | null = null;
  let pausedUntil = 0;
  let passTimes: number[] = [];
  let started = false;
  let disposed = false;
  let walker: TreeWalker | null = null;
  let passFields: HTMLInputElement[] = [];
  let restartScan = true;

  const scan = (): void => {
    scheduled = null;
    if (!started || disposed) return;
    const now = Date.now();
    if (now < pausedUntil) {
      scheduled = options.window.setTimeout(scan, pausedUntil - now);
      return;
    }
    passTimes = passTimes.filter((time) => now - time < 1_000);
    if (passTimes.length >= OTP_DISCOVERY_LIMITS.maxDiscoveryPassesPerSecond) {
      passTimes = [];
      pausedUntil = now + 1_000;
      scheduled = options.window.setTimeout(scan, 1_000);
      return;
    }
    passTimes.push(now);
    if (walker === null || restartScan) {
      walker = options.document.createTreeWalker(options.document, 1);
      passFields = [];
      restartScan = false;
    }
    let examined = 0;
    let completed = false;
    while (examined < OTP_DISCOVERY_LIMITS.maxDiscoveryNodesPerPass) {
      const node = walker.nextNode();
      if (node === null) {
        completed = true;
        break;
      }
      examined += 1;
      if (
        node.nodeName === "INPUT" &&
        node.ownerDocument?.defaultView === options.window &&
        eligibility.isEligible(node as HTMLInputElement) &&
        passFields.length < OTP_DISCOVERY_LIMITS.maxDiscoveredFieldsPerFrame
      )
        passFields.push(node as HTMLInputElement);
    }
    fields = passFields.slice();
    if (completed) {
      walker = null;
      passFields = [];
      restartScan = true;
    } else if (scheduled === null) {
      scheduled = options.window.setTimeout(scan, 0);
    }
  };

  const schedule = (): void => {
    if (disposed || !started) return;
    restartScan = true;
    const now = Date.now();
    if (pausedUntil > now) {
      pausedUntil = now + 1_000;
      if (scheduled !== null) options.window.clearTimeout(scheduled);
      scheduled = options.window.setTimeout(scan, 1_000);
      return;
    }
    if (scheduled === null) scheduled = options.window.setTimeout(scan, 0);
  };

  return {
    start() {
      if (started || disposed) return;
      started = true;
      scan();
      const Observer = options.document.defaultView?.MutationObserver ?? MutationObserver;
      const nextObserver = new Observer(schedule);
      observer = nextObserver;
      nextObserver.observe(options.document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "autocomplete",
          "type",
          "inputmode",
          "maxlength",
          "disabled",
          "readonly",
          "hidden",
          "inert",
          "style",
          "class",
          "aria-label",
          "aria-labelledby",
          "aria-describedby",
          "aria-hidden",
          "placeholder",
          "name",
          "id",
          "for",
        ],
        characterData: true,
      });
    },
    revalidateFocusedField() {
      const active = options.document.activeElement;
      if (active?.tagName !== "INPUT" || active.ownerDocument.defaultView !== options.window)
        return null;
      const input = active as HTMLInputElement;
      return eligibility.isEligible(input) ? input : null;
    },
    snapshot() {
      return Object.freeze(
        fields.filter((field) => field.isConnected && eligibility.isEligible(field)).slice(),
      );
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      started = false;
      observer?.disconnect();
      observer = null;
      if (scheduled !== null) options.window.clearTimeout(scheduled);
      scheduled = null;
      fields = [];
      walker = null;
      passFields = [];
      passTimes = [];
    },
  };
}
