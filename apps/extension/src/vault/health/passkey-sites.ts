/**
 * Sites known to accept a passkey for signing in, by registrable domain. A login saved for
 * one of these that has no passkey yet is worth upgrading. The list is a snapshot of widely
 * used services that document passkey sign-in; it is advisory, and a site not listed may
 * well accept them too.
 */
export const PASSKEY_SITES: ReadonlySet<string> = new Set([
  "adobe.com",
  "amazon.com",
  "amazon.co.uk",
  "amazon.de",
  "amazon.ca",
  "amazon.in",
  "apple.com",
  "icloud.com",
  "authy.com",
  "bestbuy.com",
  "binance.com",
  "bitwarden.com",
  "booking.com",
  "cloudflare.com",
  "coinbase.com",
  "cvs.com",
  "dashlane.com",
  "discord.com",
  "docusign.com",
  "doordash.com",
  "dropbox.com",
  "ebay.com",
  "figma.com",
  "github.com",
  "gitlab.com",
  "godaddy.com",
  "google.com",
  "gmail.com",
  "youtube.com",
  "hetzner.com",
  "home.com",
  "instacart.com",
  "kayak.com",
  "kraken.com",
  "linkedin.com",
  "live.com",
  "microsoft.com",
  "outlook.com",
  "hotmail.com",
  "namecheap.com",
  "nintendo.com",
  "nordpass.com",
  "notion.so",
  "nvidia.com",
  "okta.com",
  "onepassword.com",
  "1password.com",
  "paypal.com",
  "playstation.com",
  "proton.me",
  "protonmail.com",
  "robinhood.com",
  "roblox.com",
  "shopify.com",
  "synology.com",
  "target.com",
  "ticketmaster.com",
  "tiktok.com",
  "uber.com",
  "ui.com",
  "vercel.com",
  "whatsapp.com",
  "wordpress.com",
  "x.com",
  "twitter.com",
  "yahoo.com",
  "zoho.com",
]);

/** The registrable domain of a saved URL ("accounts.google.com" → "google.com"), or "" when unreadable. */
export function registrableDomain(url: string): string {
  let host: string;
  try {
    host = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//iu.test(url.trim()) ? url.trim() : `https://${url.trim()}`,
    ).hostname.toLowerCase();
  } catch {
    return "";
  }
  const labels = host.split(".").filter((label) => label !== "");
  if (labels.length <= 2) return labels.join(".");
  // "co.uk"-style suffixes keep three labels; everything else two.
  const secondLevel = new Set(["co", "com", "org", "net", "gov", "edu", "ac"]);
  const tail = labels[labels.length - 1] ?? "";
  const middle = labels[labels.length - 2] ?? "";
  return tail.length <= 3 && secondLevel.has(middle)
    ? labels.slice(-3).join(".")
    : labels.slice(-2).join(".");
}

/** Whether any of a login's sites is known to accept passkeys. */
export function acceptsPasskeys(urls: readonly string[]): boolean {
  return urls.some((url) => PASSKEY_SITES.has(registrableDomain(url)));
}
