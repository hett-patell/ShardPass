import type { SecurityResponse, DataFillResponse, AliasResponse } from "@shardpass/messaging";
import {
  authorizeSender,
  BackupRequestSchema,
  backupSenderPolicy,
  DataFillRequestSchema,
  dataFillSenderPolicy,
  EnteRequestSchema,
  EnteSafeStateSchema,
  enteSenderPolicy,
  FolderRequestSchema,
  folderSenderPolicy,
  FoundationRequestSchema,
  foundationSenderPolicy,
  PasswordGenRequestSchema,
  PasswordGenResponseSchema,
  passwordGenResponseKindByRequest,
  ItemCrudRequestSchema,
  itemCrudSenderPolicy,
  LoginFillRequestSchema,
  loginFillSenderPolicy,
  MigrationRequestSchema,
  MigrationResponseSchema,
  migrationSenderPolicy,
  OtpFillRequestSchema,
  otpFillSenderPolicy,
  OtpImportRequestSchema,
  OtpImportResponseSchema,
  otpImportSenderPolicy,
  OtpRequestSchema,
  otpSenderPolicy,
  parseBackupResponseForRequest,
  parseDataFillResponseForRequest,
  parseFolderResponseForRequest,
  parseItemCrudResponseForRequest,
  parseLoginFillResponseForRequest,
  parseOtpFillResponseForRequest,
  parseOtpImportResponseForRequest,
  parseOtpResponseForRequest,
  parsePasskeyResponseForRequest,
  parseAliasResponseForRequest,
  parseSecurityResponseForRequest,
  PasskeyRequestSchema,
  passkeySenderPolicy,
  passwordGenSenderPolicy,
  SecurityRequestSchema,
  securitySenderPolicy,
  AliasRequestSchema,
  aliasSenderPolicy,
  type BackupRequest,
  type BackupResponse,
  type EnteSafeState,
  type FolderRequest,
  type FolderResponse,
  type FoundationResponse,
  type PasswordGenRequest,
  type PasswordGenResponse,
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
  type PasskeyRequest,
  type PasskeyResponse,
  type SenderContext,
  type VaultResponse,
  VaultRequestSchema,
  VaultResponseSchema,
  vaultSenderPolicy,
  VaultStateResponseSchema,
} from "@shardpass/messaging";
import { toSafeError, type SafeError, type SafeErrorCode } from "@shardpass/security";

import { FolderServiceError, type FolderServiceErrorCode } from "./folder/folder-service";
import { ItemServiceError, type ItemServiceErrorCode } from "./item/item-service";
import { LoginFillServiceError, type LoginFillServiceErrorCode } from "./login/login-fill-service";
import { OtpFillServiceError, type OtpFillServiceErrorCode } from "./otp/otp-fill-service";
import { OtpServiceError, type OtpService, type OtpServiceErrorCode } from "./otp/otp-service";
import { PasskeyServiceError, type PasskeyServiceErrorCode } from "./passkey/passkey-service";
import {
  PasswordGenServiceError,
  type PasswordGenServiceErrorCode,
} from "./password/password-gen-service";
import { BackupServiceError, type BackupServiceErrorCode } from "./vault/backup-service";
import { VaultSessionError } from "./vault/session-service";
import type { VaultService } from "./vault/vault-service";
import type { EnteService } from "./ente/ente-service";
import { EnteProtocolError } from "./ente/protocol";
import { DataFillServiceError, type DataFillService } from "./login/data-fill-service";
import { AliasError, type AliasService } from "./alias/alias-service";
import { BreachCheckError, type BreachCheckService } from "./security/breach-check-service";

export type BackgroundErrorResponse = Readonly<{
  version: 1;
  kind: "error";
  /**
   * `detail` is set for Ente errors only: the background names the request or step that
   * failed (never a body, token or email) so the panel can show where, not just what.
   */
  error: SafeError & Readonly<{ detail?: string }>;
}>;

export type BackgroundResponse =
  | BackupResponse
  | FolderResponse
  | FoundationResponse
  | PasswordGenResponse
  | ItemCrudResponse
  | LoginFillResponse
  | MigrationResponse
  | OtpFillResponse
  | OtpImportResponse
  | OtpResponse
  | PasskeyResponse
  | VaultResponse
  | EnteSafeState
  | SecurityResponse
  | AliasResponse
  | DataFillResponse
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
  REPROMPT_REQUIRED: "REPROMPT_REQUIRED",
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

