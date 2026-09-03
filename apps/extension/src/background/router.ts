import {
  authorizeSender,
  BackupRequestSchema,
  backupSenderPolicy,
  parseBackupResponseForRequest,
  FoundationRequestSchema,
  foundationSenderPolicy,
  EnteRequestSchema,
  enteSenderPolicy,
  FolderRequestSchema,
  folderSenderPolicy,
  parseFolderResponseForRequest,
  GeneratePasswordRequestSchema,
  GeneratePasswordResponseSchema,
  passwordGenSenderPolicy,
  ItemCrudRequestSchema,
  itemCrudSenderPolicy,
  parseItemCrudResponseForRequest,
  LoginFillRequestSchema,
  loginFillSenderPolicy,
  parseLoginFillResponseForRequest,
  MigrationRequestSchema,
  MigrationResponseSchema,
  OtpFillRequestSchema,
  otpFillSenderPolicy,
  parseOtpFillResponseForRequest,
  OtpImportRequestSchema,
  OtpImportResponseSchema,
  otpImportSenderPolicy,
  parseOtpImportResponseForRequest,
  migrationSenderPolicy,
  OtpRequestSchema,
  parseOtpResponseForRequest,
  otpSenderPolicy,
  VaultRequestSchema,
  vaultSenderPolicy,
  type BackupRequest,
  type BackupResponse,
  type FoundationResponse,
  type EnteSafeState,
  type FolderRequest,
  type FolderResponse,
  type GeneratePasswordRequest,
  type GeneratePasswordResponse,
  type ItemCrudRequest,
  type ItemCrudResponse,
  type LoginFillRequest,
  type LoginFillResponse,
  type MigrationRequest,
  type MigrationResponse,
  type OtpFillRequest,
  type OtpFillResponse,
  type OtpImportRequest,
  type OtpImportResponse,
  type OtpResponse,
  type SenderContext,
  type VaultResponse,
} from "@shardpass/messaging";
import { toSafeError, type SafeError, type SafeErrorCode } from "@shardpass/security";

import { FolderServiceError, type FolderServiceErrorCode } from "./folder/folder-service";
import { ItemServiceError, type ItemServiceErrorCode } from "./item/item-service";
import { LoginFillServiceError, type LoginFillServiceErrorCode } from "./login/login-fill-service";
import { OtpFillServiceError, type OtpFillServiceErrorCode } from "./otp/otp-fill-service";
import { OtpServiceError, type OtpService, type OtpServiceErrorCode } from "./otp/otp-service";
import { PasswordGenServiceError, type PasswordGenServiceErrorCode } from "./password/password-gen-service";
import { BackupServiceError, type BackupServiceErrorCode } from "./vault/backup-service";
import { VaultSessionError } from "./vault/session-service";
import type { VaultService } from "./vault/vault-service";
import type { EnteService } from "./ente/ente-service";
import { EnteProtocolError } from "./ente/protocol";

export type BackgroundErrorResponse = Readonly<{
  version: 1;
  kind: "error";
  error: SafeError;
}>;

export type BackgroundResponse =
  | BackupResponse
  | FolderResponse
  | FoundationResponse
  | GeneratePasswordResponse
  | ItemCrudResponse
  | LoginFillResponse
  | MigrationResponse
  | OtpFillResponse
  | OtpImportResponse
  | OtpResponse
  | VaultResponse
  | EnteSafeState
  | BackgroundErrorResponse;

const backupErrorCodes = {
  BACKUP_INVALID: "BACKUP_INVALID",
  BACKUP_AUTH_FAILED: "BACKUP_AUTH_FAILED",
  BACKUP_EXPIRED: "BACKUP_EXPIRED",
  BACKUP_CHANGED: "BACKUP_CHANGED",
  BACKUP_CAPACITY: "BACKUP_CAPACITY",
  BACKUP_UNAVAILABLE: "BACKUP_UNAVAILABLE",
} satisfies Record<BackupServiceErrorCode, SafeErrorCode>;

