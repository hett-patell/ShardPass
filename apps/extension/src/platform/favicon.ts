/**
 * A saved site's icon from the browser's own favicon cache, through the extension's favicon
 * permission. Nothing is fetched by ShardPass and no third party learns which sites are
 * saved: the browser serves what it already has, and a plain globe for a site it has never
 * seen. Undefined outside an extension page (tests, the content script).
 */
export function faviconUrl(pageUrl: string | undefined, size = 32): string | undefined {
  if (pageUrl === undefined || pageUrl.trim() === "") return undefined;
  const runtime = (globalThis as { chrome?: { runtime?: { getURL?: (path: string) => string } } })
    .chrome?.runtime;
  if (typeof runtime?.getURL !== "function") return undefined;
  let origin: string;
  try {
    const parsed = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//iu.test(pageUrl.trim())
        ? pageUrl.trim()
        : `https://${pageUrl.trim()}`,
    );
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    origin = parsed.origin;
  } catch {
    return undefined;
  }
  let base: string;
  try {
    base = runtime.getURL("/_favicon/");
  } catch {
    return undefined;
  }
  try {
    const url = new URL(base);
    url.searchParams.set("pageUrl", origin);
    url.searchParams.set("size", String(size));
    return url.toString();
  } catch {
    return undefined;
  }
}