const passkeyErrorCodes = {
  VAULT_LOCKED: "VAULT_LOCKED",
  VAULT_UNAVAILABLE: "VAULT_UNAVAILABLE",
  PASSKEY_INVALID: "PASSKEY_INVALID",
  PASSKEY_NOT_FOUND: "PASSKEY_NOT_FOUND",
  PASSKEY_EXISTS: "PASSKEY_EXISTS",
  PASSKEY_UNSUPPORTED: "PASSKEY_UNSUPPORTED",
} satisfies Record<PasskeyServiceErrorCode, SafeErrorCode>;

const loginFillErrorCodes = {
  REPROMPT_REQUIRED: "REPROMPT_REQUIRED",
  LOGIN_FILL_INVALID: "LOGIN_FILL_INVALID",
  LOGIN_FILL_UNAVAILABLE: "LOGIN_FILL_UNAVAILABLE",
  LOGIN_FILL_NOT_FOUND: "LOGIN_FILL_NOT_FOUND",
  LOGIN_FILL_ITEM_CHANGED: "LOGIN_FILL_ITEM_CHANGED",
  VAULT_LOCKED: "VAULT_LOCKED",
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
  REPROMPT_REQUIRED: "REPROMPT_REQUIRED",
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
  handle(request: PasswordGenRequest): Promise<unknown>;
}>;
type FolderHandler = Readonly<{
  handle(request: FolderRequest, sender: SenderContext): Promise<unknown>;
}>;
type PasskeyHandler = Readonly<{
  handle(request: PasskeyRequest, sender: SenderContext): Promise<unknown>;
}>;

function errorResponse(code: SafeErrorCode): BackgroundErrorResponse {
  return {
    version: 1,
    kind: "error",
    error: toSafeError(undefined, code),
  };
}

