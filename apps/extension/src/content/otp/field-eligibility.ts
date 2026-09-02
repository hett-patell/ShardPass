const OTP_CONTEXT =
  /\b(?:otp|one[\s-]?time(?:\s+(?:pass(?:word|code)?|code))?|verification\s+(?:code|token)|authentication\s+(?:code|token)|2fa(?:\s+(?:code|token))?|mfa(?:\s+(?:code|token))?)\b/i;
const VERIFICATION_CONTEXT = /\b(?:verification|verify|authentication|2fa|mfa)\b/i;
const NEGATIVE_CONTEXT =
  /\b(?:pin|postal|zip|cvv|cvc|card\s+security|phone|telephone|account\s+(?:number|no)|quantity|search|coupon|promo|date|year)\b/i;
const SUPPORTED_TYPES = new Set(["", "text", "tel", "number", "password"]);
const MAX_CONTEXT_LENGTH = 512;
const MAX_LIGHT_DOM_ANCESTORS = 64;

function intersects(
  left: number,
  top: number,
  right: number,
  bottom: number,
  clip: DOMRect,
): boolean {
  return right > clip.left && bottom > clip.top && left < clip.right && top < clip.bottom;
}

export interface OtpFieldEligibility {
  isEligible(input: HTMLInputElement): boolean;
}

function boundedText(value: string | null | undefined): string {
  return (value ?? "").slice(0, MAX_CONTEXT_LENGTH);
}

function contextFor(input: HTMLInputElement): string {
  const parts = [
    input.getAttribute("aria-label"),
    input.getAttribute("placeholder"),
    input.getAttribute("name"),
    input.getAttribute("id"),
  ];
  for (const attribute of ["aria-labelledby", "aria-describedby"] as const) {
    const ids = (input.getAttribute(attribute) ?? "").trim().split(/\s+/).slice(0, 4);
    for (const id of ids) parts.push(input.ownerDocument.getElementById(id)?.textContent ?? null);
  }
  const labels = input.labels;
  if (labels !== null) {
    for (let index = 0; index < Math.min(labels.length, 4); index += 1) {
      parts.push(labels.item(index)?.textContent);
    }
  }
  return boundedText(parts.map(boundedText).join(" ")).replace(/[_-]+/g, " ");
}

function isVisible(input: HTMLInputElement, ownerWindow: Window): boolean {
  const rect = input.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  let left = Math.max(rect.left, 0);
  let top = Math.max(rect.top, 0);
  let right = Math.min(rect.right, ownerWindow.innerWidth);
  let bottom = Math.min(rect.bottom, ownerWindow.innerHeight);
  if (right <= left || bottom <= top) return false;

  let current: Element | null = input;
  for (let depth = 0; current !== null && depth < MAX_LIGHT_DOM_ANCESTORS; depth += 1) {
    const style = ownerWindow.getComputedStyle(current);
    const opacity = Number.parseFloat(style.opacity);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      (Number.isFinite(opacity) && opacity <= 0) ||
      style.pointerEvents === "none" ||
      current.hasAttribute("inert") ||
      current.hasAttribute("hidden") ||
      current.getAttribute("aria-hidden")?.toLowerCase() === "true"
    )
      return false;

    const overflow = style.overflow;
    const clipsX = style.overflowX !== "visible" || (overflow !== "" && overflow !== "visible");
    const clipsY = style.overflowY !== "visible" || (overflow !== "" && overflow !== "visible");
    if (current !== input && (clipsX || clipsY)) {
      const clip = current.getBoundingClientRect();
      if (!intersects(left, top, right, bottom, clip)) return false;
      if (clipsX) {
        left = Math.max(left, clip.left);
        right = Math.min(right, clip.right);
      }
      if (clipsY) {
        top = Math.max(top, clip.top);
        bottom = Math.min(bottom, clip.bottom);
      }
      if (right <= left || bottom <= top) return false;
    }
    current = current.parentElement;
  }
  return current === null;
}

export function createOtpFieldEligibility(ownerWindow: Window): OtpFieldEligibility {
  return {
    isEligible(input): boolean {
      if (input.ownerDocument.defaultView !== ownerWindow) return false;
      if (!input.isConnected || input.getRootNode() !== input.ownerDocument) return false;
      if (input.closest("shardpass-picker-host") !== null) return false;
      if (
        input.disabled ||
        input.matches(":disabled") ||
        input.readOnly ||
        input.closest("[inert], [hidden], [aria-hidden='true']") !== null
      )
        return false;
      if (!SUPPORTED_TYPES.has(input.getAttribute("type")?.toLowerCase() ?? "")) return false;
      if (!isVisible(input, ownerWindow)) return false;

      if (input.autocomplete.toLowerCase().split(/\s+/).includes("one-time-code")) return true;
      const context = contextFor(input);
      if (NEGATIVE_CONTEXT.test(context)) return false;
      const maximum = input.maxLength;
      const numericShape = input.inputMode === "numeric" && maximum >= 4 && maximum <= 8;
      if (numericShape) return VERIFICATION_CONTEXT.test(context);
      return OTP_CONTEXT.test(context);
    },
  };
}
