import { isDrawn } from "./visibility";

import { labelTextFor } from "./field-context";

export type CardFieldKind = "number" | "name" | "expMonth" | "expYear" | "exp" | "cvv";
export type IdentityFieldKind =
  | "firstName"
  | "middleName"
  | "lastName"
  | "fullName"
  | "email"
  | "phone"
  | "company"
  | "username"
  | "street"
  | "address2"
  | "city"
  | "state"
  | "zip"
  | "country"
  | "birthDate";

export type FillableElement = HTMLInputElement | HTMLSelectElement;
export interface DataField<K extends string> {
  readonly kind: K;
  readonly element: FillableElement;
}

const TEXT_TYPES: ReadonlySet<string> = new Set(["", "text", "tel", "email", "number", "search"]);

/** The browser's own vocabulary decides first; it is exact where names and labels are not. */
const CARD_AUTOCOMPLETE: Readonly<Record<string, CardFieldKind>> = {
  "cc-number": "number",
  "cc-name": "name",
  "cc-given-name": "name",
  "cc-family-name": "name",
  "cc-exp": "exp",
  "cc-exp-month": "expMonth",
  "cc-exp-year": "expYear",
  "cc-csc": "cvv",
};
const IDENTITY_AUTOCOMPLETE: Readonly<Record<string, IdentityFieldKind>> = {
  "given-name": "firstName",
  "additional-name": "middleName",
  "family-name": "lastName",
  name: "fullName",
  email: "email",
  tel: "phone",
  "tel-national": "phone",
  organization: "company",
  username: "username",
  "street-address": "street",
  "address-line1": "street",
  "address-line2": "address2",
  "address-level2": "city",
  "address-level1": "state",
  "postal-code": "zip",
  country: "country",
  "country-name": "country",
  bday: "birthDate",
};

/** Keyword tables, tried in order; the first that matches names the field. */
const CARD_KEYWORDS: readonly (readonly [CardFieldKind, RegExp])[] = [
  ["exp", /mm\s*\/\s*yy(?:yy)?|\bvalid\s*(?:thru|through|until)\b/iu],
  [
    "cvv",
    /\b(?:cvv|cvc|cvv2|csc|cvn|cid|security\s*code|card\s*code|verification\s*(?:code|value))\b/iu,
  ],
  ["expMonth", /\b(?:exp(?:iry|iration)?\s*month|mm|month)\b/iu],
  ["expYear", /\b(?:exp(?:iry|iration)?\s*year|yyyy|yy|year)\b/iu],
  ["exp", /\b(?:exp(?:iry|iration|ires|ire)?(?:\s*date)?)\b/iu],
  [
    "name",
    /\b(?:card\s*holder|cardholder|name\s*on\s*(?:the\s*)?card|cc\s*name|holder\s*name)\b/iu,
  ],
  [
    "number",
    /\b(?:card\s*(?:number|num|no|#)|cc\s*(?:num|number)|credit\s*card|debit\s*card|pan|account\s*number)\b/iu,
  ],
];
const IDENTITY_KEYWORDS: readonly (readonly [IdentityFieldKind, RegExp])[] = [
  ["email", /\b(?:e-?mail)\b/iu],
  ["phone", /\b(?:phone|mobile|telephone|tel|cell)\b/iu],
  ["firstName", /\b(?:first\s*name|given\s*name|fname|forename)\b/iu],
  ["lastName", /\b(?:last\s*name|surname|family\s*name|lname)\b/iu],
  ["middleName", /\b(?:middle\s*(?:name|initial))\b/iu],
  // The specific names go before the bare "name": user_name is a username, company_name a company.
  ["username", /\b(?:user\s*name|username|login)\b/iu],
  ["company", /\b(?:company|organi[sz]ation|employer|business)\b/iu],
  ["fullName", /\b(?:full\s*name|your\s*name|name)\b/iu],
  ["address2", /\b(?:address\s*(?:line\s*)?2|addr2|apt|apartment|suite|unit|floor)\b/iu],
  ["street", /\b(?:street|address\s*(?:line\s*)?1|addr1|address)\b/iu],
  ["city", /\b(?:city|town|locality|suburb)\b/iu],
  ["zip", /\b(?:zip|postal|post\s*code|postcode|pin\s*code)\b/iu],
  ["state", /\b(?:state|province|region|county|territory)\b/iu],
  ["country", /\b(?:country|nation)\b/iu],
  ["birthDate", /\b(?:birth|dob|birthday|born)\b/iu],
];

function describe(element: FillableElement): string {
  const own = [
    element.name,
    element.id,
    element.getAttribute("placeholder") ?? "",
    element.getAttribute("aria-label") ?? "",
    element.getAttribute("data-name") ?? "",
  ].join(" ");
  return `${own} ${labelTextFor(element)}`
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .replace(/[_-]+/gu, " ");
}

function autocompleteTokens(element: FillableElement): string[] {
  return (element.getAttribute("autocomplete") ?? "").trim().toLowerCase().split(/\s+/u);
}

function isFillable(element: Element): element is FillableElement {
  if (element instanceof HTMLSelectElement) return !element.disabled;
  if (!(element instanceof HTMLInputElement)) return false;
  if (element.disabled || element.readOnly) return false;
  return TEXT_TYPES.has(element.type);
}

function candidates(root: Document | ShadowRoot): FillableElement[] {
  // Only fields a person can see: a hidden "saved card" template ahead of the form is not
  // where the number goes.
  return Array.from(root.querySelectorAll<Element>("input, select")).filter(
    (element): element is FillableElement => isFillable(element) && isDrawn(element),
  );
}

function classify<K extends string>(
  root: Document | ShadowRoot,
  byAutocomplete: Readonly<Record<string, K>>,
  keywords: readonly (readonly [K, RegExp])[],
): DataField<K>[] {
  const fields: DataField<K>[] = [];
  const taken = new Set<K>();
  for (const element of candidates(root)) {
    let kind: K | undefined;
    for (const token of autocompleteTokens(element)) {
      const mapped = byAutocomplete[token];
      if (mapped !== undefined) {
        kind = mapped;
        break;
      }
    }
    if (kind === undefined) {
      const text = describe(element);
      kind = keywords.find(([, pattern]) => pattern.test(text))?.[0];
    }
    if (kind === undefined || taken.has(kind)) continue;
    taken.add(kind);
    fields.push({ kind, element });
  }
  return fields;
}

/** Card fields on the page: number, holder name, expiry (split or combined) and security code. */
export function detectCardFields(root: Document | ShadowRoot): DataField<CardFieldKind>[] {
  const fields = classify(root, CARD_AUTOCOMPLETE, CARD_KEYWORDS);
  // A combined expiry only when no split month/year pair was found.
  const split = fields.some((field) => field.kind === "expMonth" || field.kind === "expYear");
  return split ? fields.filter((field) => field.kind !== "exp") : fields;
}

/** Identity fields on the page: names, contact details and the address. */
export function detectIdentityFields(root: Document | ShadowRoot): DataField<IdentityFieldKind>[] {
  return classify(root, IDENTITY_AUTOCOMPLETE, IDENTITY_KEYWORDS);
}
