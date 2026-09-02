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
