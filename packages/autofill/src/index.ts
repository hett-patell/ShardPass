export { collectInputs, detectLoginFields } from "./detect-login-fields";
export type { DetectLoginFieldsOptions, LoginFieldSet } from "./detect-login-fields";
export { matchDomain, matchLoginUrl, matchLoginUrls, registrableDomain } from "./domain-match";
export type { UrlMatchMode } from "./domain-match";
export { fillLoginFields } from "./fill-login-fields";
export { equivalentDomainsOf } from "./equivalent-domains";
export { labelTextFor } from "./field-context";
export { detectCardFields, detectIdentityFields } from "./detect-data-fields";
export type {
  CardFieldKind,
  DataField,
  FillableElement,
  IdentityFieldKind,
} from "./detect-data-fields";
export { fillCardFields, fillField, fillIdentityFields } from "./fill-data-fields";
export type { CardFillValues, IdentityFillValues } from "./fill-data-fields";
export { fillInputLikeTyping } from "./fill-login-fields";
