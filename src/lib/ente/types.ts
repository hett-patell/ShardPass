export interface SRPAttributes {
  srpUserID: string;
  srpSalt: string;
  memLimit: number;
  opsLimit: number;
  kekSalt: string;
  isEmailMFAEnabled: boolean;
}

export interface KeyAttributes {
  kekSalt: string;
  opsLimit: number;
  memLimit: number;
  encryptedKey: string;
  keyDecryptionNonce: string;
  publicKey: string;
  encryptedSecretKey: string;
  secretKeyDecryptionNonce: string;
}

export interface SRPVerificationResponse {
  id: number;
  keyAttributes?: KeyAttributes;
  encryptedToken?: string;
  token?: string;
  srpM2: string;
  twoFactorSessionID?: string;
  passkeySessionID?: string;
  twoFactorSessionIDV2?: string;
}

export interface EmailVerificationResponse {
  id: number;
  keyAttributes?: KeyAttributes;
  encryptedToken?: string;
  token?: string;
  twoFactorSessionID?: string;
  passkeySessionID?: string;
  twoFactorSessionIDV2?: string;
}

export interface TwoFactorAuthorizationResponse {
  id: number;
  keyAttributes: KeyAttributes;
  encryptedToken: string;
}

export interface AuthenticatorEntityKey {
  encryptedKey: string;
  header: string;
}

export interface RemoteAuthenticatorEntityChange {
  id: string;
  encryptedData: string | null;
  header: string | null;
  isDeleted: boolean;
  updatedAt: number;
}

export interface AuthenticatorEntityDiffResponse {
  diff: RemoteAuthenticatorEntityChange[];
  timestamp?: number;
}

export interface EntityCreateResponse {
  id: string;
}

export const DEFAULT_ENTE_API = "https://api.ente.io";
export const ENTE_CLIENT_PACKAGE = "io.ente.auth.web";
