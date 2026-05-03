export interface Account {
  id: string;
  issuer: string;
  label: string;
  secret: string;
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: 6 | 7 | 8;
  period: number;
  tags: string[];
  createdAt: number;
}

export interface Vault {
  version: 1;
  accounts: Account[];
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
