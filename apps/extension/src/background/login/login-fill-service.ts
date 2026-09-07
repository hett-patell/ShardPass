import { matchLoginUrls } from "@shardpass/autofill";
import { ITEM_SCHEMA_VERSION, type LoginItem } from "@shardpass/domain";
import {
  LoginFillRequestSchema,
  LoginFillResponseSchema,
  type LoginFillRequest,
  type LoginFillResponse,
  type LoginFillSuggestion,
} from "@shardpass/messaging";
import { generateOtp, inlineTotpItem } from "@shardpass/otp";

import type { SessionVaultRepository } from "../vault/session-vault-repository";

type LoginFillRepository = Pick<
  SessionVaultRepository,
  "listAllItems" | "getItem" | "createItem" | "updateItem"
>;

const OFFER_TTL_MS = 5 * 60_000;
const MAX_OFFERS = 16;

type SaveOffer = Readonly<{
  domain: string;
  username: string;
  password: string;
  existingId: string | undefined;
  expiresAt: number;
}>;

export type LoginFillServiceErrorCode =
  | "LOGIN_FILL_INVALID"
  | "LOGIN_FILL_UNAVAILABLE"
  | "LOGIN_FILL_NOT_FOUND"
  | "LOGIN_FILL_ITEM_CHANGED";

export class LoginFillServiceError extends Error {
  constructor(readonly code: LoginFillServiceErrorCode) {
    super(code);
    this.name = "LoginFillServiceError";
  }
}

type LoginFillServiceDependencies = Readonly<{
  repository: LoginFillRepository;
  now(): number;
  notePrivilegedActivity(): Promise<void>;
  /** 32 hex characters; the offer id the page names later. */
  nextOfferId?(): string;
}>;

export class LoginFillService {
  private readonly offers = new Map<string, SaveOffer>();

  constructor(private readonly dependencies: LoginFillServiceDependencies) {}

  // The router already authorizes the sender per command kind before dispatching here
  // (content-script only for every login.fill* command); unlike OtpFillService, this
  // protocol carries no capability/field binding to cross-check against the sender, so
  // `sender` is accepted only to keep the handle(request, sender) shape every background
  // service exposes to the router, not used internally.
  async handle(request: LoginFillRequest): Promise<LoginFillResponse> {
    try {
      const parsed = LoginFillRequestSchema.safeParse(request);
      if (!parsed.success) throw new LoginFillServiceError("LOGIN_FILL_INVALID");
      const command = parsed.data;
      switch (command.kind) {
        case "login.fillSuggestions":
          return validated(await this.suggestions(command.pageUrl ?? command.domain));
        case "login.fillSelect":
        case "login.reveal":
          return validated(await this.select(command.itemId, command.expectedRevision));
        case "login.saveOffer":
          return validated(await this.offer(command.domain, command.username, command.password));
        case "login.saveConfirm":
          return validated(await this.confirm(command.offerId, command.choice));
        case "login.fillConfirm":
        case "login.fillCancel":
          // Fire-and-forget acknowledgements: neither reveals a secret nor mutates the vault.
          return validated({ version: 1, kind: "login.fillAck", ok: true });
      }
    } catch (error) {
      throw mapError(error);
    }
  }

  private async suggestions(domain: string): Promise<LoginFillResponse> {
    const items = await this.dependencies.repository.listAllItems();
    const suggestions: LoginFillSuggestion[] = [];
    for (const item of items) {
      if (item.kind !== "login" || item.deletedAt !== undefined) continue;
      if (!matchLoginUrls(domain, item.urls, item.urlMatches)) continue;
      suggestions.push({
        itemId: item.id,
        expectedRevision: item.revision,
        name: item.name,
        username: item.username,
        favorite: item.favorite,
        tags: [...item.tags],
        hasLinkedOtp: item.linkedOtpId !== undefined || (item.totp ?? "").trim() !== "",
      });
    }
    suggestions.sort(compareSuggestions);
    // Not activity: the content script asks for suggestions on every page it lands on, so
    // counting it would keep the vault unlocked for as long as the browser is in use.
    // Selecting a suggestion (select) is the deliberate act, and does count.
    return { version: 1, kind: "login.fillSuggestionsResult", suggestions };
  }

  private async select(itemId: string, expectedRevision: number): Promise<LoginFillResponse> {
    const item = await this.dependencies.repository.getItem(itemId);
    if (item === null || item.kind !== "login" || item.deletedAt !== undefined)
      throw new LoginFillServiceError("LOGIN_FILL_NOT_FOUND");
    if (item.revision !== expectedRevision)
      throw new LoginFillServiceError("LOGIN_FILL_ITEM_CHANGED");
    let linkedOtpCode: string | undefined;
    // An inline one-time secret on the login itself: the code travels with the fill so the
    // page's next step is already on the clipboard.
    const inline = inlineTotpItem(item);
    if (inline !== null && inline.otpType !== "hotp") {
      try {
        linkedOtpCode = (await generateOtp(inline, this.dependencies.now())).code;
      } catch {
        // A malformed inline secret must not block the fill itself.
      }
    }
    if (linkedOtpCode === undefined && item.linkedOtpId !== undefined) {
      const linked = await this.dependencies.repository.getItem(item.linkedOtpId);
      // HOTP codes are intentionally excluded: reading one here would not advance its
      // counter (unlike a proper HOTP reservation/commit), so repeatedly filling the
      // same login would keep releasing the same code — the same reuse risk OtpService
      // guards against by rejecting `otp.getCode` for HOTP items outright.
      if (
        linked !== null &&
        linked.kind === "otp" &&
        linked.deletedAt === undefined &&
        linked.otpType !== "hotp"
      ) {
        const generated = await generateOtp(linked, this.dependencies.now());
        linkedOtpCode = generated.code;
      }
    }
    await this.noteActivity();
    return {
      version: 1,
      kind: "login.fillRelease",
      username: item.username,
      password: item.password,
      ...(linkedOtpCode === undefined ? {} : { linkedOtpCode }),
    };
  }

