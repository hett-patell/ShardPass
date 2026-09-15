import type {
  CardFieldKind,
  DataField,
  FillableElement,
  IdentityFieldKind,
} from "./detect-data-fields";
import { fillInputLikeTyping } from "./fill-login-fields";

export type CardFillValues = Readonly<{
  number: string;
  cardholderName: string;
  expMonth: string;
  expYear: string;
  cvv: string;
}>;

export type IdentityFillValues = Readonly<{
  firstName: string;
  middleName?: string | undefined;
  lastName: string;
  email: string;
  phone: string;
  company?: string | undefined;
  username?: string | undefined;
  street: string;
  address2?: string | undefined;
  city: string;
  state: string;
  zip: string;
  country: string;
  birthDate?: string | undefined;
}>;

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Picks the option a person would: the same value or text (case-insensitively), a text
 * that starts with it, or, for months, the month's number, name or abbreviation.
 */
function selectOption(select: HTMLSelectElement, wanted: readonly string[]): boolean {
  const targets = wanted.map(normalize).filter((value) => value !== "");
  const options = Array.from(select.options);
  const match =
    options.find(
      (option) =>
        targets.includes(normalize(option.value)) || targets.includes(normalize(option.text)),
    ) ??
    options.find((option) =>
      targets.some((target) => target.length >= 2 && normalize(option.text).startsWith(target)),
    );
  if (match === undefined) return false;
  if (select.value === match.value) return true;
  select.value = match.value;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function monthForms(month: string): string[] {
  const number = Number.parseInt(month, 10);
  if (!Number.isInteger(number) || number < 1 || number > 12) return [month];
  const name = MONTHS[number - 1] ?? "";
  return [String(number), String(number).padStart(2, "0"), name, name.slice(0, 3)];
}

function yearForms(year: string): string[] {
  const digits = year.replace(/\D/gu, "");
  if (digits.length === 4) return [digits, digits.slice(2)];
  if (digits.length === 2) return [`20${digits}`, digits];
  return [year];
}

/** Writes `value` into the field the way typing (or picking) would; false when nothing fit. */
export function fillField(
  element: FillableElement,
  value: string,
  alternatives: readonly string[] = [],
): boolean {
  if (value === "" && alternatives.length === 0) return false;
  if (element instanceof HTMLSelectElement) return selectOption(element, [value, ...alternatives]);
  fillInputLikeTyping(element, value);
  return true;
}

function combinedExpiry(element: FillableElement, month: string, year: string): string {
  const mm = month.padStart(2, "0");
  const yyyy = yearForms(year)[0] ?? year;
  const maxLength = element instanceof HTMLInputElement ? element.maxLength : -1;
  const placeholder = (element.getAttribute("placeholder") ?? "").toLowerCase();
  const shortYear = (maxLength > 0 && maxLength <= 5) || /yy(?!yy)/u.test(placeholder);
  return `${mm}/${shortYear ? yyyy.slice(2) : yyyy}`;
}

/** Fills what the page has for the card; fields the page lacks are simply skipped. */
export function fillCardFields(
  fields: readonly DataField<CardFieldKind>[],
  card: CardFillValues,
): number {
  let filled = 0;
  for (const { kind, element } of fields) {
    const done =
      kind === "number"
        ? fillField(element, card.number.replace(/\s+/gu, ""))
        : kind === "name"
          ? fillField(element, card.cardholderName)
          : kind === "expMonth"
            ? fillField(element, card.expMonth.padStart(2, "0"), monthForms(card.expMonth))
            : kind === "expYear"
              ? fillField(
                  element,
                  yearForms(card.expYear)[0] ?? card.expYear,
                  yearForms(card.expYear),
                )
              : kind === "exp"
                ? card.expMonth !== "" &&
                  card.expYear !== "" &&
                  fillField(element, combinedExpiry(element, card.expMonth, card.expYear))
                : fillField(element, card.cvv);
    if (done) filled += 1;
  }
  return filled;
}

/** Fills what the page has for the identity; a full-name field gets first and last together. */
export function fillIdentityFields(
  fields: readonly DataField<IdentityFieldKind>[],
  identity: IdentityFillValues,
): number {
  const values: Readonly<Record<IdentityFieldKind, string>> = {
    firstName: identity.firstName,
    middleName: identity.middleName ?? "",
    lastName: identity.lastName,
    fullName: [identity.firstName, identity.middleName ?? "", identity.lastName]
      .filter((part) => part !== "")
      .join(" "),
    email: identity.email,
    phone: identity.phone,
    company: identity.company ?? "",
    username: identity.username ?? "",
    street: identity.street,
    address2: identity.address2 ?? "",
    city: identity.city,
    state: identity.state,
    zip: identity.zip,
    country: identity.country,
    birthDate: identity.birthDate ?? "",
  };
  let filled = 0;
  for (const { kind, element } of fields) if (fillField(element, values[kind])) filled += 1;
  return filled;
}
