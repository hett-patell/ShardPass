/** clip-path values that hide the whole box: the honeypot trick after opacity 0. */
const HIDING_CLIPS: ReadonlySet<string> = new Set([
  "inset(100%)",
  "inset(50%)",
  "circle(0)",
  "circle(0px)",
  "circle(0%)",
  "polygon(00,00,00)",
  "polygon(0 0,0 0,0 0)",
  "polygon(0px 0px,0px 0px,0px 0px)",
]);

function hiddenByStyle(style: CSSStyleDeclaration, own: boolean): boolean {
  if (style.display === "none") return true;
  // visibility inherits but a child may switch it back on, so only the element's own counts.
  if (own && (style.visibility === "hidden" || style.visibility === "collapse")) return true;
  const opacity = Number.parseFloat(style.opacity);
  if (Number.isFinite(opacity) && opacity <= 0) return true;
  const clip = (style.clipPath ?? "").replace(/\s+/gu, "").toLowerCase();
  return clip !== "" && HIDING_CLIPS.has(clip);
}

/**
 * Whether an element is drawn at all: neither it nor any ancestor (across shadow boundaries)
 * is display:none, fully transparent or clipped away, and it is not visibility:hidden. The
 * engine's own checkVisibility() is asked first where it exists; the walk below is what
 * older engines and jsdom get, and it is what refuses a honeypot parked in a hidden wrapper.
 */
export function isDrawn(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) return true;
  if (
    typeof element.checkVisibility === "function" &&
    !element.checkVisibility({ opacityProperty: true, visibilityProperty: true })
  )
    return false;
  for (let node: Element | null = element; node !== null; node = parentOf(node)) {
    if (hiddenByStyle(view.getComputedStyle(node), node === element)) return false;
  }
  return true;
}

function parentOf(node: Element): Element | null {
  if (node.parentElement !== null) return node.parentElement;
  const root = node.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}
