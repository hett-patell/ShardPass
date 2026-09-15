import {
  LoginItemSchema,
  MAX_OTP_ISSUER_LENGTH,
  MAX_OTP_LABEL_LENGTH,
  OtpItemSchema,
  type LoginItem,
  type OtpItem,
} from "@shardpass/domain";
import { matchLoginUrls, registrableDomain } from "@shardpass/autofill";
import {
  OTP_FILL_LIMITS,
  OtpFillRequestSchema,
  OtpFillResponseSchema,
  type OtpFillRequest,
  type OtpFillResponse,
  type OtpFillSuggestion,
  type SenderContext,
} from "@shardpass/messaging";
import { generateOtp, inlineTotpItem, type ReservationBinding } from "@shardpass/otp";

import type { InternalHotpLifecycle } from "./hotp-lifecycle";
import type { SessionVaultRepository } from "../vault/session-vault-repository";

export type OtpFillServiceErrorCode =
  | "OTP_FILL_INVALID"
  | "OTP_FILL_UNAVAILABLE"
  | "OTP_FILL_EXPIRED"
  | "OTP_FILL_FIELD_CHANGED"
  | "OTP_FILL_ITEM_CHANGED"
  | "OTP_FILL_CANCELLED"
  | "OTP_FILL_UNCERTAIN";

export class OtpFillServiceError extends Error {
  constructor(readonly code: OtpFillServiceErrorCode) {
    super(code);
    this.name = "OtpFillServiceError";
  }
}

type SessionAuthority = object;
type Repository = Pick<SessionVaultRepository, "listItems" | "getItem">;
type Binding = Readonly<{
  extensionId: string;
  tabId: number;
  frameId: number;
  documentId: string;
  origin: string;
  fieldHandle: string;
}>;
type Capability = Readonly<{
  id: string;
  binding: Binding;
  authority: SessionAuthority;
  expiresAt: number;
  revisions: ReadonlyMap<string, number>;
}>;
type Release = Readonly<{
  id: string;
  binding: Binding;
  authority: SessionAuthority;
  itemId: string;
  itemRevision: number;
  expiresAt: number;
  hotpReservationId?: string;
}>;
type Terminal = Readonly<{
  binding: Binding;
  expiresAt: number;
  response: OtpFillResponse;
}>;
type SuggestionOwner = Readonly<{ generation: number }>;
type TerminalOwner = Readonly<{
  binding: Binding;
  promise: Promise<OtpFillResponse>;
}>;

type Dependencies = Readonly<{
  repository: Repository;
  hotp: InternalHotpLifecycle;
  now(): number;
  nextOpaqueId(): string;
  captureSession(): Promise<SessionAuthority>;
  assertSession(authority: SessionAuthority): Promise<void>;
  notePrivilegedActivity(): Promise<void>;
  registerCleanup?(cleanup: () => void): () => void;
}>;

export class OtpFillService {
  private readonly capabilities = new Map<string, Capability>();
  private readonly capabilityByField = new Map<string, string>();
  private readonly releases = new Map<string, Release>();
  private readonly terminals = new Map<string, Terminal>();
  private readonly suggestionOwners = new Map<string, SuggestionOwner>();
  private readonly terminalOwners = new Map<string, TerminalOwner>();
  private readonly pendingCapabilityDocuments = new Map<string, number>();
  private pendingCapabilitiesGlobal = 0;
  private pendingReleasesGlobal = 0;
  private invalidationGeneration = 0;
  private readonly unregisterCleanup: () => void;
  private disposed = false;

  constructor(private readonly dependencies: Dependencies) {
    this.unregisterCleanup =
      dependencies.registerCleanup?.(() => this.clearSessionAuthority()) ?? (() => undefined);
  }

