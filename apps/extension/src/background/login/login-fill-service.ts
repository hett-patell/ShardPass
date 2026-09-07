import { matchLoginUrls } from "@shardpass/autofill";
import { ITEM_SCHEMA_VERSION, type LoginItem, type VaultItem } from "@shardpass/domain";
import {
  LoginFillRequestSchema,
  LoginFillResponseSchema,
  type LoginFillRequest,
  type LoginFillResponse,
  type LoginFillSuggestion,
  type SenderContext,
} from "@shardpass/messaging";
import { generateOtp, inlineTotpItem } from "@shardpass/otp";

import type { SessionVaultRepository } from "../vault/session-vault-repository";

type LoginFillRepository = Pick<
  SessionVaultRepository,
  "listAllItems" | "getItem" | "createItem" | "updateItem"
>;

const OFFER_TTL_MS = 5 * 60_000;
const MAX_OFFERS = 16;

type SaveLoginExisting = Extract<LoginFillResponse, { kind: "login.saveOfferResult" }>["existing"];

/** What the vault holds for an offered credential, as far as could be told. */
type Evaluation = Readonly<{
  existing: SaveLoginExisting;
  existingId: string | undefined;
  existingName: string | undefined;
}>;

const UNKNOWN: Evaluation = { existing: "locked", existingId: undefined, existingName: undefined };

type SaveOffer = Evaluation &
  Readonly<{
    tabId: number;
    domain: string;
    username: string;
    password: string;
    expiresAt: number;
  }>;

