/**
 * The element that has focus, seen through open shadow roots: the document reports the
 * shadow host as active, and the host's own tree says which of its descendants it is.
 */
export function deepActiveElement(document: Document): Element | null {
  let active: Element | null = document.activeElement;
  for (let depth = 0; active !== null && depth < 16; depth += 1) {
    const inner = active.shadowRoot?.activeElement ?? null;
    if (inner === null) return active;
    active = inner;
  }
  return active;
}

/** The event's real target, before retargeting hid an element inside a shadow root. */
export function deepEventTarget(event: Event): EventTarget | null {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  return path[0] ?? event.target;
}