  /**
   * Holds a credential the page just submitted and says what the vault has for it, so the
   * in-page prompt can offer "save new" or "update password". The password never leaves the
   * worker's memory; the page only learns an id.
   */
  private async offer(domain: string, username: string, password: string): Promise<LoginFillResponse> {
    const now = this.dependencies.now();
    for (const [id, offer] of this.offers) if (offer.expiresAt <= now) this.offers.delete(id);
    if (this.offers.size >= MAX_OFFERS) throw new LoginFillServiceError("LOGIN_FILL_UNAVAILABLE");
    const items = await this.dependencies.repository.listAllItems();
    const wanted = normalize(username);
    const match = items.find(
      (item): item is LoginItem =>
        item.kind === "login" &&
        item.deletedAt === undefined &&
        normalize(item.username) === wanted &&
        matchLoginUrls(domain, item.urls, item.urlMatches),
    );
    const existing = match === undefined ? "none" : match.password === password ? "same" : "different-password";
    const offerId = this.dependencies.nextOfferId?.() ?? randomOfferId();
    this.offers.set(offerId, {
      domain,
      username,
      password,
      existingId: match?.id,
      expiresAt: now + OFFER_TTL_MS,
    });
    return {
      version: 1,
      kind: "login.saveOfferResult",
      offerId,
      existing,
      ...(match === undefined ? {} : { existingName: match.name }),
    };
  }

  private async confirm(offerId: string, choice: "new" | "update"): Promise<LoginFillResponse> {
    const offer = this.offers.get(offerId);
    this.offers.delete(offerId);
    if (offer === undefined || offer.expiresAt <= this.dependencies.now())
      throw new LoginFillServiceError("LOGIN_FILL_NOT_FOUND");
    if (choice === "update" && offer.existingId !== undefined) {
      const current = await this.dependencies.repository.getItem(offer.existingId);
      if (current === null || current.kind !== "login") throw new LoginFillServiceError("LOGIN_FILL_NOT_FOUND");
      const history = [
        { password: current.password, changedAt: current.updatedAt },
        ...(current.passwordHistory ?? []),
      ].slice(0, 10);
      const updated = await this.dependencies.repository.updateItem(
        { ...current, password: offer.password, passwordHistory: history },
        current.revision,
      );
      await this.noteActivity();
      return { version: 1, kind: "login.saveResult", itemId: updated.id, saved: "updated" };
    }
    const stamp = new Date(this.dependencies.now()).toISOString();
    const created = await this.dependencies.repository.createItem({
      id: crypto.randomUUID(),
      kind: "login",
      schemaVersion: ITEM_SCHEMA_VERSION,
      revision: 1,
      createdAt: stamp,
      updatedAt: stamp,
      favorite: false,
      tags: [],
      name: offer.domain.replace(/^www\./u, ""),
      username: offer.username,
      password: offer.password,
      urls: [`https://${offer.domain}`],
      notes: "",
    });
    await this.noteActivity();
    return { version: 1, kind: "login.saveResult", itemId: created.id, saved: "created" };
  }

  private async noteActivity(): Promise<void> {
    try {
      await this.dependencies.notePrivilegedActivity();
    } catch {
      // Activity scheduling is best-effort and cannot invalidate a completed operation.
    }
  }
}

function compareSuggestions(left: LoginFillSuggestion, right: LoginFillSuggestion): number {
  if (left.favorite !== right.favorite) return left.favorite ? -1 : 1;
  return (
    compareText(normalize(left.name), normalize(right.name)) ||
    compareText(normalize(left.username), normalize(right.username)) ||
    compareText(left.itemId, right.itemId)
  );
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function randomOfferId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validated(candidate: LoginFillResponse): LoginFillResponse {
  const parsed = LoginFillResponseSchema.safeParse(candidate);
  if (!parsed.success) throw new LoginFillServiceError("LOGIN_FILL_UNAVAILABLE");
  return freezeResponse(parsed.data);
}

function freezeResponse(value: LoginFillResponse): LoginFillResponse {
  if (value.kind === "login.fillSuggestionsResult") {
    for (const suggestion of value.suggestions) {
      Object.freeze(suggestion.tags);
      Object.freeze(suggestion);
    }
    Object.freeze(value.suggestions);
  }
  return Object.freeze(value);
}

function errorCode(error: unknown): unknown {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return (error as { readonly code?: unknown }).code;
}

function mapError(error: unknown): LoginFillServiceError {
  if (error instanceof LoginFillServiceError) return error;
  const code = errorCode(error);
  if (
    code === "LOGIN_FILL_INVALID" ||
    code === "LOGIN_FILL_UNAVAILABLE" ||
    code === "LOGIN_FILL_NOT_FOUND" ||
    code === "LOGIN_FILL_ITEM_CHANGED"
  )
    return new LoginFillServiceError(code);
  // VAULT_LOCKED and every other underlying failure collapse to the same opaque,
  // metadata-free unavailable code, matching OtpFillServiceError's own mapping.
  return new LoginFillServiceError("LOGIN_FILL_UNAVAILABLE");
}
