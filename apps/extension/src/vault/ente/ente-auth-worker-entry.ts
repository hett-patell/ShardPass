/// <reference lib="webworker" />

import "../../background/ente/srp-compat/install-buffer-global";

import { createEnteClient } from "../../background/ente/client";
import { EnteProtocolError } from "../../background/ente/protocol";
import {
  createEnteSodiumAdapter,
  type EnteSodiumAdapter,
} from "../../background/ente/sodium-adapter";
import { encodeEnteSessionPayload } from "../../background/ente/session-handoff";
import { createEnteSrpClient } from "../../background/ente/srp-adapter";
import { installEnteAuthWorker } from "./ente-auth-worker";
import type { EnteAuthWorkerResponse } from "./ente-auth-worker-protocol";

const scope = self as DedicatedWorkerGlobalScope;
const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();
// URL-safe Base64 with padding kept: libsodium's URLSAFE variant, which the official client
// uses for the auth token, and what Ente's server decodes (Go's padded URLEncoding). A
// 32-byte token pads with one "="; stripping it made every authenticated request 401.
const base64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_");
};
const randomCapability = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  try {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } finally {
    bytes.fill(0);
  }
};
type Continuation = {
  sessionId: string;
  kek: Uint8Array;
  handoffCapability: string;
  handoffPublicKey: Uint8Array;
};
const continuations = new Map<string, Continuation>();

function recoverSession(
  response: {
    token?: string;
    encryptedToken?: string;
    keyAttributes?: unknown;
  },
  kek: Uint8Array,
  sodium: EnteSodiumAdapter,
): { token: string; masterKey: Uint8Array } {
  const attributes = response.keyAttributes as
    | {
        encryptedKey?: string;
        keyDecryptionNonce?: string;
        encryptedSecretKey?: string;
        secretKeyDecryptionNonce?: string;
        publicKey?: string;
      }
    | undefined;
  if (attributes?.encryptedKey === undefined || attributes.keyDecryptionNonce === undefined)
    throw new Error("sign-in response has no key attributes");
  const masterKey = sodium.secretboxOpen(
    sodium.fromBase64(attributes.encryptedKey),
    sodium.fromBase64(attributes.keyDecryptionNonce),
    kek,
  );
  if (response.token !== undefined) return { token: response.token, masterKey };
  if (
    response.encryptedToken === undefined ||
    attributes.encryptedSecretKey === undefined ||
    attributes.secretKeyDecryptionNonce === undefined ||
    attributes.publicKey === undefined
  ) {
    masterKey.fill(0);
    throw new Error("key attributes are missing the account secret key");
  }
  const secretKey = sodium.secretboxOpen(
    sodium.fromBase64(attributes.encryptedSecretKey),
    sodium.fromBase64(attributes.secretKeyDecryptionNonce),
    masterKey,
  );
  try {
    const token = sodium.sealedBoxOpen(
      sodium.fromBase64(response.encryptedToken),
      sodium.fromBase64(attributes.publicKey),
      secretKey,
    );
    try {
      return { token: base64Url(token), masterKey };
    } finally {
      token.fill(0);
    }
  } finally {
    secretKey.fill(0);
  }
}

async function completeResult(
  jobId: string,
  capability: string,
  publicKey: Uint8Array,
  token: string,
  masterKey: Uint8Array,
  client: ReturnType<typeof createEnteClient>,
  sodium: EnteSodiumAdapter,
) {
  let authKey: Uint8Array | undefined;
  let fingerprint: Uint8Array | undefined;
  let payload: Uint8Array | undefined;
  const tokenUtf8 = encoder.encode(token);
  try {
    let response: { encryptedKey?: unknown; header?: unknown } | null = null;
    try {
      response = (await client.getAuthenticatorKey(token, new AbortController().signal)) as {
        encryptedKey?: unknown;
        header?: unknown;
      };
    } catch (error) {
      if (!(error instanceof EnteProtocolError) || error.code !== "ENTE_AUTH_KEY_MISSING") throw error;
    }
    if (response === null) {
      // A fresh Ente account has no authenticator key yet. The official client creates one
      // on first use: a random secretbox key wrapped with the master key.
      const fresh = sodium.randomBytes(32);
      const nonce = sodium.randomBytes(24);
      const sealed = sodium.secretboxSeal(fresh, nonce, masterKey);
      try {
        await client.createAuthenticatorKey(
          token,
          { encryptedKey: sodium.toBase64(sealed), header: sodium.toBase64(nonce) },
          new AbortController().signal,
        );
      } catch (error) {
        fresh.fill(0);
        throw error;
      } finally {
        sealed.fill(0);
        nonce.fill(0);
      }
      authKey = fresh;
    } else {
      if (typeof response.encryptedKey !== "string" || typeof response.header !== "string")
        throw new Error("authenticator key response is malformed");
      const encryptedAuthKey = sodium.fromBase64(response.encryptedKey);
      const authHeader = sodium.fromBase64(response.header);
      try {
        authKey = sodium.secretboxOpen(encryptedAuthKey, authHeader, masterKey);
      } finally {
        encryptedAuthKey.fill(0);
        authHeader.fill(0);
      }
    }
    fingerprint = new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from(authKey).buffer),
    );
    payload = encodeEnteSessionPayload({
      token: tokenUtf8,
      masterKey,
      authKey,
      accountFingerprint: fingerprint,
    });
    return {
      version: 1,
      kind: "ente.auth.complete",
      jobId,
      capability,
      ciphertext: Uint8Array.from(sodium.sealedBoxSeal(payload, publicKey)),
    } as const;
  } finally {
    tokenUtf8.fill(0);
    masterKey.fill(0);
    authKey?.fill(0);
    fingerprint?.fill(0);
    payload?.fill(0);
  }
}