export type LoginFillServiceErrorCode =
  | "LOGIN_FILL_INVALID"
  | "LOGIN_FILL_UNAVAILABLE"
  | "LOGIN_FILL_NOT_FOUND"
  | "LOGIN_FILL_ITEM_CHANGED"
  | "VAULT_LOCKED";

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
  // (content-script only for every login.fill* command). The sender is still consulted:
  // a page is only ever handed a login saved for it, and save offers belong to the tab
  // that made them so the landing page after a sign-in can pick the prompt up again.
  async handle(request: LoginFillRequest, sender: SenderContext): Promise<LoginFillResponse> {
    try {
      const parsed = LoginFillRequestSchema.safeParse(request);
      if (!parsed.success) throw new LoginFillServiceError("LOGIN_FILL_INVALID");
      const command = parsed.data;
      switch (command.kind) {
        case "login.fillSuggestions":
          return validated(await this.suggestions(command.pageUrl ?? command.domain));
        case "login.fillSelect":
          return validated(
            await this.select(command.itemId, command.expectedRevision, sender.senderUrl),
          );
        case "login.reveal":
          // A deliberate act on an extension page, not a page asking for itself.
          return validated(await this.select(command.itemId, command.expectedRevision, null));
        case "login.saveOffer":
          return validated(
            await this.offer(tabOf(sender), command.domain, command.username, command.password),
          );
        case "login.pendingOffer":
          return validated(await this.pendingOffer(sender));
        case "login.saveConfirm":
          return validated(await this.confirm(command.offerId, command.choice));
        case "login.saveDismiss":
          this.offers.delete(command.offerId);
          return validated({ version: 1, kind: "login.fillAck", ok: true });
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
      if (!isLiveLogin(item)) continue;
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

  /**
   * Releases a login. `pageUrl` is the asking page: a content script is only handed a login
   * saved for the page it runs in, so a frame from elsewhere in the tab learns nothing.
   */
  private async select(
    itemId: string,
    expectedRevision: number,
    pageUrl: string | null,
  ): Promise<LoginFillResponse> {
    const item = await this.dependencies.repository.getItem(itemId);
    if (item === null || item.kind !== "login" || item.deletedAt !== undefined)
      throw new LoginFillServiceError("LOGIN_FILL_NOT_FOUND");
    if (pageUrl !== null && !matchLoginUrls(pageUrl, item.urls, item.urlMatches))
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
   * worker's memory; the page only learns an id. A locked vault holds the offer all the same
   * and judges it later. A tab keeps one offer: a newer submission supersedes the last.
   */
  private async offer(
    tabId: number,
    domain: string,
    username: string,
    password: string,
  ): Promise<LoginFillResponse> {
    const now = this.dependencies.now();
    this.prune(now);
    for (const [id, offer] of this.offers) if (offer.tabId === tabId) this.offers.delete(id);
    if (this.offers.size >= MAX_OFFERS) throw new LoginFillServiceError("LOGIN_FILL_UNAVAILABLE");
    let evaluation: Evaluation;
    try {
      evaluation = await this.evaluate(domain, username, password);
    } catch (error) {
      if (errorCode(error) !== "VAULT_LOCKED") throw error;
      evaluation = UNKNOWN;
    }
    const offerId = this.dependencies.nextOfferId?.() ?? randomOfferId();
    if (evaluation.existing !== "same") {
      this.offers.set(offerId, {
        ...evaluation,
        tabId,
        domain,
        username,
        password,
        expiresAt: now + OFFER_TTL_MS,
      });
    }
    return {
      version: 1,
      kind: "login.saveOfferResult",
      offerId,
      existing: evaluation.existing,
      ...(evaluation.existingName === undefined ? {} : { existingName: evaluation.existingName }),
    };
  }

  /** The offer held for the sender's tab, judged now if the vault was locked when it arrived. */
  private async pendingOffer(sender: SenderContext): Promise<LoginFillResponse> {
    const none: LoginFillResponse = { version: 1, kind: "login.pendingOfferResult", offer: null };
    // The banner belongs on the page, not inside an embedded frame.
    if (sender.contextKind !== "content" || sender.frameId !== 0) return none;
    this.prune(this.dependencies.now());
    const entry = [...this.offers].find(([, offer]) => offer.tabId === sender.tabId);
    if (entry === undefined) return none;
    let [, offer] = entry;
    const [offerId] = entry;
    if (offer.existing === "locked") {
      try {
        const evaluation = await this.evaluate(offer.domain, offer.username, offer.password);
        if (evaluation.existing === "same") {
          this.offers.delete(offerId);
          return none;
        }
        offer = { ...offer, ...evaluation };
        this.offers.set(offerId, offer);
      } catch (error) {
        if (errorCode(error) !== "VAULT_LOCKED") throw error;
      }
    }
    return {
      version: 1,
      kind: "login.pendingOfferResult",
      offer: {
        offerId,
        domain: offer.domain,
        username: offer.username,
        existing: offer.existing,
        ...(offer.existingName === undefined ? {} : { existingName: offer.existingName }),
      },
    };
  }

  /**
   * With a username, the login here under that username decides. Without one (a second
   * sign-in step, a change-password page) the domain's live logins are all there is to go
   * on: a same-password match means it is already saved, and a single login here is the one
   * a new password most likely belongs to.
   */
  private async evaluate(domain: string, username: string, password: string): Promise<Evaluation> {
    const items = await this.dependencies.repository.listAllItems();
    const wanted = normalize(username);
    const candidates = items.filter(
      (item): item is LoginItem => isLiveLogin(item) && matchLoginUrls(domain, item.urls, item.urlMatches),
    );
    const match =
      wanted === ""
        ? (candidates.find((item) => item.password === password) ??
          (candidates.length === 1 ? candidates[0] : undefined))
        : candidates.find((item) => normalize(item.username) === wanted);
    if (match === undefined) return { existing: "none", existingId: undefined, existingName: undefined };
    return {
      existing: match.password === password ? "same" : "different-password",
      existingId: match.id,
      existingName: match.name,
    };
  }

  private async confirm(offerId: string, choice: "new" | "update"): Promise<LoginFillResponse> {
    const offer = this.offers.get(offerId);
    // Single-use: taken out before any work, so a second confirm finds nothing.
    this.offers.delete(offerId);
    if (offer === undefined || offer.expiresAt <= this.dependencies.now())
      throw new LoginFillServiceError("LOGIN_FILL_NOT_FOUND");
    try {
      return await this.write(offer, choice);
    } catch (error) {
      // A vault that locked in between keeps the offer for after the unlock.
      if (errorCode(error) === "VAULT_LOCKED") this.offers.set(offerId, { ...offer, ...UNKNOWN });
      throw error;
    }
  }

  private async write(held: SaveOffer, choice: "new" | "update"): Promise<LoginFillResponse> {
    const offer: SaveOffer =
      held.existing === "locked"
        ? { ...held, ...(await this.evaluate(held.domain, held.username, held.password)) }
        : held;
    if (offer.existing === "same" && offer.existingId !== undefined)
      return { version: 1, kind: "login.saveResult", itemId: offer.existingId, saved: "updated" };
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

  private prune(now: number): void {
    for (const [id, offer] of this.offers) if (offer.expiresAt <= now) this.offers.delete(id);
  }

  private async noteActivity(): Promise<void> {
    try {
      await this.dependencies.notePrivilegedActivity();
    } catch {
      // Activity scheduling is best-effort and cannot invalidate a completed operation.
    }
  }
}

/** Archived logins are kept, not offered: they neither fill nor claim a submitted credential. */
function isLiveLogin(item: VaultItem): item is LoginItem {
  return item.kind === "login" && item.deletedAt === undefined && item.archivedAt === undefined;
}

function tabOf(sender: SenderContext): number {
  if (sender.tabId === undefined) throw new LoginFillServiceError("LOGIN_FILL_INVALID");
  return sender.tabId;
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
  if (value.kind === "login.pendingOfferResult" && value.offer !== null) Object.freeze(value.offer);
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
    code === "LOGIN_FILL_ITEM_CHANGED" ||
    code === "VAULT_LOCKED"
  )
    return new LoginFillServiceError(code);
  // A locked vault is worth telling the page about (it can say so, and hold its offer); every
  // other underlying failure collapses to the same opaque, metadata-free unavailable code.
  return new LoginFillServiceError("LOGIN_FILL_UNAVAILABLE");
}