const otpFillErrorCodes = {
  OTP_FILL_INVALID: "OTP_FILL_INVALID",
  OTP_FILL_UNAVAILABLE: "OTP_FILL_UNAVAILABLE",
  OTP_FILL_EXPIRED: "OTP_FILL_EXPIRED",
  OTP_FILL_FIELD_CHANGED: "OTP_FILL_FIELD_CHANGED",
  OTP_FILL_ITEM_CHANGED: "OTP_FILL_ITEM_CHANGED",
  OTP_FILL_CANCELLED: "OTP_FILL_CANCELLED",
  OTP_FILL_UNCERTAIN: "OTP_FILL_UNCERTAIN",
} satisfies Record<OtpFillServiceErrorCode, SafeErrorCode>;

const itemErrorCodes = {
  VAULT_LOCKED: "VAULT_LOCKED",
  VAULT_UNAVAILABLE: "VAULT_UNAVAILABLE",
  ITEM_INVALID: "ITEM_INVALID",
  ITEM_NOT_FOUND: "ITEM_NOT_FOUND",
  ITEM_CONFLICT: "ITEM_CONFLICT",
} satisfies Record<ItemServiceErrorCode, SafeErrorCode>;

const folderErrorCodes = {
  VAULT_LOCKED: "VAULT_LOCKED",
  VAULT_UNAVAILABLE: "VAULT_UNAVAILABLE",
  FOLDER_INVALID: "FOLDER_INVALID",
  FOLDER_NOT_FOUND: "FOLDER_NOT_FOUND",
} satisfies Record<FolderServiceErrorCode, SafeErrorCode>;

const loginFillErrorCodes = {
  LOGIN_FILL_INVALID: "LOGIN_FILL_INVALID",
  LOGIN_FILL_UNAVAILABLE: "LOGIN_FILL_UNAVAILABLE",
  LOGIN_FILL_NOT_FOUND: "LOGIN_FILL_NOT_FOUND",
  LOGIN_FILL_ITEM_CHANGED: "LOGIN_FILL_ITEM_CHANGED",
} satisfies Record<LoginFillServiceErrorCode, SafeErrorCode>;

const passwordGenErrorCodes = {
  PASSWORD_GEN_INVALID: "PASSWORD_GEN_INVALID",
} satisfies Record<PasswordGenServiceErrorCode, SafeErrorCode>;

const otpErrorCodes = {
  VAULT_LOCKED: "VAULT_LOCKED",
  VAULT_UNAVAILABLE: "VAULT_UNAVAILABLE",
  OTP_INVALID: "OTP_INVALID",
  OTP_NOT_FOUND: "OTP_NOT_FOUND",
  OTP_CONFLICT: "OTP_CONFLICT",
  OTP_HOTP_REQUIRED: "OTP_HOTP_REQUIRED",
  OTP_RESERVATION_INVALID: "OTP_RESERVATION_INVALID",
  OTP_RESERVATION_STALE: "OTP_RESERVATION_STALE",
  OTP_RESERVATION_UNCERTAIN: "OTP_RESERVATION_UNCERTAIN",
} satisfies Record<OtpServiceErrorCode, SafeErrorCode>;

type BackupHandler = Readonly<{
  handle(request: BackupRequest, sender: SenderContext): Promise<unknown>;
}>;
type MigrationHandler = Readonly<{
  handle(request: MigrationRequest, sender: SenderContext): Promise<unknown>;
}>;
type OtpFillHandler = Readonly<{
  handle(request: OtpFillRequest, sender: SenderContext): Promise<unknown>;
}>;
type OtpImportHandler = Readonly<{
  handle(request: OtpImportRequest, sender: SenderContext): Promise<unknown>;
}>;
type ItemHandler = Readonly<{
  handle(request: ItemCrudRequest, sender: SenderContext): Promise<unknown>;
}>;
type LoginFillHandler = Readonly<{
  handle(request: LoginFillRequest, sender: SenderContext): Promise<unknown>;
}>;
type PasswordGenHandler = Readonly<{
  handle(request: GeneratePasswordRequest): Promise<unknown>;
}>;
type FolderHandler = Readonly<{
  handle(request: FolderRequest, sender: SenderContext): Promise<unknown>;
}>;

