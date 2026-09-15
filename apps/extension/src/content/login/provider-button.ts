import type { SignInProvider } from "@shardpass/domain";

const PROVIDER_WORDS: Readonly<Record<SignInProvider, RegExp | null>> = {
  google: /\bgoogle\b/iu,
  apple: /\bapple\b/iu,
  microsoft: /\b(?:microsoft|azure|outlook|office\s?365)\b/iu,
  github: /\bgithub\b/iu,
  facebook: /\b(?:facebook|meta)\b/iu,
  twitter: /\b(?:twitter|x)\b/iu,
  amazon: /\bamazon\b/iu,
  linkedin: /\blinkedin\b/iu,
  slack: /\bslack\b/iu,
  other: null,
};

const PROVIDER_HREF: Readonly<Record<SignInProvider, RegExp | null>> = {
  google: /accounts\.google\.com|\/(?:auth|oauth|login|signin)\/google|provider=google/iu,
  apple: /appleid\.apple\.com|\/(?:auth|oauth|login|signin)\/apple|provider=apple/iu,
  microsoft:
    /login\.microsoftonline\.com|login\.live\.com|\/(?:auth|oauth|login|signin)\/(?:microsoft|azure)/iu,
  github: /github\.com\/login\/oauth|\/(?:auth|oauth|login|signin)\/github/iu,
  facebook: /facebook\.com\/(?:v[\d.]+\/)?dialog\/oauth|\/(?:auth|oauth|login|signin)\/facebook/iu,
  twitter: /\/(?:auth|oauth|login|signin)\/(?:twitter|x)\b/iu,
  amazon: /amazon\.com\/ap\/oa|\/(?:auth|oauth|login|signin)\/amazon/iu,
  linkedin: /linkedin\.com\/oauth|\/(?:auth|oauth|login|signin)\/linkedin/iu,
  slack: /slack\.com\/oauth|\/(?:auth|oauth|login|signin)\/slack/iu,
  other: null,
};

const ACTION_WORDS = /\b(?:continue|sign\s?in|log\s?in|sign\s?up|connect|use|with)\b/iu;
const CANDIDATES = 'button, a[href], input[type="button"], input[type="submit"], [role="button"]';

function textOf(element: Element): string {
  const own = [
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element instanceof HTMLInputElement ? element.value : null,
    element.textContent,
    ...Array.from(element.querySelectorAll("img[alt], svg[aria-label]")).map(
      (child) => child.getAttribute("alt") ?? child.getAttribute("aria-label"),
    ),
  ];
  return own
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 200);
}

/**
 * The page's "Continue with Google" (or Apple, GitHub ...) control: a rendered button or link
 * that names the provider in a sign-in phrase, or whose link goes to that provider's OAuth
 * endpoint. "other" cannot be found and returns null.
 */
export function findProviderButton(root: ParentNode, provider: SignInProvider): HTMLElement | null {
  const words = PROVIDER_WORDS[provider];
  if (words === null) return null;
  const href = PROVIDER_HREF[provider];
  let fallback: HTMLElement | null = null;
  for (const element of Array.from(root.querySelectorAll<HTMLElement>(CANDIDATES))) {
    if (element.getClientRects().length === 0 || element.closest("shardpass-picker-host") !== null)
      continue;
    const text = textOf(element);
    const link = element.getAttribute("href") ?? "";
    if (words.test(text) && ACTION_WORDS.test(text)) return element;
    // A link to the provider's OAuth endpoint is the button even when its text is only a logo.
    // A bare mention of the provider ("Google Privacy Policy", "Get it on Google Play") is not.
    if (fallback === null && href !== null && href.test(link)) fallback = element;
  }
  return fallback;
}
