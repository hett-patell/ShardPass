/** Tags past which text no longer describes the field: another field, a control, a section. */
const BOUNDARY_TAGS = new Set([
  "FORM",
  "FIELDSET",
  "TABLE",
  "TBODY",
  "TR",
  "UL",
  "OL",
  "BUTTON",
  "SELECT",
  "INPUT",
  "TEXTAREA",
  "IFRAME",
  "SECTION",
  "ARTICLE",
  "MAIN",
  "NAV",
  "HEADER",
  "FOOTER",
  "H1",
  "H2",
  "H3",
]);
const FIELD_SELECTOR = "input, select, textarea, button";
const MAX_ASCENT = 4;
const MAX_TEXT = 200;

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\p{C}+|\s+/gu, " ").trim();
}

function ownText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return clean(node.textContent);
  if (!(node instanceof Element)) return "";
  if (BOUNDARY_TAGS.has(node.tagName) || node.querySelector(FIELD_SELECTOR) !== null) return "";
  return clean(node.textContent).slice(0, MAX_TEXT);
}

/** Text before `node` among its siblings, nearest first, stopping at a boundary or another field. */
function precedingSiblingText(node: Node): string {
  const parts: string[] = [];
  for (let sibling = node.previousSibling; sibling !== null; sibling = sibling.previousSibling) {
    if (
      sibling instanceof Element &&
      (BOUNDARY_TAGS.has(sibling.tagName) || sibling.querySelector(FIELD_SELECTOR) !== null)
    )
      break;
    const text = ownText(sibling);
    if (text !== "") parts.unshift(text);
    if (parts.join(" ").length >= MAX_TEXT) break;
  }
  return parts.join(" ");
}

/**
 * What a person reads as the field's label, when its attributes say nothing: its <label>s,
 * the elements named by aria-labelledby, the text just before it ("<div>Email</div><input>"),
 * climbing a few wrappers when the field sits alone in one, and the previous table cell.
 */
export function labelTextFor(input: HTMLElement): string {
  const parts: string[] = [];
  const labels = (input as HTMLInputElement).labels;
  if (labels)
    for (let index = 0; index < Math.min(labels.length, 3); index += 1)
      parts.push(clean(labels.item(index)?.textContent));
  for (const id of (input.getAttribute("aria-labelledby") ?? "").trim().split(/\s+/u).slice(0, 3)) {
    if (id === "") continue;
    parts.push(clean(input.ownerDocument.getElementById(id)?.textContent));
  }
  let node: Node = input;
  for (let depth = 0; depth <= MAX_ASCENT; depth += 1) {
    const before = precedingSiblingText(node);
    if (before !== "") {
      parts.push(before);
      break;
    }
    const parent = node.parentElement;
    if (parent === null || BOUNDARY_TAGS.has(parent.tagName)) break;
    // Only a wrapper that holds no other field is still "about" this one.
    if (parent.querySelectorAll(FIELD_SELECTOR).length > 1) break;
    node = parent;
  }
  const cell = input.closest("td, th");
  const previousCell = cell?.previousElementSibling;
  if (
    previousCell !== null &&
    previousCell !== undefined &&
    previousCell.querySelector(FIELD_SELECTOR) === null
  )
    parts.push(clean(previousCell.textContent).slice(0, MAX_TEXT));
  return parts
    .filter((part) => part !== "")
    .join(" ")
    .slice(0, MAX_TEXT * 2);
}
