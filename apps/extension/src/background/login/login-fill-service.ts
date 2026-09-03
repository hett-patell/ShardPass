import { matchLoginUrls } from "@shardpass/autofill";
import {
  LoginFillRequestSchema,
  LoginFillResponseSchema,
  type LoginFillRequest,
  type LoginFillResponse,
  type LoginFillSuggestion,
} from "@shardpass/messaging";
import { generateOtp } from "@shardpass/otp";

import type { SessionVaultRepository } from "../vault/session-vault-repository";

type LoginFillRepository = Pick<SessionVaultRepository, "listAllItems" | "getItem">;

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
}>;

export class LoginFillService {
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
          return validated(await this.select(command.itemId, command.expectedRevision));
        case "login.fillConfirm":
        case "login.fillCancel":
        case "login.saveOffer":
          // Fire-and-forget acknowledgements: unlike `fillSelect`, none of these three
          // commands reveal a secret or mutate the vault, so they need no capability or
          // session state to acknowledge. `saveOffer` in particular does not create a
          // vault item on its own — it only signals that a new credential was observed
          // on a page; turning that into a saved login is a user-facing decision left to
          // a later, UI-driving task.
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
        hasLinkedOtp: item.linkedOtpId !== undefined,
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
    if (item.linkedOtpId !== undefined) {
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