function errorResponse(code: SafeErrorCode): BackgroundErrorResponse {
  return {
    version: 1,
    kind: "error",
    error: toSafeError(undefined, code),
  };
}

function projectOtpImportResponse(
  request: OtpImportRequest,
  response: unknown,
): OtpImportResponse | BackgroundErrorResponse {
  if (typeof response !== "object" || response === null)
    return errorResponse("OTP_IMPORT_UNAVAILABLE");
  const source = response as Record<string, unknown>;
  let projected: unknown;
  if (source.kind === "otp.importPreviewResult" || source.kind === "otp.importPreviewChanged") {
    projected = {
      version: source.version,
      kind: source.kind,
      previewToken: source.previewToken,
      format: source.format,
      rows: source.rows,
      accepted: source.accepted,
      duplicate: source.duplicate,
      rejected: source.rejected,
      expiresAt: source.expiresAt,
    };
  } else if (source.kind === "otp.importConfirmed") {
    projected = {
      version: source.version,
      kind: source.kind,
      imported: source.imported,
      duplicate: source.duplicate,
    };
  } else if (source.kind === "otp.importCancelled") {
    projected = { version: source.version, kind: source.kind, cancelled: source.cancelled };
  } else return errorResponse("OTP_IMPORT_UNAVAILABLE");
  const strict = OtpImportResponseSchema.safeParse(projected);
  if (!strict.success) return errorResponse("OTP_IMPORT_UNAVAILABLE");
  const paired = parseOtpImportResponseForRequest(request, strict.data);
  return paired.success ? paired.data : errorResponse("OTP_IMPORT_UNAVAILABLE");
}

function importErrorCode(error: unknown): SafeErrorCode {
  if (typeof error !== "object" || error === null || !("code" in error))
    return "OTP_IMPORT_UNAVAILABLE";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" &&
    [
      "OTP_IMPORT_INVALID",
      "OTP_IMPORT_LIMIT",
      "OTP_IMPORT_EXPIRED",
      "OTP_IMPORT_CAPACITY",
      "OTP_IMPORT_UNAVAILABLE",
      "VAULT_LOCKED",
    ].includes(code)
    ? (code as SafeErrorCode)
    : "OTP_IMPORT_UNAVAILABLE";
}

function projectMigrationResponse(response: unknown): MigrationResponse | BackgroundErrorResponse {
  if (typeof response !== "object" || response === null) return errorResponse("VAULT_UNAVAILABLE");
  const candidate = response as Record<string, unknown>;
  let projected: unknown;
  if (candidate.kind === "migration.status") {
    projected = {
      version: candidate.version,
      kind: candidate.kind,
      available: candidate.available,
      phase: candidate.phase,
      itemCount: candidate.itemCount,
      ...(candidate.guidance === undefined ? {} : { guidance: candidate.guidance }),
    };
  } else if (candidate.kind === "migration.credentialChallenge") {
    projected = {
      version: candidate.version,
      kind: candidate.kind,
      challengeId: candidate.challengeId,
      kdf: candidate.kdf,
      expiresAt: candidate.expiresAt,
    };
  } else if (candidate.kind === "migration.credentialAuthorized") {
    projected = {
      version: candidate.version,
      kind: candidate.kind,
      credentialToken: candidate.credentialToken,
      expiresAt: candidate.expiresAt,
    };
  } else return errorResponse("VAULT_UNAVAILABLE");
  const parsed = MigrationResponseSchema.safeParse(projected);
  return parsed.success ? parsed.data : errorResponse("VAULT_UNAVAILABLE");
}

