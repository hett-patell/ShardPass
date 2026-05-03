const OTP_NAME_RE =
  /(otp|2fa|totp|two[\s_-]?factor|verification|auth(enticator)?[\s_-]*code|security[\s_-]*code|mfa)/i;

export function isLikelyOtpInput(el: Element): el is HTMLInputElement {
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.disabled || el.readOnly) return false;
  const type = (el.type || "").toLowerCase();
  if (!["text", "tel", "number", "password", ""].includes(type)) return false;

  const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
  if (ac.includes("one-time-code")) return true;

  const inputmode = (el.getAttribute("inputmode") || "").toLowerCase();
  const maxLen = el.maxLength;

  const haystack = [
    el.name,
    el.id,
    el.getAttribute("placeholder") || "",
    el.getAttribute("aria-label") || "",
    el.getAttribute("data-testid") || "",
    el.getAttribute("data-test") || "",
  ]
    .join(" ")
    .toLowerCase();

  const labelMatch = OTP_NAME_RE.test(haystack);

  let parentLabelMatch = false;
  const wrappingLabel = el.closest("label");
  if (wrappingLabel) {
    parentLabelMatch = OTP_NAME_RE.test(wrappingLabel.textContent || "");
  }
  if (!parentLabelMatch && el.id) {
    const lab = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
    if (lab) parentLabelMatch = OTP_NAME_RE.test(lab.textContent || "");
  }

  if (labelMatch || parentLabelMatch) return true;
  if (inputmode === "numeric" && maxLen >= 4 && maxLen <= 8) return true;
  return false;
}

export function findOtpInputs(root: ParentNode = document): HTMLInputElement[] {
  const out: HTMLInputElement[] = [];
  root.querySelectorAll("input").forEach((el) => {
    if (isLikelyOtpInput(el)) out.push(el);
  });
  return out;
}

export function getDomainParts(hostname: string): { full: string; root: string } {
  const full = hostname.toLowerCase();
  const labels = full.split(".").filter(Boolean);
  const root = labels.length >= 2 ? labels.slice(-2).join(".") : full;
  return { full, root };
}

function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(s);
  }
  return s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