  async handle(request: OtpFillRequest, sender: SenderContext): Promise<OtpFillResponse> {
    if (this.disposed) throw new OtpFillServiceError("OTP_FILL_UNAVAILABLE");
    const parsed = OtpFillRequestSchema.safeParse(request);
    if (!parsed.success) throw new OtpFillServiceError("OTP_FILL_INVALID");
    const binding = senderBinding(sender, parsed.data.fieldHandle);
    const generation = this.invalidationGeneration;
    this.prune();
    try {
      let result: OtpFillResponse;
      switch (parsed.data.kind) {
        case "otp.fillSuggestions":
          result = await this.suggestions(binding);
          break;
        case "otp.fillSelect":
          result = await this.select(
            parsed.data.capability,
            parsed.data.itemId,
            parsed.data.expectedRevision,
            binding,
          );
          break;
        case "otp.fillConfirm":
          result = await this.confirm(parsed.data.releaseId, parsed.data.result, binding);
          break;
        case "otp.fillCancel":
          result = await this.cancel(parsed.data.releaseId, binding);
          break;
      }
      this.assertGeneration(generation);
      return validated(result);
    } catch (error) {
      throw mapError(error);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unregisterCleanup();
    this.clearSessionAuthority();
  }

  private async suggestions(binding: Binding): Promise<OtpFillResponse> {
    const documentKey = documentBindingKey(binding);
    const fieldKey = bindingKey(binding);
    const previous = this.capabilityByField.get(fieldKey);
    const owner = Object.freeze({ generation: this.invalidationGeneration });
    const documentCount = [...this.capabilities.values()].filter((value) =>
      sameDocument(value.binding, binding),
    ).length;
    if (
      this.capabilities.size + this.pendingCapabilitiesGlobal >=
        OTP_FILL_LIMITS.maxCapabilitiesGlobal ||
      (previous === undefined &&
        documentCount + (this.pendingCapabilityDocuments.get(documentKey) ?? 0) >=
          OTP_FILL_LIMITS.maxCapabilitiesPerDocument)
    )
      throw new OtpFillServiceError("OTP_FILL_UNAVAILABLE");
    this.suggestionOwners.set(fieldKey, owner);
    this.pendingCapabilitiesGlobal += 1;
    this.pendingCapabilityDocuments.set(
      documentKey,
      (this.pendingCapabilityDocuments.get(documentKey) ?? 0) + 1,
    );
    try {
      const authority = await this.dependencies.captureSession();
      this.assertOwner(owner, fieldKey);
      const candidates = await this.dependencies.repository.listItems();
      this.assertOwner(owner, fieldKey);
      await this.dependencies.assertSession(authority);
      this.assertOwner(owner, fieldKey);
      // The page's site decides the order: accounts whose issuer or label names it, and the
      // one linked from a login saved for it, come first; the rest follow.
      const site = siteOf(binding.origin);
      const linked = new Set<string>();
      for (const candidate of candidates) {
        const login = LoginItemSchema.safeParse(candidate);
        if (
          !login.success ||
          login.data.deletedAt !== undefined ||
          login.data.archivedAt !== undefined
        )
          continue;
        if (
          login.data.linkedOtpId !== undefined &&
          matchLoginUrls(site.host, login.data.urls, login.data.urlMatches)
        )
          linked.add(login.data.linkedOtpId);
      }
      const all: OtpFillSuggestion[] = [];
      for (const candidate of candidates) {
        const source = otpSourceOf(candidate);
        if (source === null) continue;
        const parsed = { data: source.item };
        // A login's own one-time secret belongs to the sites the login is saved for.
        const siteMatch =
          source.login !== undefined
            ? matchLoginUrls(site.host, source.login.urls, source.login.urlMatches)
            : linked.has(parsed.data.id) || namesSite(parsed.data, site);
        // A time-based code for the page's own account is shown in the dropdown; a
        // counter-based one is never generated before a pick (it would burn the counter).
        let preview: OtpFillSuggestion["preview"];
        if (siteMatch && parsed.data.otpType !== "hotp") {
          try {
            const generated = await generateOtp(parsed.data, this.dependencies.now());
            preview = {
              code: generated.code,
              expiresAt: generated.expiresAt ?? this.dependencies.now(),
            };
          } catch {
            preview = undefined;
          }
        }
        all.push(project(parsed.data, siteMatch, preview));
      }
      all.sort(compareSuggestions);
      const projected = all.slice(0, OTP_FILL_LIMITS.maxSuggestions);
      const id = this.dependencies.nextOpaqueId();
      const expiresAt = this.dependencies.now() + OTP_FILL_LIMITS.suggestionTtlMs;
      const capability: Capability = Object.freeze({
        id,
        binding,
        authority,
        expiresAt,
        revisions: new Map(projected.map((item) => [item.itemId, item.expectedRevision])),
      });
      this.assertOwner(owner, fieldKey);
      if (previous !== undefined) this.capabilities.delete(previous);
      this.capabilities.set(id, capability);
      this.capabilityByField.set(fieldKey, id);
      return freezeResponse({
        version: 1,
        kind: "otp.fillSuggestionsResult",
        capability: id,
        expiresAt,
        suggestions: projected,
      });
    } finally {
      if (this.suggestionOwners.get(fieldKey) === owner) this.suggestionOwners.delete(fieldKey);
      this.pendingCapabilitiesGlobal -= 1;
      const remaining = (this.pendingCapabilityDocuments.get(documentKey) ?? 1) - 1;
      if (remaining === 0) this.pendingCapabilityDocuments.delete(documentKey);
      else this.pendingCapabilityDocuments.set(documentKey, remaining);
    }
  }

  private async select(
    capabilityId: string,
    itemId: string,
    expectedRevision: number,
    binding: Binding,
  ): Promise<OtpFillResponse> {
    if (this.releases.size + this.pendingReleasesGlobal >= OTP_FILL_LIMITS.maxReleasesGlobal)
      throw new OtpFillServiceError("OTP_FILL_UNAVAILABLE");
    const capability = this.capabilities.get(capabilityId);
    if (capability === undefined) throw new OtpFillServiceError("OTP_FILL_INVALID");
    if (!sameBinding(capability.binding, binding)) {
      if (!sameField(capability.binding, binding))
        throw new OtpFillServiceError("OTP_FILL_FIELD_CHANGED");
      throw new OtpFillServiceError("OTP_FILL_INVALID");
    }
    if (capability.expiresAt <= this.dependencies.now())
      throw new OtpFillServiceError("OTP_FILL_EXPIRED");
    if (capability.revisions.get(itemId) !== expectedRevision)
      throw new OtpFillServiceError("OTP_FILL_ITEM_CHANGED");
    this.consumeCapability(capability);
    const generation = this.invalidationGeneration;
    this.pendingReleasesGlobal += 1;
    try {
      return await this.createRelease(capability, itemId, expectedRevision, binding, generation);
    } finally {
      this.pendingReleasesGlobal -= 1;
    }
  }

  private async createRelease(
    capability: Capability,
    itemId: string,
    expectedRevision: number,
    binding: Binding,
    generation: number,
  ): Promise<OtpFillResponse> {
    await this.assertAuthority(capability.authority);
    this.assertGeneration(generation);
    const candidate = await this.dependencies.repository.getItem(itemId);
    this.assertGeneration(generation);
    const source = otpSourceOf(candidate);
    if (source === null || source.item.revision !== expectedRevision)
      throw new OtpFillServiceError("OTP_FILL_ITEM_CHANGED");
    const parsed = { data: source.item };
    await this.assertAuthority(capability.authority);
    this.assertGeneration(generation);

    const releaseId = this.dependencies.nextOpaqueId();
    const bindingForReservation = reservationBinding(binding);
    let code: string;
    let sourceExpiresAt: number;
    let hotpReservationId: string | undefined;
    if (parsed.data.otpType === "hotp") {
      const hotp = await this.dependencies.hotp.reserve(
        itemId,
        expectedRevision,
        bindingForReservation,
      );
      code = hotp.code;
      sourceExpiresAt = hotp.expiresAt;
      hotpReservationId = hotp.reservationId;
    } else {
      const generated = await generateOtp(parsed.data, this.dependencies.now());
      code = generated.code;
      sourceExpiresAt = generated.expiresAt ?? this.dependencies.now();
    }
    try {
      this.assertGeneration(generation);
      await this.assertAuthority(capability.authority);
      this.assertGeneration(generation);
    } catch (error) {
      if (hotpReservationId !== undefined)
        await this.dependencies.hotp
          .cancel(hotpReservationId, bindingForReservation)
          .catch(() => undefined);
      throw error;
    }
    const releaseNow = this.dependencies.now();
    const expiresAt = Math.min(releaseNow + OTP_FILL_LIMITS.releaseTtlMs, sourceExpiresAt);
    if (expiresAt <= releaseNow) {
      if (hotpReservationId !== undefined)
        await this.dependencies.hotp
          .cancel(hotpReservationId, bindingForReservation)
          .catch(() => undefined);
      throw new OtpFillServiceError("OTP_FILL_EXPIRED");
    }
    this.assertGeneration(generation);
    const release: Release = Object.freeze({
      id: releaseId,
      binding,
      authority: capability.authority,
      itemId,
      itemRevision: expectedRevision,
      expiresAt,
      ...(hotpReservationId === undefined ? {} : { hotpReservationId }),
    });
    this.releases.set(releaseId, release);
    return Object.freeze({
      version: 1,
      kind: "otp.fillRelease",
      releaseId,
      code,
      expiresAt,
      codeLength: code.length,
      characterClass: parsed.data.otpType === "steam" ? "steam" : "digits",
    });
  }

  private confirm(
    releaseId: string,
    result: "filled" | "failed",
    binding: Binding,
  ): Promise<OtpFillResponse> {
    const owner = this.terminalOwners.get(releaseId);
    if (owner !== undefined) {
      if (!sameBinding(owner.binding, binding))
        return Promise.reject(new OtpFillServiceError("OTP_FILL_INVALID"));
      return owner.promise;
    }
    const promise = this.confirmOwned(releaseId, result, binding);
    const nextOwner = Object.freeze({ binding, promise });
    this.terminalOwners.set(releaseId, nextOwner);
    const clearOwner = (): void => {
      if (this.terminalOwners.get(releaseId) === nextOwner) this.terminalOwners.delete(releaseId);
    };
    void promise.then(clearOwner, clearOwner);
    return promise;
  }

  private async confirmOwned(
    releaseId: string,
    result: "filled" | "failed",
    binding: Binding,
  ): Promise<OtpFillResponse> {
    const terminal = this.terminals.get(releaseId);
    if (terminal !== undefined) {
      if (!sameBinding(terminal.binding, binding))
        throw new OtpFillServiceError("OTP_FILL_INVALID");
      return terminal.response;
    }
    const release = this.consumeRelease(releaseId, binding);
    const generation = this.invalidationGeneration;
    if (release.expiresAt <= this.dependencies.now()) {
      void this.cancelHotp(release);
      throw new OtpFillServiceError("OTP_FILL_EXPIRED");
    }
    await this.assertAuthority(release.authority);
    this.assertGeneration(generation);
    const current = otpSourceOf(await this.dependencies.repository.getItem(release.itemId));
    this.assertGeneration(generation);
    if (current === null || current.item.revision !== release.itemRevision) {
      void this.cancelHotp(release);
      throw new OtpFillServiceError("OTP_FILL_ITEM_CHANGED");
    }
    let terminalResult: OtpFillResponse;
    if (result === "failed") {
      await this.cancelHotp(release);
      terminalResult = { version: 1, kind: "otp.fillConfirmed", result: "cancelled" };
    } else if (release.hotpReservationId !== undefined) {
      try {
        await this.dependencies.hotp.confirm(
          release.hotpReservationId,
          reservationBinding(release.binding),
        );
        this.assertGeneration(generation);
        terminalResult = { version: 1, kind: "otp.fillConfirmed", result: "committed" };
      } catch (error) {
        if (errorCode(error) === "OTP_FILL_UNCERTAIN") {
          terminalResult = { version: 1, kind: "otp.fillConfirmed", result: "uncertain" };
        } else throw error;
      }
    } else {
      terminalResult = { version: 1, kind: "otp.fillConfirmed", result: "committed" };
    }
    this.assertGeneration(generation);
    this.retainTerminal(releaseId, binding, terminalResult);
    if (terminalResult.kind === "otp.fillConfirmed" && terminalResult.result === "committed")
      void this.dependencies.notePrivilegedActivity().catch(() => undefined);
    return terminalResult;
  }

  private async cancel(releaseId: string, binding: Binding): Promise<OtpFillResponse> {
    const terminal = this.terminals.get(releaseId);
    if (terminal !== undefined) {
      if (!sameBinding(terminal.binding, binding))
        throw new OtpFillServiceError("OTP_FILL_INVALID");
      return { version: 1, kind: "otp.fillCancelled", cancelled: true };
    }
    const release = this.consumeRelease(releaseId, binding);
    const generation = this.invalidationGeneration;
    await this.cancelHotp(release);
    this.assertGeneration(generation);
    const response = { version: 1, kind: "otp.fillCancelled", cancelled: true } as const;
    this.retainTerminal(releaseId, binding, response);
    return response;
  }

  private consumeRelease(releaseId: string, binding: Binding): Release {
    const release = this.releases.get(releaseId);
    if (release === undefined || !sameBinding(release.binding, binding))
      throw new OtpFillServiceError("OTP_FILL_INVALID");
    this.releases.delete(releaseId);
    return release;
  }

  private consumeCapability(capability: Capability): void {
    if (this.capabilities.get(capability.id) === capability)
      this.capabilities.delete(capability.id);
    const key = bindingKey(capability.binding);
    if (this.capabilityByField.get(key) === capability.id) this.capabilityByField.delete(key);
  }

  private retainTerminal(releaseId: string, binding: Binding, response: OtpFillResponse): void {
    this.terminals.set(
      releaseId,
      Object.freeze({
        binding,
        response: freezeResponse(response),
        expiresAt: this.dependencies.now() + OTP_FILL_LIMITS.terminalRetentionMs,
      }),
    );
  }

  private assertGeneration(generation: number): void {
    if (this.disposed || generation !== this.invalidationGeneration)
      throw new OtpFillServiceError("OTP_FILL_UNAVAILABLE");
  }

  private assertOwner(owner: SuggestionOwner, fieldKey: string): void {
    this.assertGeneration(owner.generation);
    if (this.suggestionOwners.get(fieldKey) !== owner)
      throw new OtpFillServiceError("OTP_FILL_UNAVAILABLE");
  }

  private async assertAuthority(authority: SessionAuthority): Promise<void> {
    try {
      await this.dependencies.assertSession(authority);
    } catch {
      throw new OtpFillServiceError("OTP_FILL_UNAVAILABLE");
    }
  }

  private async cancelHotp(release: Release): Promise<void> {
    if (release.hotpReservationId === undefined) return;
    try {
      await this.dependencies.hotp.cancel(
        release.hotpReservationId,
        reservationBinding(release.binding),
      );
    } catch {
      // Cancellation is best effort; an uncertain durable outcome is never reported as uncommitted.
    }
  }

  private clearSessionAuthority(): void {
    this.invalidationGeneration += 1;
    const releases = [...this.releases.values()];
    this.capabilities.clear();
    this.capabilityByField.clear();
    this.suggestionOwners.clear();
    this.releases.clear();
    this.terminals.clear();
    for (const release of releases) void this.cancelHotp(release);
  }

  private prune(): void {
    const now = this.dependencies.now();
    for (const capability of this.capabilities.values())
      if (capability.expiresAt <= now) this.consumeCapability(capability);
    for (const [releaseId, release] of this.releases)
      if (release.expiresAt + OTP_FILL_LIMITS.terminalRetentionMs <= now) {
        this.releases.delete(releaseId);
        void this.cancelHotp(release);
      }
    for (const [releaseId, terminal] of this.terminals)
      if (terminal.expiresAt <= now) this.terminals.delete(releaseId);
  }
}

function senderBinding(sender: SenderContext, fieldHandle: string): Binding {
  if (sender.contextKind !== "content") throw new OtpFillServiceError("OTP_FILL_INVALID");
  let origin: string;
  try {
    const url = new URL(sender.senderUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    origin = url.origin;
  } catch {
    throw new OtpFillServiceError("OTP_FILL_INVALID");
  }
  return Object.freeze({
    extensionId: sender.extensionId,
    tabId: sender.tabId,
    frameId: sender.frameId,
    documentId: sender.documentId,
    origin,
    fieldHandle,
  });
}

function reservationBinding(binding: Binding): ReservationBinding {
  return Object.freeze({
    tabId: binding.tabId,
    frameId: binding.frameId,
    documentId: binding.documentId,
  });
}

function sameBinding(left: Binding, right: Binding): boolean {
  return (
    left.extensionId === right.extensionId &&
    left.tabId === right.tabId &&
    left.frameId === right.frameId &&
    left.documentId === right.documentId &&
    left.origin === right.origin &&
    left.fieldHandle === right.fieldHandle
  );
}
function sameField(left: Binding, right: Binding): boolean {
  return left.fieldHandle === right.fieldHandle;
}
function sameDocument(left: Binding, right: Binding): boolean {
  return (
    left.extensionId === right.extensionId &&
    left.tabId === right.tabId &&
    left.frameId === right.frameId &&
    left.documentId === right.documentId &&
    left.origin === right.origin
  );
}
function documentBindingKey(binding: Binding): string {
  return [
    binding.extensionId,
    binding.tabId,
    binding.frameId,
    binding.documentId,
    binding.origin,
  ].join("\u0000");
}
function bindingKey(binding: Binding): string {
  return [
    binding.extensionId,
    binding.tabId,
    binding.frameId,
    binding.documentId,
    binding.origin,
    binding.fieldHandle,
  ].join("\u0000");
}
function project(
  item: OtpItem,
  siteMatch: boolean,
  preview: OtpFillSuggestion["preview"],
): OtpFillSuggestion {
  return Object.freeze({
    itemId: item.id,
    expectedRevision: item.revision,
    issuer: item.issuer,
    label: item.label,
    otpType: item.otpType,
    favorite: item.favorite,
    tags: [...item.tags],
    siteMatch,
    ...(preview === undefined ? {} : { preview: Object.freeze(preview) }),
  });
}

/**
 * What can produce a code: a live authenticator item as it is, or a live login carrying an
 * inline one-time secret (the way 1Password and Bitwarden exports arrive), presented under
 * the login's name and username with the login's own id and revision. A login's secret that
 * parses as counter-based is left out: a counter lives on an authenticator item only.
 */
function otpSourceOf(candidate: unknown): Readonly<{ item: OtpItem; login?: LoginItem }> | null {
  const otp = OtpItemSchema.safeParse(candidate);
  if (otp.success) {
    if (otp.data.deletedAt !== undefined || otp.data.archivedAt !== undefined) return null;
    return { item: otp.data };
  }
  const login = LoginItemSchema.safeParse(candidate);
  if (!login.success || login.data.deletedAt !== undefined || login.data.archivedAt !== undefined)
    return null;
  const inline = inlineTotpItem(login.data);
  if (inline === null || inline.otpType === "hotp") return null;
  const username = login.data.username.trim();
  return {
    login: login.data,
    item: {
      ...inline,
      issuer: login.data.name.slice(0, MAX_OTP_ISSUER_LENGTH),
      label:
        (username === "" ? inline.label : username).slice(0, MAX_OTP_LABEL_LENGTH) || inline.label,
      favorite: login.data.favorite,
      tags: [...login.data.tags],
    },
  };
}

type Site = Readonly<{ host: string; domain: string; brand: string }>;

/** The page's host, its registrable domain, and the label people name a site by ("github"). */
function siteOf(origin: string): Site {
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    host = "";
  }
  const domain = registrableDomain(host.replace(/^www\./u, ""));
  return { host, domain, brand: domain.split(".")[0] ?? "" };
}

/**
 * "GitHub" names github.com, and a label holding the registrable domain counts too. Strict on
 * purpose: this decides which codes are shown to the page before a pick, so a look-alike
 * domain ("evil-github.com") must not qualify by containing the brand.
 */
function namesSite(item: OtpItem, site: Site): boolean {
  if (site.brand.length < 3) return false;
  const issuer = normalize(item.issuer).replace(/[^a-z0-9]/gu, "");
  if (issuer === site.brand) return true;
  return site.domain !== "" && normalize(item.label).includes(site.domain);
}

function compareSuggestions(left: OtpFillSuggestion, right: OtpFillSuggestion): number {
  if ((left.siteMatch ?? false) !== (right.siteMatch ?? false)) return left.siteMatch ? -1 : 1;
  if (left.favorite !== right.favorite) return left.favorite ? -1 : 1;
  return (
    compare(normalize(left.issuer), normalize(right.issuer)) ||
    compare(normalize(left.label), normalize(right.label)) ||
    compare(left.itemId, right.itemId)
  );
}
function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}
function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
function freezeResponse<T extends OtpFillResponse>(response: T): T {
  if (response.kind === "otp.fillSuggestionsResult") {
    for (const suggestion of response.suggestions) {
      Object.freeze(suggestion.tags);
      Object.freeze(suggestion);
    }
    Object.freeze(response.suggestions);
  }
  return Object.freeze(response);
}
function validated(response: OtpFillResponse): OtpFillResponse {
  const parsed = OtpFillResponseSchema.safeParse(response);
  if (!parsed.success) throw new OtpFillServiceError("OTP_FILL_UNAVAILABLE");
  return freezeResponse(parsed.data);
}
function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
}
function mapError(error: unknown): OtpFillServiceError {
  if (error instanceof OtpFillServiceError) return error;
  const code = errorCode(error);
  if (
    code === "OTP_FILL_INVALID" ||
    code === "OTP_FILL_UNAVAILABLE" ||
    code === "OTP_FILL_EXPIRED" ||
    code === "OTP_FILL_FIELD_CHANGED" ||
    code === "OTP_FILL_ITEM_CHANGED" ||
    code === "OTP_FILL_CANCELLED" ||
    code === "OTP_FILL_UNCERTAIN"
  )
    return new OtpFillServiceError(code);
  if (code === "VAULT_LOCKED") return new OtpFillServiceError("OTP_FILL_UNAVAILABLE");
  return new OtpFillServiceError("OTP_FILL_UNAVAILABLE");
}
