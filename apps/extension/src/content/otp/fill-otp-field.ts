import { segmentedGroupOf, type OtpFieldEligibility } from "./field-eligibility";
import type { OtpFieldHandleRegistry } from "./field-handles";

export type OtpFillPrimitiveResult = Readonly<{
  status:
    | "filled"
    | "expired"
    | "field-changed"
    | "field-ineligible"
    | "setter-failed"
    | "event-failed"
    | "verification-failed";
}>;

declare const otpFillAttemptBrand: unique symbol;

export interface OtpFillAttempt {
  readonly [otpFillAttemptBrand]: true;
}

const issuedAttempts = new WeakSet<object>();
const consumedAttempts = new WeakSet<object>();

export function createOtpFillAttempt(): OtpFillAttempt {
  const attempt = Object.freeze({}) as OtpFillAttempt;
  issuedAttempts.add(attempt);
  return attempt;
}

function isAvailableOtpFillAttempt(attempt: OtpFillAttempt): boolean {
  return (
    typeof attempt === "object" &&
    attempt !== null &&
    issuedAttempts.has(attempt) &&
    !consumedAttempts.has(attempt)
  );
}

function consumeOtpFillAttempt(attempt: OtpFillAttempt): boolean {
  if (!isAvailableOtpFillAttempt(attempt)) return false;
  consumedAttempts.add(attempt);
  return true;
}

export interface FillOtpFieldOptions {
  readonly input: HTMLInputElement;
  readonly fieldHandle: string;
  readonly registry: OtpFieldHandleRegistry;
  readonly eligibility: OtpFieldEligibility;
  readonly code: string;
  readonly expiresAt: number;
  readonly expectedUrl: string;
  readonly expectedOrigin: string;
  readonly now?: () => number;
  readonly attempt: OtpFillAttempt;
}

function currentOrigin(ownerWindow: Window): string | null {
  try {
    return new URL(ownerWindow.location.href).origin;
  } catch {
    return null;
  }
}

export function fillOtpField(options: FillOtpFieldOptions): OtpFillPrimitiveResult {
  const now = options.now ?? Date.now;
  if (options.attempt === undefined || !isAvailableOtpFillAttempt(options.attempt))
    return { status: "field-changed" };
  if (now() >= options.expiresAt) return { status: "expired" };
  const ownerWindow = options.input.ownerDocument.defaultView;
  if (
    ownerWindow === null ||
    ownerWindow.location.href !== options.expectedUrl ||
    currentOrigin(ownerWindow) !== options.expectedOrigin
  )
    return { status: "field-changed" };
  if (options.registry.resolveActive(options.fieldHandle) !== options.input)
    return { status: "field-changed" };
  if (!options.eligibility.isEligible(options.input)) return { status: "field-ineligible" };
  if (options.attempt === undefined || !consumeOtpFillAttempt(options.attempt))
    return { status: "field-changed" };

  try {
    options.input.focus({ preventScroll: true });
  } catch {
    return { status: "field-changed" };
  }

  if (
    ownerWindow.location.href !== options.expectedUrl ||
    currentOrigin(ownerWindow) !== options.expectedOrigin ||
    options.registry.resolveActive(options.fieldHandle) !== options.input ||
    !options.input.isConnected ||
    options.input.ownerDocument.activeElement !== options.input
  )
    return { status: "field-changed" };
  if (!options.eligibility.isEligible(options.input)) return { status: "field-ineligible" };

  const descriptor = ownerWindow.Object.getOwnPropertyDescriptor(
    ownerWindow.HTMLInputElement.prototype,
    "value",
  );
  if (descriptor?.set === undefined) return { status: "setter-failed" };

  // A segmented widget takes one character per box, each focused and told about its input
  // the way typing would, so the widget's own "advance to the next box" logic runs.
  const group = segmentedGroupOf(options.input);
  // Fewer boxes than digits is not this code's widget: nothing is written, and the caller
  // falls back to copying the code.
  if (group !== null && group.length < options.code.length)
    return { status: "verification-failed" };
  const targets: Array<Readonly<{ box: HTMLInputElement; value: string }>> =
    group === null
      ? [{ box: options.input, value: options.code }]
      : group.map((box, index) => ({ box, value: options.code.charAt(index) }));
  for (const { box, value } of targets) {
    try {
      if (box !== options.input) box.focus({ preventScroll: true });
      descriptor.set.call(box, value);
    } catch {
      return { status: "setter-failed" };
    }
    try {
      box.dispatchEvent(new ownerWindow.Event("input", { bubbles: true, composed: true }));
      box.dispatchEvent(new ownerWindow.Event("change", { bubbles: true, composed: true }));
    } catch {
      return { status: "event-failed" };
    }
  }

  const written = targets.map(({ box }) => box.value).join("");
  const expected = group === null ? options.code : options.code.slice(0, group.length);
  if (
    options.registry.resolveActive(options.fieldHandle) !== options.input ||
    !options.input.isConnected ||
    written !== expected
  )
    return { status: "verification-failed" };
  return { status: "filled" };
}