export function routeMessage(
  input: unknown,
  senderContext: unknown,
  expectedExtensionId: string,
  vaultService?: VaultService,
  getState?: () => Promise<Extract<VaultResponse, { kind: "vault.state" }>>,
  migrationHandler?: MigrationHandler,
  otpService?: Pick<OtpService, "handle">,
  otpImportService?: OtpImportHandler,
  backupService?: BackupHandler,
  otpFillService?: OtpFillHandler,
  enteService?: EnteService,
  itemService?: ItemHandler,
  loginFillService?: LoginFillHandler,
  passwordGenService?: PasswordGenHandler,
  folderService?: FolderHandler,
): Promise<BackgroundResponse> {
  const folderRequest = FolderRequestSchema.safeParse(input);
  if (folderRequest.success) {
    const policy = folderSenderPolicy[folderRequest.data.kind];
    if (!authorizeSender(senderContext, { extensionId: expectedExtensionId, ...policy }))
      return Promise.resolve(errorResponse("UNAUTHORIZED_SENDER"));
    if (folderService === undefined) return Promise.resolve(errorResponse("VAULT_UNAVAILABLE"));
    return folderService
      .handle(folderRequest.data, senderContext as SenderContext)
      .then((candidate) => {
        const parsed = parseFolderResponseForRequest(folderRequest.data, candidate);
        return parsed.success ? parsed.data : errorResponse("VAULT_UNAVAILABLE");
      })
      .catch((error: unknown) =>
        errorResponse(error instanceof FolderServiceError ? folderErrorCodes[error.code] : "UNEXPECTED"),
      );
  }

  const itemRequest = ItemCrudRequestSchema.safeParse(input);
  if (itemRequest.success) {
    const policy = itemCrudSenderPolicy[itemRequest.data.kind];
    if (!authorizeSender(senderContext, { extensionId: expectedExtensionId, ...policy }))
      return Promise.resolve(errorResponse("UNAUTHORIZED_SENDER"));
    if (itemService === undefined) return Promise.resolve(errorResponse("VAULT_UNAVAILABLE"));
    return itemService
      .handle(itemRequest.data, senderContext as SenderContext)
      .then((candidate) => {
        const parsed = parseItemCrudResponseForRequest(itemRequest.data, candidate);
        return parsed.success ? parsed.data : errorResponse("VAULT_UNAVAILABLE");
      })
      .catch((error: unknown) =>
        errorResponse(error instanceof ItemServiceError ? itemErrorCodes[error.code] : "UNEXPECTED"),
      );
  }

  const loginFillRequest = LoginFillRequestSchema.safeParse(input);
  if (loginFillRequest.success) {
    const policy = loginFillSenderPolicy[loginFillRequest.data.kind];
    if (!authorizeSender(senderContext, { extensionId: expectedExtensionId, ...policy }))
      return Promise.resolve(errorResponse("UNAUTHORIZED_SENDER"));
    if (loginFillService === undefined)
      return Promise.resolve(errorResponse("LOGIN_FILL_UNAVAILABLE"));
    return loginFillService
      .handle(loginFillRequest.data, senderContext as SenderContext)
      .then((candidate) => {
        const parsed = parseLoginFillResponseForRequest(loginFillRequest.data, candidate);
        return parsed.success ? parsed.data : errorResponse("LOGIN_FILL_UNAVAILABLE");
      })
      .catch((error: unknown) =>
        errorResponse(
          error instanceof LoginFillServiceError
            ? loginFillErrorCodes[error.code]
            : "LOGIN_FILL_UNAVAILABLE",
        ),
      );
  }

  const passwordGenRequest = GeneratePasswordRequestSchema.safeParse(input);
  if (passwordGenRequest.success) {
    const policy = passwordGenSenderPolicy[passwordGenRequest.data.kind];
    if (!authorizeSender(senderContext, { extensionId: expectedExtensionId, ...policy }))
      return Promise.resolve(errorResponse("UNAUTHORIZED_SENDER"));
    if (passwordGenService === undefined)
      return Promise.resolve(errorResponse("PASSWORD_GEN_INVALID"));
    return passwordGenService
      .handle(passwordGenRequest.data)
      .then((candidate) => {
        const parsed = GeneratePasswordResponseSchema.safeParse(candidate);
        return parsed.success ? parsed.data : errorResponse("PASSWORD_GEN_INVALID");
      })
      .catch((error: unknown) =>
        errorResponse(
          error instanceof PasswordGenServiceError
            ? passwordGenErrorCodes[error.code]
            : "PASSWORD_GEN_INVALID",
        ),
      );
  }

  const enteRequest = EnteRequestSchema.safeParse(input);
  if (enteRequest.success) {
    const policy = enteSenderPolicy[enteRequest.data.kind];
    if (!authorizeSender(senderContext, { extensionId: expectedExtensionId, ...policy }))
      return Promise.resolve(errorResponse("UNAUTHORIZED_SENDER"));
    if (enteService === undefined) return Promise.resolve(errorResponse("VAULT_UNAVAILABLE"));
    return enteService
      .handle(enteRequest.data, senderContext as SenderContext)
      .catch((error: unknown) =>
        errorResponse(error instanceof EnteProtocolError ? error.code : "ENTE_UNAVAILABLE"),
      );
  }

  const fillRequest = OtpFillRequestSchema.safeParse(input);
  if (fillRequest.success) {
    const policy = otpFillSenderPolicy[fillRequest.data.kind];
    if (!authorizeSender(senderContext, { extensionId: expectedExtensionId, ...policy }))
      return Promise.resolve(errorResponse("UNAUTHORIZED_SENDER"));
    if (otpFillService === undefined) return Promise.resolve(errorResponse("OTP_FILL_UNAVAILABLE"));
    return otpFillService
      .handle(fillRequest.data, senderContext as SenderContext)
      .then((candidate) => {
        const parsed = parseOtpFillResponseForRequest(fillRequest.data, candidate);
        return parsed.success ? parsed.data : errorResponse("OTP_FILL_UNAVAILABLE");
      })
      .catch((error: unknown) =>
        errorResponse(
          error instanceof OtpFillServiceError
            ? otpFillErrorCodes[error.code]
            : "OTP_FILL_UNAVAILABLE",
        ),
      );
  }

  const backupRequest = BackupRequestSchema.safeParse(input);
  if (backupRequest.success) {
    const policy = backupSenderPolicy[backupRequest.data.kind];
    if (!authorizeSender(senderContext, { extensionId: expectedExtensionId, ...policy }))
      return Promise.resolve(errorResponse("UNAUTHORIZED_SENDER"));
    if (backupService === undefined) return Promise.resolve(errorResponse("BACKUP_UNAVAILABLE"));
    const boundSender = senderContext as SenderContext;
    return backupService
      .handle(backupRequest.data, boundSender)
      .then((candidate) => {
        const parsed = parseBackupResponseForRequest(backupRequest.data, candidate);
        return parsed.success ? parsed.data : errorResponse("BACKUP_UNAVAILABLE");
      })
      .catch((error: unknown) =>
        errorResponse(
          error instanceof BackupServiceError ? backupErrorCodes[error.code] : "UNEXPECTED",
        ),
      );
  }

  const importRequest = OtpImportRequestSchema.safeParse(input);
  if (importRequest.success) {
    const policy = otpImportSenderPolicy[importRequest.data.kind];
    if (!authorizeSender(senderContext, { extensionId: expectedExtensionId, ...policy }))
      return Promise.resolve(errorResponse("UNAUTHORIZED_SENDER"));
    if (otpImportService === undefined) return Promise.resolve(errorResponse("VAULT_UNAVAILABLE"));
    const boundSender = senderContext as SenderContext;
    return otpImportService
      .handle(importRequest.data, boundSender)
      .then((candidate) => projectOtpImportResponse(importRequest.data, candidate))
      .catch((error: unknown) => errorResponse(importErrorCode(error)));
  }

  const otpRequest = OtpRequestSchema.safeParse(input);
  if (otpRequest.success) {
    const policy = otpSenderPolicy[otpRequest.data.kind];
    if (!authorizeSender(senderContext, { extensionId: expectedExtensionId, ...policy }))
      return Promise.resolve(errorResponse("UNAUTHORIZED_SENDER"));
    if (otpService === undefined) return Promise.resolve(errorResponse("VAULT_UNAVAILABLE"));
    const boundSender = senderContext as SenderContext;
    return otpService
      .handle(otpRequest.data, boundSender)
      .then((candidate) => {
        const parsed = parseOtpResponseForRequest(otpRequest.data, candidate);
        return parsed.success ? parsed.data : errorResponse("VAULT_UNAVAILABLE");
      })
      .catch((error: unknown) => {
        if (error instanceof OtpServiceError) {
          if (error.code === "VAULT_LOCKED" && otpRequest.data.kind === "otp.list")
            return { version: 1, kind: "otp.listResult", items: [] };
          return errorResponse(otpErrorCodes[error.code]);
        }
        return errorResponse("UNEXPECTED");
      });
  }

  const migrationRequest = MigrationRequestSchema.safeParse(input);
  if (migrationRequest.success) {
    const policy = migrationSenderPolicy[migrationRequest.data.kind];
    if (!authorizeSender(senderContext, { extensionId: expectedExtensionId, ...policy }))
      return Promise.resolve(errorResponse("UNAUTHORIZED_SENDER"));
    if (migrationHandler === undefined) return Promise.resolve(errorResponse("VAULT_UNAVAILABLE"));
    const boundSender = senderContext as SenderContext;
    return migrationHandler
      .handle(migrationRequest.data, boundSender)
      .then((response) => projectMigrationResponse(response))
      .catch(() => errorResponse("VAULT_UNAVAILABLE"));
  }

  const vaultRequest = VaultRequestSchema.safeParse(input);
  if (vaultRequest.success) {
    const policy = vaultSenderPolicy[vaultRequest.data.kind];
    if (!authorizeSender(senderContext, { extensionId: expectedExtensionId, ...policy })) {
      return Promise.resolve(errorResponse("UNAUTHORIZED_SENDER"));
    }
    if (vaultService === undefined) return Promise.resolve(errorResponse("UNEXPECTED"));
    if (vaultRequest.data.kind === "vault.getState") {
      if (getState === undefined) return Promise.resolve(errorResponse("UNEXPECTED"));
      return getState().catch(() => errorResponse("VAULT_UNAVAILABLE"));
    }
    const boundSender = senderContext as Parameters<VaultService["handle"]>[1];
    return vaultService
      .handle(vaultRequest.data, boundSender)
      .catch((error: unknown) =>
        errorResponse(error instanceof VaultSessionError ? error.code : "UNEXPECTED"),
      );
  }

  const request = FoundationRequestSchema.safeParse(input);
  if (!request.success) {
    return Promise.resolve(errorResponse("INVALID_MESSAGE"));
  }

  const policy = foundationSenderPolicy[request.data.kind];
  if (
    !authorizeSender(senderContext, {
      extensionId: expectedExtensionId,
      ...policy,
    })
  ) {
    return Promise.resolve(errorResponse("UNAUTHORIZED_SENDER"));
  }

  return Promise.resolve({
    version: 1,
    kind: "foundation.status",
    phase: "foundation",
    vaultAvailable: false,
  });
}
