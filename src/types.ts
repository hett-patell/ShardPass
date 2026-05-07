export type OtpType = "totp" | "hotp" | "steam";

export interface Account {
  id: string;
  issuer: string;
  label: string;
  secret: string;
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: number;
  period: number;
  tags: string[];
  createdAt: number;
  /** OTP variant — defaults to "totp" when absent. */
  type?: OtpType;
  /** HOTP counter (only when type === "hotp"). */
  counter?: number;
  /** Free-form note (synced with Ente via codeDisplay). */
  note?: string;
}

export interface VaultIntegrations {
  duckduckgo?: { token: string };
  ente?: EnteIntegration;
}

export interface EnteIntegration {
  email: string;
  serverUrl: string;
  authToken: string;
  masterKey: string;
  authenticatorKey?: string;
  lastSync?: number;
  lastError?: string;
  needsReauth?: boolean;
  /** Maps Ente entity-ID → local Account.id */
  entityMap: Record<string, string>;
  /** Queued local changes to push on next sync. */
  pending?: EntePendingChange[];
}

export interface EntePendingChange {
  op: "create" | "update" | "delete";
  accountId: string;
  enteId?: string;
  enqueuedAt: number;
  attempts: number;
}

export interface Vault {
  version: 1;
  accounts: Account[];
  integrations?: VaultIntegrations;
}

export interface EncryptedVault {
  version: 1;
  salt: string;
  iv: string;
  ciphertext: string;
  iterations: number;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  autoLockMinutes: number;
  lockOnScreenLock: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  autoLockMinutes: 15,
  lockOnScreenLock: true,
};
