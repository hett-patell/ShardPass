function extractDomain(urlOrDomain: string): string {
  const trimmed = urlOrDomain.trim();
  // The URL parser gives the host in its DNS form (punycode for an international name),
  // which is what the browser reports for the page; a saved "bücher.de" then matches.
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`);
    const host = url.hostname.toLowerCase();
    if (host !== "") return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    // Not a URL the parser accepts: fall back to plain slicing.
  }
  let d = trimmed.toLowerCase();
  const protoIdx = d.indexOf("://");
  if (protoIdx !== -1) d = d.slice(protoIdx + 3);
  const pathIdx = d.indexOf("/");
  if (pathIdx !== -1) d = d.slice(0, pathIdx);
  const portIdx = d.indexOf(":");
  if (portIdx !== -1) d = d.slice(0, portIdx);
  if (d.startsWith("www.")) d = d.slice(4);
  return d;
}

/**
 * Public suffixes of more than one label, plus hosting suffixes under which every subdomain is
 * a different site. A short built-in list rather than the full public suffix list: it covers
 * the common country second-level domains and the hosting services on which two unrelated apps
 * must never see each other's logins.
 */
const MULTI_LABEL_SUFFIXES: ReadonlySet<string> = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "co.in",
  "co.jp",
  "ne.jp",
  "or.jp",
  "com.br",
  "com.mx",
  "com.ar",
  "co.za",
  "com.sg",
  "com.hk",
  "com.tw",
  "com.cn",
  "com.tr",
  "co.kr",
  "com.ua",
  "com.my",
  "com.ph",
  "co.id",
  "com.vn",
  "com.pk",
  "com.bd",
  "com.eg",
  "com.ng",
  "co.ke",
  "com.sa",
  "co.ae",
  "github.io",
  "gitlab.io",
  "netlify.app",
  "vercel.app",
  "pages.dev",
  "herokuapp.com",
  "web.app",
  "firebaseapp.com",
]);

/**
 * The registrable domain (eTLD+1) of a host: "accounts.google.com" and "mail.google.com" both
 * give "google.com", "shop.example.co.uk" gives "example.co.uk", and "a.github.io" stays
 * "a.github.io". Single-label hosts and IP addresses are returned as they are.
 */
export function registrableDomain(host: string): string {
  const labels = host.split(".");
  const last = labels[labels.length - 1] ?? "";
  if (labels.length <= 2 || /^\d+$/u.test(last)) return host;
  const lastTwo = labels.slice(-2).join(".");
  return MULTI_LABEL_SUFFIXES.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

export function matchDomain(pageDomain: string, urls: readonly string[]): boolean {
  const page = registrableDomain(extractDomain(pageDomain));
  if (page === "") return false;
  return urls.some((url) => registrableDomain(extractDomain(url)) === page);
}

export type UrlMatchMode = "domain" | "host" | "startsWith" | "exact" | "never";

/** Splits a page or saved URL into the parts each match mode compares. */
function parts(value: string): { host: string; href: string; bare: boolean } {
  const trimmed = value.trim();
  const bare = !/^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed);
  try {
    const url = new URL(bare ? `https://${trimmed}` : trimmed);
    const host = url.host.toLowerCase();
    const path = url.pathname.replace(/\/+$/u, "");
    return { host, href: `${url.protocol}//${host}${path}${url.search}`, bare };
  } catch {
    return { host: extractDomain(trimmed), href: trimmed.toLowerCase(), bare };
  }
}

/**
 * Whether `page` qualifies for a login saved under `url` with the given mode.
 *
 * Content scripts may report only a hostname rather than a full URL; the path-sensitive
 * modes ("startsWith", "exact") then degrade to a host comparison rather than failing, so a
 * login is never hidden merely because the caller had less to say about the page.
 */
export function matchLoginUrl(page: string, url: string, mode: UrlMatchMode = "domain"): boolean {
  if (mode === "never") return false;
  if (mode === "domain") return matchDomain(page, [url]);
  const pageParts = parts(page);
  const target = parts(url);
  if (mode === "host" || pageParts.bare) return pageParts.host === target.host;
  if (mode === "exact") return pageParts.href === target.href;
  return pageParts.href.startsWith(target.href);
}

/** `modes` is positional and optional: a missing entry means "domain". */
export function matchLoginUrls(
  page: string,
  urls: readonly string[],
  modes?: readonly UrlMatchMode[],
): boolean {
  return urls.some((url, index) => matchLoginUrl(page, url, modes?.[index] ?? "domain"));
}