installEnteAuthWorker(
  scope,
  async (request): Promise<Exclude<EnteAuthWorkerResponse, { kind: "ente.auth.error" }>> => {
    const sodium = await createEnteSodiumAdapter();
    const client = createEnteClient({ fetch: (url, init) => fetch(url, init) });
    try {
      if (request.kind === "ente.auth.totp") {
        const continuation = continuations.get(request.capability);
        continuations.delete(request.capability);
        if (continuation === undefined) throw new Error("no pending sign-in for this code");
        try {
          const response = (await client.verifyTotp2fa(
            { code: decoder.decode(request.codeUtf8), sessionID: continuation.sessionId },
            new AbortController().signal,
          )) as { encryptedToken?: string; token?: string; keyAttributes?: unknown };
          const recovered = recoverSession(response, continuation.kek, sodium);
          return await completeResult(
            request.jobId,
            continuation.handoffCapability,
            continuation.handoffPublicKey,
            recovered.token,
            recovered.masterKey,
            client,
            sodium,
          );
        } finally {
          continuation.kek.fill(0);
          continuation.handoffPublicKey.fill(0);
        }
      }

      const email = decoder.decode(request.emailUtf8);
      const password = Uint8Array.from(request.passwordUtf8);
      let kek: Uint8Array | undefined;
      try {
        const attributesResponse = (await client.getSrpAttributes(
          email,
          new AbortController().signal,
        )) as {
          attributes: {
            srpUserID: string;
            srpSalt: string;
            kekSalt: string;
            opsLimit: number;
            memLimit: number;
          };
        };
        const attributes = attributesResponse.attributes;
        kek = sodium.argon2id(
          password,
          sodium.fromBase64(attributes.kekSalt),
          attributes.opsLimit,
          attributes.memLimit,
          32,
        );
        // Ente derives a 32-byte "loginctx" subkey and uses its first 16 bytes as the SRP
        // password. Deriving 16 bytes directly is a different key: crypto_kdf is BLAKE2b with
        // the output length in its parameter block, so BLAKE2b-128(x) is not a prefix of
        // BLAKE2b-256(x). The shorter derivation produced a wrong proof for every account.
        const loginSubKey = sodium.deriveSubkey(kek, 32, 1, "loginctx");
        const loginKey = loginSubKey.slice(0, 16);
        loginSubKey.fill(0);
        const identity = encoder.encode(attributes.srpUserID);
        const srp = createEnteSrpClient({
          usernameUtf8: identity,
          passwordKey: loginKey,
          salt: sodium.fromBase64(attributes.srpSalt),
        });
        try {
          const session = (await client.createSrpSession(
            { srpUserID: attributes.srpUserID, srpA: sodium.toBase64(srp.clientPublicA()) },
            new AbortController().signal,
          )) as { sessionID: string; srpB: string };
          const proof = srp.clientProof(sodium.fromBase64(session.srpB));
          const verified = (await client.verifySrpSession(
            {
              sessionID: session.sessionID,
              srpUserID: attributes.srpUserID,
              srpM1: sodium.toBase64(proof.M1),
            },
            new AbortController().signal,
          )) as {
            srpM2: string;
            token?: string;
            encryptedToken?: string;
            twoFactorSessionID?: string;
            twoFactorSessionIDV2?: string;
            passkeySessionID?: string;
            keyAttributes?: unknown;
          };
          srp.verifyServerProof(sodium.fromBase64(verified.srpM2));
          proof.sessionKey.fill(0);
          // A passkey-protected account answers with a passkey session and no token. There is
          // no passkey ceremony here, so say so rather than failing as a wrong password.
          // Empty strings are "absent": the server does not omit these fields.
          if (verified.passkeySessionID && !verified.token && !verified.encryptedToken)
            throw new EnteProtocolError("ENTE_SRP_UNSUPPORTED");
          const twoFactorSessionId =
            verified.twoFactorSessionID || verified.twoFactorSessionIDV2 || undefined;
          if (twoFactorSessionId !== undefined) {
            const capability = randomCapability();
            continuations.set(capability, {
              sessionId: twoFactorSessionId,
              kek,
              handoffCapability: request.handoffCapability,
              handoffPublicKey: Uint8Array.from(request.handoffPublicKey),
            });
            kek = undefined;
            return {
              version: 1,
              kind: "ente.auth.totp-required",
              jobId: request.jobId,
              capability,
            };
          }
          const recovered = recoverSession(verified, kek, sodium);
          return await completeResult(
            request.jobId,
            request.handoffCapability,
            request.handoffPublicKey,
            recovered.token,
            recovered.masterKey,
            client,
            sodium,
          );
        } finally {
          identity.fill(0);
          loginKey.fill(0);
          srp.dispose();
        }
      } finally {
        password.fill(0);
        kek?.fill(0);
      }
    } finally {
      sodium.dispose();
    }
  },
);