function enteErrorResponse(error: unknown): BackgroundErrorResponse {
  if (!(error instanceof EnteProtocolError)) return errorResponse("ENTE_UNAVAILABLE");
  const base = errorResponse(error.code);
  if (error.detail === undefined) return base;
  return { ...base, error: { ...base.error, detail: error.detail } };
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

/** The one reply each vault command may be answered with. */
const vaultResponseKindByRequest = {
  "vault.getState": "vault.state",
  "vault.getKdfChallenge": "vault.kdfChallenge",
  "vault.setup": "vault.ok",
  "vault.unlock": "vault.ok",
  "vault.lock": "vault.ok",
  "vault.changePassword": "vault.ok",
  "vault.updateLockSettings": "vault.ok",
  "vault.confirmReprompt": "vault.ok",
  "vault.getPinChallenge": "vault.pinChallenge",
  "vault.unlockWithPin": "vault.ok",
  "vault.setPin": "vault.ok",
  "vault.removePin": "vault.ok",
} as const;

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
  passkeyService?: PasskeyHandler,
  breachCheckService?: Pick<BreachCheckService, "handle">,
  aliasService?: Pick<AliasService, "handle">,
  dataFillService?: Pick<DataFillService, "handle">,
): Promise<BackgroundResponse> {
  const dataFillRequest = DataFillRequestSchema.safeParse(input);
  if (dataFillRequest.success) {
    const policy = dataFillSenderPolicy[dataFillRequest.data.kind];
    if (!authorizeSender(senderContext, { extensionId: expectedExtensionId, ...policy }))
      return Promise.resolve(errorResponse("UNAUTHORIZED_SENDER"));
    if (dataFillService === undefined) return Promise.resolve(errorResponse("VAULT_UNAVAILABLE"));
    return dataFillService
      .handle(dataFillRequest.data, senderContext as SenderContext)
      .then((candidate) => {
        const parsed = parseDataFillResponseForRequest(dataFillRequest.data, candidate);
        return parsed.success ? parsed.data : errorResponse("VAULT_UNAVAILABLE");
      })
      .catch((error: unknown) =>
        errorResponse(error instanceof DataFillServiceError ? error.code : "VAULT_UNAVAILABLE"),
      );
  }

  const securityRequest = SecurityRequestSchema.safeParse(input);
  if (securityRequest.success) {
    const policy = securitySenderPolicy[securityRequest.data.kind];
    if (!authorizeSender(senderContext, { extensionId: expectedExtensionId, ...policy }))
      return Promise.resolve(errorResponse("UNAUTHORIZED_SENDER"));
    if (breachCheckService === undefined)
      return Promise.resolve(errorResponse("VAULT_UNAVAILABLE"));
    return breachCheckService
      .handle(securityRequest.data)
      .then((candidate) => {
        const parsed = parseSecurityResponseForRequest(securityRequest.data, candidate);
        return parsed.success ? parsed.data : errorResponse("VAULT_UNAVAILABLE");
      })
      .catch((error: unknown) =>
        errorResponse(error instanceof BreachCheckError ? error.code : "VAULT_UNAVAILABLE"),
      );
  }

  const aliasRequest = AliasRequestSchema.safeParse(input);
  if (aliasRequest.success) {
    const policy = aliasSenderPolicy[aliasRequest.data.kind];
    if (!authorizeSender(senderContext, { extensionId: expectedExtensionId, ...policy }))
      return Promise.resolve(errorResponse("UNAUTHORIZED_SENDER"));
    if (aliasService === undefined) return Promise.resolve(errorResponse("VAULT_UNAVAILABLE"));
    return aliasService
      .handle(aliasRequest.data)
      .then((candidate) => {
        const parsed = parseAliasResponseForRequest(aliasRequest.data, candidate);
        return parsed.success ? parsed.data : errorResponse("ALIAS_UNAVAILABLE");
      })
      .catch((error: unknown) =>
        errorResponse(error instanceof AliasError ? error.code : "ALIAS_UNAVAILABLE"),
      );
  }

  const passkeyRequest = PasskeyRequestSchema.safeParse(input);
  if (passkeyRequest.success) {
    const policy = passkeySenderPolicy[passkeyRequest.data.kind];
    if (!authorizeSender(senderContext, { extensionId: expectedExtensionId, ...policy }))
      return Promise.resolve(errorResponse("UNAUTHORIZED_SENDER"));
    if (passkeyService === undefined) return Promise.resolve(errorResponse("VAULT_UNAVAILABLE"));
    return passkeyService
      .handle(passkeyRequest.data, senderContext as SenderContext)
      .then((candidate) => {
        const parsed = parsePasskeyResponseForRequest(passkeyRequest.data, candidate);
        return parsed.success ? parsed.data : errorResponse("VAULT_UNAVAILABLE");
      })
      .catch((error: unknown) =>
        errorResponse(
          error instanceof PasskeyServiceError ? passkeyErrorCodes[error.code] : "UNEXPECTED",
        ),
      );
  }

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
        errorResponse(
          error instanceof FolderServiceError ? folderErrorCodes[error.code] : "UNEXPECTED",
        ),
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
        errorResponse(
          error instanceof ItemServiceError ? itemErrorCodes[error.code] : "UNEXPECTED",
        ),
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

  const passwordGenRequest = PasswordGenRequestSchema.safeParse(input);
  if (passwordGenRequest.success) {
    const policy = passwordGenSenderPolicy[passwordGenRequest.data.kind];
    if (!authorizeSender(senderContext, { extensionId: expectedExtensionId, ...policy }))
      return Promise.resolve(errorResponse("UNAUTHORIZED_SENDER"));
    if (passwordGenService === undefined)
      return Promise.resolve(errorResponse("PASSWORD_GEN_INVALID"));
    return passwordGenService
      .handle(passwordGenRequest.data)
      .then((candidate) => {
        const parsed = PasswordGenResponseSchema.safeParse(candidate);
        return parsed.success &&
          parsed.data.kind === passwordGenResponseKindByRequest[passwordGenRequest.data.kind]
          ? parsed.data
          : errorResponse("PASSWORD_GEN_INVALID");
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
      .then((candidate) => {
        // The safe projection is what leaves the worker, enforced here rather than by
        // the service's hand-built object: no session or key material rides along.
        const parsed = EnteSafeStateSchema.safeParse(candidate);
        return parsed.success ? parsed.data : errorResponse("VAULT_UNAVAILABLE");
      })
      .catch((error: unknown) => enteErrorResponse(error));
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
          // A vault that locked mid-request answers "locked" (which drives the lock screen),
          // never "no codes": an empty list would read as an empty vault.
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
      return getState()
        .then((candidate) => {
          const parsed = VaultStateResponseSchema.safeParse(candidate);
          return parsed.success ? parsed.data : errorResponse("VAULT_UNAVAILABLE");
        })
        .catch(() => errorResponse("VAULT_UNAVAILABLE"));
    }
    const boundSender = senderContext as Parameters<VaultService["handle"]>[1];
    const expectedKind = vaultResponseKindByRequest[vaultRequest.data.kind];
    return vaultService
      .handle(vaultRequest.data, boundSender)
      .then((candidate) => {
        // Validated and matched to the request, like every other family: a challenge is
        // never answered with an ok, and nothing beyond the schema leaves the worker.
        const parsed = VaultResponseSchema.safeParse(candidate);
        return parsed.success && parsed.data.kind === expectedKind
          ? parsed.data
          : errorResponse("VAULT_UNAVAILABLE");
      })
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
