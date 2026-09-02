import { OtpItemSchema, type OtpItem } from "@shardpass/domain";
import {
  OtpEditableInputSchema,
  OtpRequestSchema,
  OtpResponseSchema,
  type OtpEditableInput,
  type OtpListItemProjection,
  type OtpRequest,
  type OtpResponse,
  type SenderContext,
} from "@shardpass/messaging";
import { generateOtp, type HotpReservationService, type ReservationBinding } from "@shardpass/otp";

import type { SessionVaultRepository } from "../vault/session-vault-repository";

type OtpRepository = Pick<
  SessionVaultRepository,
  | "listItems"
  | "get"
  | "create"
  | "update"
  | "tombstone"
  | "commitHotpReservation"
  | "cancelHotpReservation"
  | "savePendingHotpReservation"
>;

export type OtpServiceErrorCode =
  | "VAULT_LOCKED"
  | "VAULT_UNAVAILABLE"
  | "OTP_INVALID"
  | "OTP_NOT_FOUND"
  | "OTP_CONFLICT"
  | "OTP_HOTP_REQUIRED"
  | "OTP_RESERVATION_INVALID"
  | "OTP_RESERVATION_STALE"
  | "OTP_RESERVATION_UNCERTAIN";

export class OtpServiceError extends Error {
  constructor(readonly code: OtpServiceErrorCode) {
    super(code);
    this.name = "OtpServiceError";
  }
}

type OtpServiceDependencies = Readonly<{
  repository: OtpRepository;
  clock: { now(): number; isoNow(): string };
  ids: { next(): string };
  reservations: HotpReservationService;
  notePrivilegedActivity(): Promise<void>;
  registerReservationCleanup?(cleanup: () => void): () => void;
}>;

export class OtpService {
  private readonly unregisterReservationCleanup: () => void;
  private disposed = false;

  constructor(private readonly dependencies: OtpServiceDependencies) {
    this.unregisterReservationCleanup =
      dependencies.registerReservationCleanup?.(() => dependencies.reservations.clear()) ??
      (() => undefined);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unregisterReservationCleanup();
    this.dependencies.reservations.clear();
  }

  async handle(request: OtpRequest, sender: SenderContext): Promise<OtpResponse> {
    try {
      if (this.disposed) throw new OtpServiceError("VAULT_LOCKED");
      const parsed = OtpRequestSchema.safeParse(request);
      if (!parsed.success) invalid();
      const command = parsed.data;
      let response: OtpResponse;
      switch (command.kind) {
        case "otp.list":
          response = await this.list(command.query);
          break;
        case "otp.getEditor":
          this.assertVaultSender(sender);
          response = await this.getEditor(command.itemId);
          break;
        case "otp.create":
          this.assertVaultSender(sender);
          response = await this.create(command.input);
          break;
        case "otp.update":
          this.assertVaultSender(sender);
          response = await this.update(command.itemId, command.expectedRevision, command.input);
          break;
        case "otp.delete":
          this.assertVaultSender(sender);
          response = await this.delete(command.itemId, command.expectedRevision);
          break;
        case "otp.getCode":
          response = await this.getCode(command.itemId);
          break;
        case "otp.copyCode":
          response = await this.getCode(command.itemId, command.expectedRevision);
          break;
        case "otp.reserveHotp":
          response = await this.reserveHotp(command.itemId, sender);
          break;
        case "otp.commitHotp":
          response = await this.commitHotp(command.reservationId, sender);
          break;
        case "otp.cancelHotp":
          response = await this.cancelHotp(command.reservationId, sender);
          break;
      }
      if (response.kind !== "otp.hotpCancelled" || response.cancelled) {
        try {
          await this.dependencies.notePrivilegedActivity();
        } catch {
          // Activity scheduling is best-effort and cannot invalidate a completed operation.
        }
      }
      return response;
    } catch (error) {
      throw mapError(error);
    }
  }

  private async list(query: string): Promise<OtpResponse> {
    const normalizedQuery = normalizeOtpSearch(query);
    const candidates = await this.dependencies.repository.listItems();
    const projected: OtpListItemProjection[] = [];
    for (const candidate of candidates) {
      const parsed = OtpItemSchema.safeParse(candidate);
      if (!parsed.success) continue;
      const value = parsed.data;
      if (value.deletedAt !== undefined) continue;
      if (!matchesSearch(value, normalizedQuery)) continue;
      projected.push(projectListItem(value));
    }
    projected.sort(compareListItems);
    return response({ version: 1, kind: "otp.listResult", items: freezeArray(projected) });
  }

  private async getEditor(itemId: string): Promise<OtpResponse> {
    const value = await this.getValidItem(itemId);
    return response({
      version: 1,
      kind: "otp.editorResult",
      item: Object.freeze({
        id: value.id,
        revision: value.revision,
        ...projectEditable(value),
      }),
    });
  }

  private async create(input: OtpEditableInput): Promise<OtpResponse> {
    const editable = parseEditable(input);
    const timestamp = this.dependencies.clock.isoNow();
    const candidate = parseItem({
      id: this.dependencies.ids.next(),
      schemaVersion: 2,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      kind: "otp",
      ...editable,
    });
    const created = parseItem(await this.dependencies.repository.create(candidate));
    return mutationResponse(created);
  }

