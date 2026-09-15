import { secureRandomIndex } from "./password-generator";
import { EFF_WORDLIST } from "./wordlist";

export type UsernameKind = "word" | "random" | "plus" | "catchall";

export interface UsernameOptions {
  /** Two words with a number ("quiet.falcon42"), random letters, a plus-address, or a catch-all address. */
  kind: UsernameKind;
  /** The address plus-addressing builds on ("me@example.com" → "me+tag@example.com"). */
  email?: string;
  /** The catch-all domain ("example.com" → "quiet.falcon42@example.com"). */
  domain?: string;
  /** The site the name is for; a plus-address tag starts with it so the source of mail is obvious. */
  site?: string;
  /** Random-kind length, in [6, 32]; defaults to 12. */
  length?: number;
  /** Whether word-kind names carry a number; defaults to true. */
  number?: boolean;
  /** Capitalise each word ("Quiet.Falcon42"); defaults to false. */
  capitalize?: boolean;
}

export interface GeneratedUsername {
  username: string;
  entropyBits: number;
}

const RANDOM_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const MIN_RANDOM_LENGTH = 6;
const MAX_RANDOM_LENGTH = 32;
const NUMBER_DIGITS = 2;

/**
 * Generates a username or e-mail address. Plus-addressing keeps mail flowing to one inbox
 * while giving every site its own address; a catch-all domain does the same with a fresh
 * local part. Both need the address or domain they build on, so the caller passes them.
 */
export function generateUsername(options: UsernameOptions): GeneratedUsername {
  switch (options.kind) {
    case "word":
      return wordName(options);
    case "random":
      return randomName(options.length ?? 12);
    case "plus":
      return plusAddress(options);
    case "catchall":
      return catchAllAddress(options);
  }
}

function wordName(options: UsernameOptions): GeneratedUsername {
  const withNumber = options.number ?? true;
  const words = [pickWord(), pickWord()].map((word) =>
    options.capitalize === true ? word.charAt(0).toUpperCase() + word.slice(1) : word,
  );
  const suffix = withNumber ? digits(NUMBER_DIGITS) : "";
  return {
    username: `${words.join(".")}${suffix}`,
    entropyBits:
      2 * Math.log2(EFF_WORDLIST.length) + (withNumber ? NUMBER_DIGITS * Math.log2(10) : 0),
  };
}

function randomName(length: number): GeneratedUsername {
  if (!Number.isInteger(length) || length < MIN_RANDOM_LENGTH || length > MAX_RANDOM_LENGTH)
    throw new RangeError(
      `length must be an integer in [${MIN_RANDOM_LENGTH}, ${MAX_RANDOM_LENGTH}].`,
    );
  // A letter first: some sites refuse a name that starts with a digit.
  let username = RANDOM_ALPHABET.charAt(secureRandomIndex(26));
  for (let index = 1; index < length; index += 1)
    username += RANDOM_ALPHABET.charAt(secureRandomIndex(RANDOM_ALPHABET.length));
  return {
    username,
    entropyBits: Math.log2(26) + (length - 1) * Math.log2(RANDOM_ALPHABET.length),
  };
}

function plusAddress(options: UsernameOptions): GeneratedUsername {
  const email = (options.email ?? "").trim();
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1 || /\s/u.test(email))
    throw new RangeError("Plus-addressing needs an e-mail address.");
  // A tag the person already has ("me+shop") is replaced, not stacked.
  const local = email.slice(0, at).split("+")[0] ?? "";
  const domain = email.slice(at + 1);
  const site = siteSlug(options.site);
  const random = digits(4);
  const tag = site === "" ? `${pickWord()}${random}` : `${site}${random}`;
  return {
    username: `${local}+${tag}@${domain}`,
    entropyBits: 4 * Math.log2(10) + (site === "" ? Math.log2(EFF_WORDLIST.length) : 0),
  };
}

function catchAllAddress(options: UsernameOptions): GeneratedUsername {
  const domain = (options.domain ?? "").trim().replace(/^@/u, "").toLowerCase();
  if (domain === "" || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/u.test(domain))
    throw new RangeError("A catch-all address needs a domain.");
  const site = siteSlug(options.site);
  const local = site === "" ? wordName({ kind: "word" }).username : `${site}.${digits(4)}`;
  return {
    username: `${local}@${domain}`,
    entropyBits:
      site === ""
        ? 2 * Math.log2(EFF_WORDLIST.length) + NUMBER_DIGITS * Math.log2(10)
        : 4 * Math.log2(10),
  };
}

function pickWord(): string {
  return EFF_WORDLIST[secureRandomIndex(EFF_WORDLIST.length)] as string;
}

function digits(count: number): string {
  let out = "";
  for (let index = 0; index < count; index += 1) out += String(secureRandomIndex(10));
  return out;
}

/** "accounts.shop.example.co.uk" → "example"; a bare word stays; anything unusable → "". */
export function siteSlug(site: string | undefined): string {
  const host = (site ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//u, "")
    .split(/[/?#:]/u)[0] as string;
  const labels = host.split(".").filter((label) => label !== "" && label !== "www");
  if (labels.length === 0) return "";
  // Second-level public suffixes ("co.uk") hide the real name one label further in.
  const publicSecond = new Set(["co", "com", "org", "net", "gov", "edu", "ac"]);
  let index = labels.length - 2;
  if (
    index >= 1 &&
    publicSecond.has(labels[index] as string) &&
    (labels[index + 1] as string).length <= 3
  )
    index -= 1;
  const name = labels[Math.max(0, index)] as string;
  return name.replace(/[^a-z0-9]/gu, "").slice(0, 24);
}
