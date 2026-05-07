import {
  boxSealOpenBytes,
  decryptBoxBytes,
  decryptBoxToB64,
  deriveKEK,
  toB64,
  toB64URLSafe,
} from "./crypto";
import {
  getSRPAttributes,
  requestEmailOTT,
  verifyEmail,
  verifyTwoFactor,
} from "./api";
import { verifySRP } from "./srp";
import type {
  EmailVerificationResponse,
  KeyAttributes,
  SRPAttributes,
  SRPVerificationResponse,
} from "./types";

export interface SignedInSession {
  status: "connected";
  email: string;
  serverUrl: string;
  authToken: string;
  masterKey: string;
  keyAttributes: KeyAttributes;
}

export interface LoginContinuation {
  status: "twofa";
  twoFactorSessionID: string;
  derivedKEK: string;
  email: string;
  serverUrl: string;
}

export interface PasskeyOnly {
  status: "passkey-only";
  message: string;
}

export type LoginOutcome = SignedInSession | LoginContinuation | PasskeyOnly;

async function decryptMasterKeyB64(
  attrs: KeyAttributes,
  kekB64: string,
): Promise<string> {
  return decryptBoxToB64(attrs.encryptedKey, attrs.keyDecryptionNonce, kekB64);
}

async function decryptToken(
  encryptedToken: string,
  attrs: KeyAttributes,
  masterKey: string,
): Promise<string> {
  const privBytes = await decryptBoxBytes(
    attrs.encryptedSecretKey,
    attrs.secretKeyDecryptionNonce,
    masterKey,
  );
  const privKey = await toB64(privBytes);
  const tokenBytes = await boxSealOpenBytes(
    encryptedToken,
    attrs.publicKey,
    privKey,
  );
  return toB64URLSafe(tokenBytes);
}

function pickSession(resp: SRPVerificationResponse | EmailVerificationResponse): {
  twofa?: string;
  passkey?: string;
} {
  return {
    twofa: resp.twoFactorSessionID ?? resp.twoFactorSessionIDV2,
    passkey: resp.passkeySessionID,
  };
}

async function finalizeFromVerifyResponse(
  resp: SRPVerificationResponse | EmailVerificationResponse,
  derivedKEK: string,
  email: string,
  serverUrl: string,
): Promise<SignedInSession> {
  const keyAttributes = resp.keyAttributes;
  if (!keyAttributes) throw new Error("Login response missing keyAttributes");
  const masterKey = await decryptMasterKeyB64(keyAttributes, derivedKEK);
  let token: string;
  if (resp.token) {
    token = resp.token;
  } else if (resp.encryptedToken) {
    token = await decryptToken(resp.encryptedToken, keyAttributes, masterKey);
  } else {
    throw new Error("Login response missing token");
  }
  return {
    status: "connected",
    email,
    serverUrl,
    authToken: token,
    masterKey,
    keyAttributes,
  };
}

export async function fetchSrpAttributes(
  serverUrl: string,
  email: string,
): Promise<SRPAttributes | undefined> {
  return getSRPAttributes(serverUrl, email);
}

export async function loginWithPassword(args: {
  serverUrl: string;
  email: string;
  password: string;
  attrs: SRPAttributes;
}): Promise<LoginOutcome> {
  const { serverUrl, email, password, attrs } = args;
  const kek = await deriveKEK(password, attrs.kekSalt, attrs.opsLimit, attrs.memLimit);
  const resp = await verifySRP(serverUrl, attrs, kek);
  const sess = pickSession(resp);
  if (sess.twofa) {
    return {
      status: "twofa",
      twoFactorSessionID: sess.twofa,
      derivedKEK: kek,
      email,
      serverUrl,
    };
  }
  if (sess.passkey) {
    return {
      status: "passkey-only",
      message:
        "This Ente account is protected by a passkey. Passkey-only login isn't supported in ShardPass yet — enable an authenticator-app 2FA on your Ente account, or use a password-protected account.",
    };
  }
  return finalizeFromVerifyResponse(resp, kek, email, serverUrl);
}

export async function startEmailOttFlow(
  serverUrl: string,
  email: string,
): Promise<void> {
  await requestEmailOTT(serverUrl, email);
}

export async function loginWithEmailOtt(args: {
  serverUrl: string;
  email: string;
  ott: string;
  password: string;
}): Promise<LoginOutcome> {
  const { serverUrl, email, ott, password } = args;
  const resp = await verifyEmail(serverUrl, email, ott);
  const sess = pickSession(resp);
  if (sess.passkey && !sess.twofa) {
    return {
      status: "passkey-only",
      message:
        "This Ente account is protected by a passkey. Passkey-only login isn't supported in ShardPass yet.",
    };
  }
  if (!resp.keyAttributes) {
    throw new Error("Email OTT response missing key attributes — unsupported account state");
  }
  const kek = await deriveKEK(
    password,
    resp.keyAttributes.kekSalt,
    resp.keyAttributes.opsLimit,
    resp.keyAttributes.memLimit,
  );
  if (sess.twofa) {
    return {
      status: "twofa",
      twoFactorSessionID: sess.twofa,
      derivedKEK: kek,
      email,
      serverUrl,
    };
  }
  return finalizeFromVerifyResponse(resp, kek, email, serverUrl);
}

export async function completeTwoFactor(args: {
  serverUrl: string;
  email: string;
  twoFactorSessionID: string;
  code: string;
  derivedKEK: string;
}): Promise<SignedInSession> {
  const { serverUrl, email, twoFactorSessionID, code, derivedKEK } = args;
  const resp = await verifyTwoFactor(serverUrl, twoFactorSessionID, code);
  // verifyTwoFactor responds with an unconditional KeyAttributes/encryptedToken pair.
  return finalizeFromVerifyResponse(resp, derivedKEK, email, serverUrl) as Promise<SignedInSession>;
}
