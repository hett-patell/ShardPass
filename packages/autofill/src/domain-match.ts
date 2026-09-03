function extractDomain(urlOrDomain: string): string {
  let d = urlOrDomain.trim().toLowerCase();
  const protoIdx = d.indexOf("://");
  if (protoIdx !== -1) d = d.slice(protoIdx + 3);
  const pathIdx = d.indexOf("/");
  if (pathIdx !== -1) d = d.slice(0, pathIdx);
  const portIdx = d.indexOf(":");
  if (portIdx !== -1) d = d.slice(0, portIdx);
  if (d.startsWith("www.")) d = d.slice(4);
  return d;
}

export function matchDomain(pageDomain: string, urls: readonly string[]): boolean {
  const page = extractDomain(pageDomain);
  return urls.some((url) => {
    const target = extractDomain(url);
    return page === target || page.endsWith("." + target);
  });
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