  private async update(
    itemId: string,
    expectedRevision: number,
    input: OtpEditableInput,
  ): Promise<OtpResponse> {
    const editable = parseEditable(input);
    const current = await this.getValidItem(itemId);
    if (current.revision !== expectedRevision) conflict();
    const candidate = parseItem({ ...current, ...editable });
    const updated = parseItem(
      await this.dependencies.repository.update(candidate, expectedRevision),
    );
    return mutationResponse(updated);
  }

  private async delete(itemId: string, expectedRevision: number): Promise<OtpResponse> {
    const current = await this.getValidItem(itemId);
    if (current.revision !== expectedRevision) conflict();
    const deleted = await this.dependencies.repository.tombstone(itemId, expectedRevision);
    return response({
      version: 1,
      kind: "otp.deleteResult",
      itemId: deleted.id,
      revision: deleted.revision,
    });
  }

  private async getCode(itemId: string, expectedRevision?: number): Promise<OtpResponse> {
    const value = await this.getValidItem(itemId);
    if (expectedRevision !== undefined && value.revision !== expectedRevision) conflict();
    if (value.otpType === "hotp") throw new OtpServiceError("OTP_HOTP_REQUIRED");
    const generated = await generateOtp(value, this.dependencies.clock.now());
    const current = await this.dependencies.repository.get(itemId);
    const reparsed = OtpItemSchema.safeParse(current);
    if (
      !reparsed.success ||
      reparsed.data.deletedAt !== undefined ||
      reparsed.data.id !== value.id ||
      reparsed.data.revision !== value.revision
    )
      conflict();
    if (generated.remaining === undefined || generated.expiresAt === undefined) invalid();
    return response({
      version: 1,
      kind: "otp.codeResult",
      itemId: value.id,
      revision: value.revision,
      code: generated.code,
      otpType: value.otpType,
      period: value.period,
      remaining: generated.remaining,
      expiresAt: generated.expiresAt,
    });
  }

  private async reserveHotp(itemId: string, sender: SenderContext): Promise<OtpResponse> {
    const binding = reservationBinding(sender);
    const value = await this.getValidItem(itemId);
    if (value.otpType !== "hotp") throw new OtpServiceError("OTP_RESERVATION_INVALID");
    const reserved = await this.dependencies.reservations.reserveHotp(value, binding);
    const current = await this.dependencies.repository.get(itemId);
    const reparsed = OtpItemSchema.safeParse(current);
    if (
      !reparsed.success ||
      reparsed.data.deletedAt !== undefined ||
      reparsed.data.otpType !== "hotp" ||
      reparsed.data.revision !== reserved.itemRevision ||
      reparsed.data.counter !== reserved.counter
    ) {
      this.dependencies.reservations.cancelHotpReservation(reserved.reservationId, binding);
      conflict();
    }
    await this.dependencies.repository.savePendingHotpReservation({
      reservationId: reserved.reservationId,
      itemId: value.id,
      expectedRevision: reserved.itemRevision,
      expectedCounter: reserved.counter,
      binding,
      createdAt: reserved.expiresAt - 30_000,
      expiresAt: reserved.expiresAt,
      state: "pending",
    });
    return response({
      version: 1,
      kind: "otp.hotpReserved",
      reservationId: reserved.reservationId,
      itemId: value.id,
      itemRevision: reserved.itemRevision,
      counter: reserved.counter,
      code: reserved.code,
      expiresAt: reserved.expiresAt,
    });
  }

  private async commitHotp(reservationId: string, sender: SenderContext): Promise<OtpResponse> {
    const binding = reservationBinding(sender);
    const result = await this.dependencies.repository.commitHotpReservation(reservationId, binding);
    return response({
      version: 1,
      kind: "otp.hotpCommitted",
      reservationId,
      revision: result.revision,
      counter: result.counter,
    });
  }

  private async cancelHotp(reservationId: string, sender: SenderContext): Promise<OtpResponse> {
    const binding = reservationBinding(sender);
    const inMemory = this.dependencies.reservations.cancelHotpReservation(reservationId, binding);
    const durable = await this.dependencies.repository.cancelHotpReservation(
      reservationId,
      binding,
    );
    const cancelled = inMemory || durable;
    return response({
      version: 1,
      kind: "otp.hotpCancelled",
      reservationId,
      cancelled,
    });
  }

  private async getValidItem(itemId: string): Promise<OtpItem> {
    const candidate = await this.dependencies.repository.get(itemId);
    if (candidate === null) throw new OtpServiceError("OTP_NOT_FOUND");
    const parsed = OtpItemSchema.safeParse(candidate);
    if (!parsed.success || parsed.data.deletedAt !== undefined)
      throw new OtpServiceError("OTP_NOT_FOUND");
    return parsed.data;
  }

  private assertVaultSender(sender: SenderContext): void {
    if (sender.contextKind !== "vault") invalid();
  }
}

function reservationBinding(sender: SenderContext): ReservationBinding {
  if (sender.contextKind !== "content") throw new OtpServiceError("OTP_RESERVATION_INVALID");
  return Object.freeze({
    tabId: sender.tabId,
    frameId: sender.frameId,
    documentId: sender.documentId,
  });
}

export function normalizeOtpSearch(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

function matchesSearch(item: OtpItem, query: string): boolean {
  if (query.length === 0) return true;
  return [item.issuer, item.label, ...item.tags].some((value) =>
    normalizeOtpSearch(value).includes(query),
  );
}

function compareListItems(left: OtpListItemProjection, right: OtpListItemProjection): number {
  if (left.favorite !== right.favorite) return left.favorite ? -1 : 1;
  return (
    compareText(normalizeOtpSearch(left.issuer), normalizeOtpSearch(right.issuer)) ||
    compareText(normalizeOtpSearch(left.label), normalizeOtpSearch(right.label)) ||
    compareText(left.id, right.id)
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function projectEditable(item: OtpItem): OtpEditableInput {
  return Object.freeze({
    issuer: item.issuer,
    label: item.label,
    secret: item.secret,
    otpType: item.otpType,
    algorithm: item.algorithm,
    digits: item.digits,
    period: item.period,
    ...(item.counter === undefined ? {} : { counter: item.counter }),
    favorite: item.favorite,
    tags: freezeArray(item.tags),
    note: item.note,
  });
}

function projectListItem(item: OtpItem): OtpListItemProjection {
  return Object.freeze({
    id: item.id,
    revision: item.revision,
    issuer: item.issuer,
    label: item.label,
    otpType: item.otpType,
    favorite: item.favorite,
    tags: freezeArray(item.tags),
  });
}

function mutationResponse(item: OtpItem): OtpResponse {
  return response({
    version: 1,
    kind: "otp.mutationResult",
    item: projectListItem(item),
  });
}

function parseEditable(input: unknown): OtpEditableInput {
  const parsed = OtpEditableInputSchema.safeParse(input);
  if (!parsed.success) invalid();
  return projectEditableInput(parsed.data);
}

function projectEditableInput(input: OtpEditableInput): OtpEditableInput {
  return Object.freeze({
    issuer: input.issuer,
    label: input.label,
    secret: input.secret,
    otpType: input.otpType,
    algorithm: input.algorithm,
    digits: input.digits,
    period: input.period,
    ...(input.counter === undefined ? {} : { counter: input.counter }),
    favorite: input.favorite,
    tags: freezeArray(input.tags),
    note: input.note,
  });
}

function parseItem(input: unknown): OtpItem {
  const parsed = OtpItemSchema.safeParse(input);
  if (!parsed.success) invalid();
  return parsed.data;
}

function response(candidate: OtpResponse): OtpResponse {
  const parsed = OtpResponseSchema.safeParse(candidate);
  if (!parsed.success) invalid();
  return deepFreezeResponse(parsed.data);
}

function deepFreezeResponse(value: OtpResponse): OtpResponse {
  if (value.kind === "otp.listResult") {
    for (const item of value.items) {
      Object.freeze(item.tags);
      Object.freeze(item);
    }
    Object.freeze(value.items);
  } else if (value.kind === "otp.editorResult") {
    Object.freeze(value.item.tags);
    Object.freeze(value.item);
  } else if (value.kind === "otp.mutationResult") {
    Object.freeze(value.item.tags);
    Object.freeze(value.item);
  }
  return Object.freeze(value);
}

function freezeArray<T>(values: readonly T[]): T[] {
  return Object.freeze([...values]) as T[];
}

function invalid(): never {
  throw new OtpServiceError("OTP_INVALID");
}

function conflict(): never {
  throw new OtpServiceError("OTP_CONFLICT");
}

function mapError(error: unknown): OtpServiceError {
  if (error instanceof OtpServiceError) return error;
  const code = errorCode(error);
  if (code === "VAULT_LOCKED") return new OtpServiceError("VAULT_LOCKED");
  if (code === "REVISION_CONFLICT") return new OtpServiceError("OTP_RESERVATION_INVALID");
  if (code === "OTP_RESERVATION_STALE") return new OtpServiceError("OTP_RESERVATION_STALE");
  if (code === "OTP_RESERVATION_UNCERTAIN") return new OtpServiceError("OTP_RESERVATION_UNCERTAIN");
  if (
    code === "OTP_RESERVATION_BINDING" ||
    code === "OTP_RESERVATION_BUSY" ||
    code === "OTP_RESERVATION_CAPACITY" ||
    code === "OTP_RESERVATION_EXPIRED" ||
    code === "OTP_RESERVATION_NOT_FOUND"
  )
    return new OtpServiceError("OTP_RESERVATION_INVALID");
  if (code === "OTP_INVALID_ITEM" || code === "OTP_INVALID_TIME" || code === "OTP_INVALID_SECRET")
    return new OtpServiceError("OTP_INVALID");
  return new OtpServiceError("VAULT_UNAVAILABLE");
}

function errorCode(error: unknown): unknown {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return (error as { readonly code?: unknown }).code;
}
